#!/usr/bin/env python3
"""Measure a Here-with-Jo style lower third on a rendered frame and say how far to nudge the role line(s).

The rule (user, 2026-11-11): the role block hangs off the NAME'S INK, not off fixed numbers --
  * x: no tail under the first letter (G of "Grandpa", S, M, ...): the role starts at the first letter's left
       edge just above the baseline (its body, not a top flourish).
       The first letter hangs a tail below the baseline (J of "Joanna", Y, g, j ...): the role tucks in to the
       RIGHT of that tail, CLEAR x name-cap-height away from it, so the tail cradles the role line.
  * y: the first role line's cap top sits GAP x name-cap-height below the name's BASELINE (the line the
       lowercase letters stand on; descenders hang below it beside the role).
  * further role lines keep their own pitch (they move together with line 1).

Usage:  lower-third-align.py FRAME.jpg [--region x0,y0,x1,y1] [--gap 0.37] [--clear 0.32] [--crop x0,y0,x1,y1]
FRAME = get_frame image at a moment when the name and the role line(s) are fully in (end of the clip).
Prints the measurements and the Edit-page nudge for EVERY role clip: Pan += dx, Tilt += dy (pixels of a
1920x1080 timeline). Name colour: white; role colour: peach #FFD9A8.
"""
import argparse
from collections import Counter
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("frame")
ap.add_argument("--clear", type=float, default=0.32, help="role gap to a left tail, x name cap height")
ap.add_argument("--gap", type=float, default=0.37, help="role cap top below the baseline, x name cap height")
ap.add_argument("--region", default="0,0.2,0.6,0.8", help="x0,y0,x1,y1 (0..1) to search: tighten it around the super on busy backgrounds")
ap.add_argument("--crop", help="x0,y0,x1,y1 of the video inside a screenshot")
a = ap.parse_args()

im = Image.open(a.frame).convert("RGB")
if a.crop:
    im = im.crop(tuple(int(v) for v in a.crop.split(",")))
W, H = im.size
S = 1920 / W  # pixels -> timeline pixels
px = im.load()

def is_name(p):  # white text
    return min(p) >= 232 and max(p) - min(p) <= 22

def is_role(p):  # peach #FFD9A8
    r, g, b = p
    return r >= 215 and 165 <= g <= 238 and 110 <= b <= 205 and r - b >= 35 and g - b >= 15

rx0, ry0, rx1, ry1 = (float(v) for v in a.region.split(","))
X0, X1, Y0, Y1 = int(W * rx0), int(W * rx1), int(H * ry0), int(H * ry1)
name = [(x, y) for y in range(Y0, Y1) for x in range(X0, X1) if is_name(px[x, y])]
if not name:
    raise SystemExit("no white name ink found on the left side")
cols = {}
for x, y in name:
    lo, hi = cols.get(x, (y, y))
    cols[x] = (min(lo, y), max(hi, y))
cols = {x: v for x, v in cols.items() if sum(1 for xx in (x - 1, x + 1) if xx in cols)}  # drop specks
bottoms = Counter((hi // 2) * 2 for lo, hi in cols.values())
baseline = max(bottoms.items(), key=lambda kv: (kv[1], kv[0]))[0] + 1
top = min(lo for lo, hi in cols.values())
cap = baseline - top
band = (baseline - 0.35 * cap, baseline - 0.06 * cap)
body_left = min(x for x, y in name if band[0] <= y <= band[1] and x in cols)
name_right = max(cols)
tail = [x for x, y in name if y > baseline + 0.2 * cap and x < body_left + 0.6 * cap and x in cols]
target_left = max(body_left, max(tail) + a.clear * cap) if tail else body_left

role = [(x, y) for y in range(int(baseline - 0.1 * cap), Y1) for x in range(X0, X1) if is_role(px[x, y])]
if not role:
    raise SystemExit("no peach role ink found under the name")
rows = sorted({y for x, y in role})
lines, cur = [], [rows[0]]
for y in rows[1:]:
    if y - cur[-1] > 2:
        lines.append(cur); cur = [y]
    else:
        cur.append(y)
lines.append(cur)
lines = [l for l in lines if len(l) >= max(3, 0.2 * cap)]  # real text rows only (drops background specks)
if not lines:
    raise SystemExit("no role text line found: tighten --region")
keep = {y for l in lines for y in l}
role = [(x, y) for x, y in role if y in keep]
role_left = min(x for x, y in role)
role_top = lines[0][0]
role_cap = lines[0][-1] - lines[0][0]

dx = (target_left - role_left) * S
dy_img = (baseline + a.gap * cap) - role_top
print(f"frame {W}x{H}  (x{S:.3f} to timeline px)")
print(f"name: cap top {top*S:.0f}  baseline {baseline*S:.0f}  cap height {cap*S:.0f}  body left {body_left*S:.0f}  right {name_right*S:.0f}")
print(f"first-letter tail: {'right edge %.0f' % (max(tail)*S) if tail else 'none'}  -> role left target {target_left*S:.0f}")
print(f"role: {len(lines)} line(s)  left {role_left*S:.0f}  first cap top {role_top*S:.0f}  cap {role_cap*S:.0f}"
      f"  gap now {(role_top-baseline)/cap:.2f} x cap (target {a.gap:.2f})")
print(f"NUDGE every role clip: Pan {dx:+.0f}  Tilt {-dy_img*S:+.0f}")
