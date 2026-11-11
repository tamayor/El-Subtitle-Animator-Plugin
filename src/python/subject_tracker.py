"""Track Subject: follows one subject through a folder of exported frames (src/main/subject-track.js).

Runs in the app's private tracker venv (OpenCV contrib + numpy), never in Resolve's Python. Input is one JSON line on
stdin: {dir, frames: [timeline frame, ...] (file = dir/f<frame>.jpg), anchor: timeline frame, box: [x, y, w, h] 0..1
of the picture (top-left origin)}. The tracker starts on the anchor frame's box and runs forward to the last frame and
backward to the first. Progress lines go to stdout as {"progress": done, "total": n}; the last line is
{"track": {frame: [cx, cy, w, h, ok, angle]}} (0..1, top-left origin) with the lost frames holding the last good box.
angle = the subject's in-picture rotation since the anchor frame, in degrees (clockwise on screen = positive): feature
points inside the box are followed frame to frame (optical flow) and a rotation + scale + move fit to them.
"""
import json
import os
import sys


def _log(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def _new_tracker(cv2):
    for name in ("TrackerCSRT_create", "TrackerKCF_create"):
        fn = getattr(cv2, name, None)
        if fn is None and hasattr(cv2, "legacy"):
            fn = getattr(cv2.legacy, name, None)
        if fn is not None:
            return fn()
    return cv2.TrackerMIL_create()


def _points(cv2, np, gray, box):
    """Corners inside the box (a little inset, so the background at its edges counts less)."""
    x, y, w, h = box
    H, W = gray.shape[:2]
    mask = np.zeros((H, W), np.uint8)
    x0, y0 = int(max(0, x + w * 0.1)), int(max(0, y + h * 0.1))
    x1, y1 = int(min(W, x + w * 0.9)), int(min(H, y + h * 0.9))
    if x1 - x0 < 4 or y1 - y0 < 4:
        return None
    mask[y0:y1, x0:x1] = 255
    return cv2.goodFeaturesToTrack(gray, maxCorners=80, qualityLevel=0.01, minDistance=5, mask=mask)


def _turn(cv2, np, prev_gray, gray, pts):
    """Degrees the points turned between the two frames (clockwise on screen = positive), or None."""
    if pts is None or len(pts) < 6:
        return None
    nxt, st, _ = cv2.calcOpticalFlowPyrLK(prev_gray, gray, pts, None, winSize=(21, 21), maxLevel=3)
    if nxt is None:
        return None
    good = st.reshape(-1) == 1
    if good.sum() < 6:
        return None
    m, inl = cv2.estimateAffinePartial2D(pts[good], nxt[good], method=cv2.RANSAC, ransacReprojThreshold=3.0)
    if m is None or inl is None or inl.sum() < 5:
        return None
    import math
    a = math.degrees(math.atan2(m[1, 0], m[0, 0]))      # y points down in the picture: positive = clockwise
    return a if abs(a) < 15 else None                   # a big jump in one frame is a bad fit, not a turn


def _run(cv2, frames, path_of, anchor_img, box_px, size, report):
    """Tracks over `frames` (in order) starting from box_px on anchor_img. Returns {frame: (x, y, w, h, ok, angle)}
    in pixels / degrees."""
    import numpy as np
    W, H = size
    tr = _new_tracker(cv2)
    tr.init(anchor_img, tuple(int(round(v)) for v in box_px))
    last = tuple(box_px)
    w0, h0 = box_px[2], box_px[3]
    out = {}
    angle = 0.0
    prev_gray = cv2.cvtColor(anchor_img, cv2.COLOR_BGR2GRAY)
    prev_box = tuple(box_px)
    for f in frames:
        img = cv2.imread(path_of(f))
        ok, b = (False, None) if img is None else tr.update(img)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img is not None else None
        if gray is not None:
            da = _turn(cv2, np, prev_gray, gray, _points(cv2, np, prev_gray, prev_box))
            if da is not None:
                angle += da
        if ok:
            x, y, w, h = [float(v) for v in b]
            cx, cy = x + w / 2, y + h / 2
            lx, ly = last[0] + last[2] / 2, last[1] + last[3] / 2
            # a box that jumps more than its own size in one frame, shrinks / grows 2x or leaves the picture is lost
            jump = max(abs(cx - lx) / max(1.0, last[2]), abs(cy - ly) / max(1.0, last[3]))
            grow = (w * h) / max(1.0, w0 * h0)
            inside = -w / 2 <= cx <= W + w / 2 and -h / 2 <= cy <= H + h / 2
            if jump > 1.0 or grow > 4.0 or grow < 0.25 or not inside or w < 2 or h < 2:
                ok = False
        if ok:
            last = (x, y, w, h)
            out[f] = (x, y, w, h, 1, angle)
        else:
            out[f] = (last[0], last[1], last[2], last[3], 0, angle)
        if gray is not None:
            prev_gray, prev_box = gray, last
        report()
    return out


def main():
    req = json.loads(sys.stdin.readline() or "{}")
    import cv2
    d = req["dir"]
    frames = sorted(int(f) for f in req["frames"])
    anchor = int(req["anchor"])
    if anchor not in frames:
        anchor = min(frames, key=lambda f: abs(f - anchor))
    path_of = lambda f: os.path.join(d, "f%d.jpg" % f)
    img0 = cv2.imread(path_of(anchor))
    if img0 is None:
        raise RuntimeError("The first frame could not be read")
    H, W = img0.shape[:2]
    bx, by, bw, bh = [float(v) for v in req["box"]]
    box_px = (bx * W, by * H, max(4.0, bw * W), max(4.0, bh * H))
    total = len(frames)
    done = [1]
    step = max(1, total // 50)

    def report():
        done[0] += 1
        if done[0] % step == 0 or done[0] == total:
            _log({"progress": done[0], "total": total})

    track = {anchor: (box_px[0], box_px[1], box_px[2], box_px[3], 1, 0.0)}
    fwd = [f for f in frames if f > anchor]
    back = [f for f in reversed(frames) if f < anchor]
    track.update(_run(cv2, fwd, path_of, img0, box_px, (W, H), report))
    track.update(_run(cv2, back, path_of, img0, box_px, (W, H), report))
    out = {}
    for f, (x, y, w, h, ok, a) in track.items():
        out[str(f)] = [round((x + w / 2) / W, 6), round((y + h / 2) / H, 6), round(w / W, 6), round(h / H, 6), ok, round(a, 3)]
    _log({"track": out, "width": W, "height": H})


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # reported to the panel as the error
        _log({"error": str(e) or e.__class__.__name__})
        sys.exit(1)
