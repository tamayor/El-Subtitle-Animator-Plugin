"""Light per-letter expressions for the segment MultiText presets, so their letters chase the clip's start on their own
(a head trim or a trimmed paste needs no panel).

The presets were generated with 4 Lua expressions per letter (Opacity1, WordSizeX, WordSizeY, WordOffset), each reading
Seg<n>Start + Seg<n>End + comp.RenderStart. A Follower evaluates them per letter every frame and Resolve lagged, so
fusion_bridge.key_followers turned them into keyframes at placement, which then sat at fixed comp frames and only the
panel could move them after a trim. This rewrites them in place to 2 per letter (fade + rise; the 0.82 -> 1 size pop
is dropped), each reading only Seg<n>Start and comp.RenderStart, with a fixed 5-frame ramp. Their last line is written
without spaces ("p*p*(3-2*p)", "q*q*q"), so fusion_bridge.anim_spec does not recognise them and they stay expressions.
Tested by the user as "Glass Pill (Live)" on 2026-11-09: no lag, follows trims with the panel closed.

The followers' Delay expressions (letter spread, evaluated once per frame) are left as they are.

usage: python3 tools/gen-light-letters.py "<El Subtitle Animator folder>" [preset name ...]
       (default: every segment preset; patches presets/current and presets/original; already light = left alone)
"""
import os, re, sys

ROOT = sys.argv[1]
NAMES = sys.argv[2:] or ["Glass Pill", "Highlight Select", "Pill Outline", "Pill Soft", "Pill Solid", "Soft Marker",
                         "Underline Draw"]
RAMP = 5
HEAVY = re.compile(r'^\t\t\t\t(Opacity1|WordSizeX|WordSizeY|WordOffset) = Input \{ Value = [^\n]*?Expression = '
                   r'": local S = tonumber\(Template\.Seg(\d+)Start\)[^\n]*$', re.M)


def light(inp, seg):
    head = (": local p = (time - comp.RenderStart - (tonumber(Template.Seg%dStart) or 0)) / %d\\n" % (seg, RAMP))
    if inp == "Opacity1":
        return ('\t\t\t\tOpacity1 = Input { Value = 1, Expression = "%sif p <= 0 then return 0 elseif p >= 1 then '
                'return 1 end\\nreturn p*p*(3-2*p)", },' % head)
    if inp == "WordOffset":
        return ('\t\t\t\tWordOffset = Input { Value = { 0, 0 }, Expression = "%sif p >= 1 then return Point(0, 0) end'
                '\\nif p < 0 then p = 0 end\\nlocal q = 1 - p\\nreturn Point(0, -0.035*q*q*q)", },' % head)
    return "\t\t\t\t%s = Input { Value = 1, }," % inp


def patch(s):
    return HEAVY.subn(lambda m: light(m.group(1), int(m.group(2))), s)


for name in NAMES:
    for d in ("current", "original"):
        f = os.path.join(ROOT, "presets", d, name + ".setting")
        if not os.path.exists(f):
            print("missing", d, name)
            continue
        s = open(f, encoding="utf-8").read()
        out, n = patch(s)
        if n:
            open(f, "w", encoding="utf-8").write(out)
        print("%-9s %-18s %d letter expressions made light" % (d, name, n))
