"""Subject matte for Spotlight (src/main/spotlight.js): Robust Video Matting (ONNX, MobileNetV3) on the footage frames,
written as RGBA cut-outs (the footage where the person is, transparent elsewhere) plus the numbers the panel needs to
place the big word behind the head.

Runs in the app's tracker venv (onnxruntime + OpenCV + numpy). Reads one JSON line on stdin:
  {dir, frames: [timeline frames], model, out, feather?, downsample?}
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


def keep_subject(al):
    """Drops matte islands that are not the person: RVM sometimes keys bright signage / logos in the background. Keeps
    the components at least 12% the size of the largest one (the body, plus a detached hand or arm)."""
    h, w = al.shape
    small = cv2.resize(al, (w // 4, h // 4), interpolation=cv2.INTER_AREA)
    n, lab, st, _ = cv2.connectedComponentsWithStats((small > 0.3).astype(np.uint8), 8)
    if n <= 2:
        return al
    areas = st[1:, cv2.CC_STAT_AREA]
    big = areas.max()
    keep = np.zeros(n, np.uint8)
    keep[1:] = (areas >= 0.12 * big).astype(np.uint8)
    m = keep[lab] * 255
    m = cv2.dilate(m, np.ones((5, 5), np.uint8))
    m = cv2.resize(m, (w, h), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255.0
    return al * m


def main():
    a = json.loads(sys.stdin.readline())
    src_dir, frames, out = a["dir"], [int(f) for f in a["frames"]], a["out"]
    feather = float(a.get("feather", 1.0))
    os.makedirs(out, exist_ok=True)
    cancel = os.path.join(src_dir, "cancel")
    sess = session(a["model"])
    rec = [np.zeros((1, 1, 1, 1), np.float32)] * 4
    first = cv2.imread(os.path.join(src_dir, "f%d.jpg" % frames[0]))
    if first is None:
        raise RuntimeError("missing footage frame %d" % frames[0])
    H, W = first.shape[:2]
    # RVM's own guidance: downsample so the long side is ~512 px at HD (0.25 for 4K); quality vs speed
    ds = float(a.get("downsample") or min(1.0, 512.0 / max(W, H)))
    dsr = np.array([ds], np.float32)
    tops, cxs, per = [], [], []
    union = None
    t0 = time.time()
    n = len(frames)
    from concurrent.futures import ThreadPoolExecutor
    pool = ThreadPoolExecutor(4)        # PNG writes (~75 ms each at 1080x1920) overlap the next frame's matte
    pending = []
    for i, f in enumerate(frames):
        if os.path.exists(cancel):
            emit({"cancelled": True})
            return
        img = first if i == 0 else cv2.imread(os.path.join(src_dir, "f%d.jpg" % f))
        if img is None:
            raise RuntimeError("missing footage frame %d" % f)
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        src = np.ascontiguousarray(rgb.transpose(2, 0, 1)[None])
        fgr, pha, *rec = sess.run(None, {"src": src, "r1i": rec[0], "r2i": rec[1], "r3i": rec[2], "r4i": rec[3], "downsample_ratio": dsr})
        al = pha[0, 0]
        if feather > 0:
            al = cv2.GaussianBlur(al, (0, 0), feather)
        al = keep_subject(np.clip(al, 0, 1))
        top, cx = head_top(al)
        per.append([round(top, 4) if top is not None else None, round(cx, 4) if cx is not None else None])
        if top is not None:
            tops.append(top)
            cxs.append(cx)
        ys, xs = np.nonzero(al > 0.5)
        if len(xs):
            b = (xs.min(), ys.min(), xs.max(), ys.max())
            union = b if union is None else (min(union[0], b[0]), min(union[1], b[1]), max(union[2], b[2]), max(union[3], b[3]))
        # straight alpha: the original footage pixels (not RVM's predicted foreground, which shifts colour at edges)
        rgba = np.dstack([img, (al * 255.0 + 0.5).astype(np.uint8)])
        pending.append(pool.submit(cv2.imwrite, os.path.join(out, "c%05d.png" % i), rgba, [cv2.IMWRITE_PNG_COMPRESSION, 1]))
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
