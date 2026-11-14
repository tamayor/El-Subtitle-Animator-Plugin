"""B-roll helpers on the subject matte (src/main/broll-footage.js), run in the app's tracker venv (OpenCV + numpy).

Reads one JSON line on stdin and prints one JSON line:
  {"op": "prep", "image": file, "dir": d}
      a picture as d/f0.jpg (longest side at most 1920), ready for subject_matte.py -> {width, height}
  {"op": "crop", "png": cut-out, "out": file, "pad"?: px}
      the cut-out cropped to what is not transparent -> {box: [x, y, w, h] (0..1 of the frame), width, height}
  {"op": "outline", "dir": d, "picks": [index, ...], "points"?: 72}
      the subject's outline in d/c%05d.png for each index: `points` points clockwise from the top of the head, 0..1 of
      the frame, so two outlines can be blended point by point -> {outlines: [[[x, y], ...] | null, ...], box, headTop, cx}
"""
import json
import os
import sys

import cv2
import numpy as np


def alpha_of(png):
    img = cv2.imread(png, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise RuntimeError("cannot read " + png)
    if img.ndim < 3 or img.shape[2] < 4:
        return img, np.full(img.shape[:2], 255, np.uint8)
    return img, img[:, :, 3]


def outline_of(alpha, points):
    """The biggest solid piece's outline, resampled to `points` points by arc length, clockwise from its topmost point."""
    h, w = alpha.shape
    solid = (alpha > 127).astype(np.uint8)
    k = max(3, int(round(min(w, h) / 120.0)) | 1)
    solid = cv2.morphologyEx(solid, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))
    cs, _ = cv2.findContours(solid, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not cs:
        return None
    c = max(cs, key=cv2.contourArea)[:, 0, :].astype(np.float64)
    if len(c) < 8 or cv2.contourArea(c.astype(np.float32)) < 0.004 * w * h:
        return None
    if cv2.contourArea(c.astype(np.float32), oriented=True) < 0:       # image y runs down: positive = clockwise on screen
        c = c[::-1]
    c = np.roll(c, -int(np.argmin(c[:, 1])), axis=0)
    seg = np.hypot(*(np.roll(c, -1, axis=0) - c).T)
    acc = np.concatenate([[0.0], np.cumsum(seg)])
    at = np.linspace(0.0, acc[-1], points, endpoint=False)
    closed = np.vstack([c, c[:1]])
    xs = np.interp(at, acc, closed[:, 0]) / w
    ys = np.interp(at, acc, closed[:, 1]) / h
    # a light smoothing: the matte's edge is jagged at pixel scale, a drawn line is not
    for arr in (xs, ys):
        arr[:] = (np.roll(arr, 1) + 2 * arr + np.roll(arr, -1)) / 4.0
    return [[round(float(x), 4), round(float(y), 4)] for x, y in zip(xs, ys)]


def main():
    a = json.loads(sys.stdin.readline())
    op = a.get("op")
    if op == "prep":
        img = cv2.imread(a["image"], cv2.IMREAD_COLOR)
        if img is None:
            raise RuntimeError("cannot read the picture (PNG, JPG and WebP work)")
        h, w = img.shape[:2]
        s = min(1.0, 1920.0 / max(w, h))
        if s < 1.0:
            img = cv2.resize(img, (int(round(w * s)) // 2 * 2, int(round(h * s)) // 2 * 2), interpolation=cv2.INTER_AREA)
        os.makedirs(a["dir"], exist_ok=True)
        cv2.imwrite(os.path.join(a["dir"], "f0.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 95])
        return {"width": int(img.shape[1]), "height": int(img.shape[0])}
    if op == "crop":
        img, al = alpha_of(a["png"])
        h, w = al.shape
        ys, xs = np.nonzero(al > 12)
        if not len(xs):
            raise RuntimeError("nothing was cut out (no person found)")
        pad = int(a.get("pad") or 6)
        x0, y0, x1, y1 = max(0, xs.min() - pad), max(0, ys.min() - pad), min(w, xs.max() + 1 + pad), min(h, ys.max() + 1 + pad)
        cv2.imwrite(a["out"], img[y0:y1, x0:x1], [cv2.IMWRITE_PNG_COMPRESSION, 3])
        return {"box": [x0 / w, y0 / h, (x1 - x0) / w, (y1 - y0) / h], "width": int(w), "height": int(h)}
    if op == "outline":
        n = max(16, min(240, int(a.get("points") or 72)))
        outs, box, tops, cxs = [], None, [], []
        for i in a["picks"]:
            _, al = alpha_of(os.path.join(a["dir"], "c%05d.png" % int(i)))
            h, w = al.shape
            o = outline_of(al, n)
            outs.append(o)
            ys, xs = np.nonzero(al > 127)
            if len(xs):
                b = (xs.min() / w, ys.min() / h, xs.max() / w, ys.max() / h)
                box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
                tops.append(ys.min() / h)
                cxs.append(float(xs.mean()) / w)
        return {"outlines": outs, "box": [box[0], box[1], box[2] - box[0], box[3] - box[1]] if box else None,
                "headTop": float(np.median(tops)) if tops else None, "cx": float(np.median(cxs)) if cxs else None}
    raise RuntimeError("unknown op %r" % (op,))


if __name__ == "__main__":
    try:
        sys.stdout.write(json.dumps(main()) + "\n")
    except Exception as e:  # noqa: BLE001
        sys.stdout.write(json.dumps({"error": str(e)}) + "\n")
        sys.exit(1)
