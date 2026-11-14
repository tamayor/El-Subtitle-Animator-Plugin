"""Subject matte for Spotlight (src/main/spotlight.js): Robust Video Matting (ONNX, MobileNetV3) on the footage frames,
written as RGBA cut-outs (the footage where the person is, transparent elsewhere) plus the numbers the panel needs to
place the big word behind the head.

Runs in the app's tracker venv (onnxruntime + OpenCV + numpy). Reads one JSON line on stdin:
  {dir, frames: [timeline frames], model, out, feather? (px), choke? (0..0.4), band? (px), islands? (0..1), downsample?,
   wait? (seconds), plate? (bool)}
wait: the frames are still being exported while this runs (B-roll, src/main/broll-footage.js): a frame is read once the
  next one exists or dir/exported does, so the matte overlaps the export instead of following it.
plate: also writes out/p%05d.jpg, the frame with the person filled in from the room around them (the clean plate that
  Vertigo scales behind the cut-out).
(downsample above ~0.3 at HD makes RVM key the background - SIC logo - so keep the 512 px default)
dir/f<frame>.jpg are the footage frames (timeline space, Edit sizing applied - bridge track_frames). Writes
out/c%05d.png (index 0..n-1, an image sequence Resolve imports as one clip) and prints JSON lines:
  {"progress": i, "total": n}  ...  {"done": true, "stats": {...}}   or   {"error": "..."}
stats: headTop (0..1 from the top, median), cx (subject centre x, median), box [x, y, w, h] (union, 0..1),
       perFrame: [[headTop, cx], ...], width, height, ms (per frame).
"""
import json
import os
import sys
import time

import cv2
import numpy as np


def emit(o):
    sys.stdout.write(json.dumps(o) + "\n")
    sys.stdout.flush()


def session(model):
    import onnxruntime as ort
    opts = ort.SessionOptions()
    opts.log_severity_level = 3
    prov = [p for p in ("CoreMLExecutionProvider", "CPUExecutionProvider") if p in ort.get_available_providers()]
    try:
        return ort.InferenceSession(model, opts, providers=prov)
    except Exception:
        return ort.InferenceSession(model, opts, providers=["CPUExecutionProvider"])


def head_top(a):
    """Topmost row (0..1) where the subject covers more than 1.5% of the width, and the subject's centre x there."""
    h, w = a.shape
    rows = (a > 0.5).sum(axis=1)
    hit = np.nonzero(rows > max(4, 0.015 * w))[0]
    if not len(hit):
        return None, None
    top = int(hit[0])
    band = a[top:min(h, top + max(8, h // 20))] > 0.5
    xs = np.nonzero(band.any(axis=0))[0]
    cx = float(xs.mean()) / w if len(xs) else 0.5
    return top / float(h), cx


def keep_subject(al, keep_frac=0.12):
    """Drops matte islands that are not the person: RVM sometimes keys bright signage / logos in the background. Keeps
    the components at least 12% the size of the largest one (the body, plus a detached hand or arm). An opening first
    cuts the thin soft bridges that join a wall sign to the hair, so the sign becomes its own island and is dropped."""
    h, w = al.shape
    small = cv2.resize(al, (max(1, w // 4), max(1, h // 4)), interpolation=cv2.INTER_AREA)
    solid = cv2.morphologyEx((small > 0.5).astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(solid, 8)
    if n <= 2:
        return al
    areas = st[1:, cv2.CC_STAT_AREA]
    big = areas.max()
    keep = np.zeros(n, np.uint8)
    keep[1:] = (areas >= keep_frac * big).astype(np.uint8)
    m = keep[lab] * 255
    m = cv2.dilate(m, np.ones((5, 5), np.uint8))
    m = cv2.resize(m, (w, h), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255.0
    return al * cv2.GaussianBlur(m, (0, 0), 2)


def fill_holes(al):
    """Makes everything enclosed by the silhouette opaque: RVM leaves eyes, teeth and shiny skin half transparent, and
    the word then shows through the face. Background = what is reachable from any frame edge (the desk between the arms
    at the bottom is background too, not a hole)."""
    # one flood from a 1 px empty border around the picture reaches every background pixel that touches an edge
    ff = cv2.copyMakeBorder((al > 0.9).astype(np.uint8), 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=0)
    cv2.floodFill(ff, None, (0, 0), 2)
    return np.maximum(al, (ff[1:-1, 1:-1] == 0).astype(np.float32))


def near_core(al, band):
    """Keeps soft alpha only within `band` px of the solid subject (alpha > 0.9): hair wisps and edges stay, but the
    half-keyed wall / desk patches RVM hangs off the shoulders and hands (grey clouds once the room is dimmed) go."""
    core = (al > 0.9).astype(np.uint8)
    if not core.any():
        return al
    dist = cv2.distanceTransform(1 - core, cv2.DIST_L2, 3)
    return al * np.clip((band - dist) / (0.5 * band), 0, 1)


def clean_matte(al, choke=0.12, feather=0.7, band=None, keep_frac=0.12):
    """RVM alpha -> a cut-out that reads cleanly with a bright word behind it: levels squeeze the soft haze around the
    hair (glow and wall colour bleeding through) and firm up the inside, then islands are dropped, holes filled and the
    edge softened by `feather` px."""
    if choke > 0:
        choke = min(float(choke), 0.45)
        al = np.clip((al - choke) / (1.0 - 2.0 * choke), 0, 1)
    al = keep_subject(al, keep_frac)
    al = near_core(al, band or max(6.0, 0.008 * max(al.shape)))     # ~15 px at 1080x1920
    al = fill_holes(al)
    if feather > 0:
        al = cv2.GaussianBlur(al, (0, 0), feather)
    return np.clip(al, 0, 1)


def decontaminate(img, fgr, al):
    """Edge colour: the footage pixels inside, RVM's predicted foreground where the matte is soft, so the wall / sign
    colour behind loose hair does not ring the head (a pink fringe over a red glow)."""
    # only the soft edge changes (0.35 < alpha < 1), so only those pixels are computed: the rest is the footage as is
    # (the whole-frame version of this was a third of the time per frame)
    idx = (al > 0.35) & (al < 1.0)
    out = img.copy()
    if idx.any():
        f8 = (np.clip(fgr[idx][:, ::-1], 0, 1) * 255.0 + 0.5).astype(np.uint8)
        wgt = (np.clip((1.0 - al[idx]) * 2.0, 0, 1) * 0.6)[:, None]
        out[idx] = (img[idx] * (1.0 - wgt) + f8 * wgt + 0.5).astype(np.uint8)
    return out


PLATE_LONG = 384        # the fill is worked out small (it is a soft guess at what is behind the person anyway)


def clean_plate(img, al, prev):
    """The frame with the person replaced by the room around them: the matte, grown a little, is inpainted on a small
    copy and laid back soft-edged. `prev` is the last frame's small fill; blending with it keeps the fill from
    flickering as the matte's edge moves. -> (plate, small fill)"""
    H, W = img.shape[:2]
    s = PLATE_LONG / float(max(H, W))
    sw, sh = max(8, int(round(W * s))), max(8, int(round(H * s)))
    small = cv2.resize(img, (sw, sh), interpolation=cv2.INTER_AREA)
    m = (cv2.resize(al, (sw, sh), interpolation=cv2.INTER_AREA) > 0.02).astype(np.uint8)
    k = max(3, int(max(sw, sh) * 0.03) | 1)
    m = cv2.dilate(m, np.ones((k, k), np.uint8))
    fill = cv2.inpaint(small, m, 3, cv2.INPAINT_TELEA).astype(np.float32)
    if prev is not None and prev.shape == fill.shape:
        fill = prev * 0.7 + fill * 0.3
    up = cv2.resize(fill, (W, H), interpolation=cv2.INTER_CUBIC)
    mf = cv2.GaussianBlur(cv2.resize(m * 255, (W, H), interpolation=cv2.INTER_LINEAR), (0, 0), max(2.0, 0.004 * max(W, H))).astype(np.float32) / 255.0
    plate = cv2.blendLinear(img.astype(np.float32), up, 1.0 - mf, mf)
    return np.clip(plate + 0.5, 0, 255).astype(np.uint8), fill


def wait_for(src_dir, frames, i, seconds, cancel):
    """Blocks until frame i is completely written: the next frame's file exists (Resolve writes them in order) or the
    exporter left dir/exported. False when cancelled; raises after `seconds` without the frame."""
    me = os.path.join(src_dir, "f%d.jpg" % frames[i])
    nxt = os.path.join(src_dir, "f%d.jpg" % frames[i + 1]) if i + 1 < len(frames) else None
    done = os.path.join(src_dir, "exported")
    t0 = time.time()
    while True:
        if os.path.exists(cancel):
            return False
        if os.path.exists(me) and ((nxt and os.path.exists(nxt)) or os.path.exists(done)):
            return True
        if time.time() - t0 > seconds:
            raise RuntimeError("footage frame %d did not arrive" % frames[i])
        time.sleep(0.01)


def main():
    a = json.loads(sys.stdin.readline())
    src_dir, frames, out = a["dir"], [int(f) for f in a["frames"]], a["out"]
    feather = float(a.get("feather", 0.7))
    choke = float(a.get("choke", 0.12))
    band = float(a["band"]) if a.get("band") else None
    keep_frac = float(a.get("islands", 0.12))
    os.makedirs(out, exist_ok=True)
    cancel = os.path.join(src_dir, "cancel")
    wait = float(a.get("wait") or 0)
    want_plate = bool(a.get("plate"))
    sess = session(a["model"])
    rec = [np.zeros((1, 1, 1, 1), np.float32)] * 4
    if wait and not wait_for(src_dir, frames, 0, wait, cancel):
        emit({"cancelled": True})
        return
    first = cv2.imread(os.path.join(src_dir, "f%d.jpg" % frames[0]))
    if first is None:
        raise RuntimeError("missing footage frame %d" % frames[0])
    H, W = first.shape[:2]
    # RVM's own guidance: downsample so the long side is ~512 px at HD (0.25 for 4K); quality vs speed
    ds = float(a.get("downsample") or min(1.0, 512.0 / max(W, H)))
    dsr = np.array([ds], np.float32)
    # warm-up: RVM's recurrent state starts empty, so frame 0 comes out with half-transparent patches (forehead,
    # eyes); a few passes over the first frame settle it before the real run
    rgb0 = np.ascontiguousarray((cv2.cvtColor(first, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0).transpose(2, 0, 1)[None])
    for _ in range(3):
        _, _, *rec = sess.run(None, {"src": rgb0, "r1i": rec[0], "r2i": rec[1], "r3i": rec[2], "r4i": rec[3], "downsample_ratio": dsr})
    tops, cxs, per = [], [], []
    union = None
    t0 = time.time()
    n = len(frames)
    from concurrent.futures import ThreadPoolExecutor
    pool = ThreadPoolExecutor(4)        # PNG writes (~75 ms each at 1080x1920) overlap the next frame's matte
    pending = []
    fill = None
    for i, f in enumerate(frames):
        if os.path.exists(cancel) or (wait and i and not wait_for(src_dir, frames, i, wait, cancel)):
            emit({"cancelled": True})
            return
        img = first if i == 0 else cv2.imread(os.path.join(src_dir, "f%d.jpg" % f))
        if img is None:
            raise RuntimeError("missing footage frame %d" % f)
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        src = np.ascontiguousarray(rgb.transpose(2, 0, 1)[None])
        fgr, pha, *rec = sess.run(None, {"src": src, "r1i": rec[0], "r2i": rec[1], "r3i": rec[2], "r4i": rec[3], "downsample_ratio": dsr})
        al = clean_matte(np.clip(pha[0, 0], 0, 1), choke, feather, band, keep_frac)
        top, cx = head_top(al)
        per.append([round(top, 4) if top is not None else None, round(cx, 4) if cx is not None else None])
        if top is not None:
            tops.append(top)
            cxs.append(cx)
        bx, by, bw, bh = cv2.boundingRect((al > 0.5).astype(np.uint8))
        if bw and bh:
            b = (bx, by, bx + bw - 1, by + bh - 1)
            union = b if union is None else (min(union[0], b[0]), min(union[1], b[1]), max(union[2], b[2]), max(union[3], b[3]))
        # straight alpha: the original footage pixels inside, RVM's foreground only on the soft edge
        rgba = np.dstack([decontaminate(img, fgr[0].transpose(1, 2, 0), al), (al * 255.0 + 0.5).astype(np.uint8)])
        pending.append(pool.submit(cv2.imwrite, os.path.join(out, "c%05d.png" % i), rgba, [cv2.IMWRITE_PNG_COMPRESSION, 1]))
        if want_plate:
            plate, fill = clean_plate(img, al, fill)
            pending.append(pool.submit(cv2.imwrite, os.path.join(out, "p%05d.jpg" % i), plate, [cv2.IMWRITE_JPEG_QUALITY, 92]))
        while len(pending) > 8:
            pending.pop(0).result()
        if i % 3 == 0 or i == n - 1:
            emit({"progress": i + 1, "total": n})
    for p in pending:
        p.result()
    pool.shutdown()
    ms = (time.time() - t0) * 1000.0 / max(1, n)
    stats = {"headTop": float(np.median(tops)) if tops else None, "cx": float(np.median(cxs)) if cxs else 0.5,
             "box": [union[0] / W, union[1] / H, (union[2] - union[0]) / W, (union[3] - union[1]) / H] if union else None,
             "perFrame": per, "width": W, "height": H, "ms": round(ms, 1), "frames": n}
    emit({"done": True, "stats": stats})


# Text+ draws a font's em at TEXTPLUS_EM x Size x frame height, and its Center is the middle of the capitals (measured
# 2026-11-12 on DM Serif Display Italic "CLAUDE", Size 0.26 on 1080x1920: 572 px wide, caps 270-380 px, Center 326).
TEXTPLUS_EM = 0.321
FONT_DIRS = [os.path.expanduser("~/Library/Fonts"), "/Library/Fonts", "/System/Library/Fonts", "/System/Library/Fonts/Supplemental"]


def find_font(family, style):
    from PIL import ImageFont
    fam, sty = (family or "").lower(), (style or "Regular").lower()
    best = None
    for d in FONT_DIRS:
        try:
            names = os.listdir(d)
        except OSError:
            continue
        for n in names:
            if not n.lower().endswith((".ttf", ".otf", ".ttc")):
                continue
            p = os.path.join(d, n)
            for idx in range(4 if n.lower().endswith(".ttc") else 1):
                try:
                    f = ImageFont.truetype(p, 100, index=idx)
                    fn, fs = [x.lower() for x in f.getname()]
                except Exception:
                    break
                if fn != fam:
                    continue
                if fs == sty:
                    return p, idx
                if best is None or (sty in fs):
                    best = (p, idx)
    return best


def measure(m):
    """{font, style, text} -> {width, cap, top, bottom}: per unit of (Size x frame height); found = font file found."""
    text = m.get("text") or "H"
    try:
        from PIL import ImageFont
        hit = find_font(m.get("font"), m.get("style"))
        if hit:
            f = ImageFont.truetype(hit[0], 1000, index=hit[1])
            x0, y0, x1, y1 = f.getbbox(text)
            cx0, cy0, cx1, cy1 = f.getbbox("H")
            k = TEXTPLUS_EM / 1000.0
            return {"found": True, "width": (x1 - x0) * k, "cap": (cy1 - cy0) * k, "top": (cy0 - y0) * k, "bottom": (y1 - cy1) * k}
    except Exception:
        pass
    # unknown font: average display-serif capitals
    return {"found": False, "width": 0.19 * len(text), "cap": 0.21, "top": 0.0, "bottom": 0.0}


if __name__ == "__main__":
    try:
        if len(sys.argv) > 1 and sys.argv[1] == "measure":
            emit(measure(json.loads(sys.stdin.readline())))
            sys.exit(0)
        main()
    except Exception as e:  # noqa: BLE001
        emit({"error": str(e)})
        sys.exit(1)
