"""Generate "Glass Blur (ML).setting" from Glass Pill.setting.

The title half of the Glass Blur preset: Upper / Emphasis / Lower rows, every word fading in softly (8-frame ramp
instead of Glass Pill's 5), and a light glass skin on the emphasis pill (faint milky fill, bright rim, soft shadow).
The real frosted glass (Displace + Gaussian Blur + vibrancy of the footage behind the pill) is NOT in this title:
titles cannot see the clips under them. The bridge adds the "ELSA Glass" Fusion effect (src/main/effect-presets.js)
to the footage clip(s) under the caption and copies the pill's text / font / size / row position / timing into it
(fusion_bridge.glass_sync). The Template's Glass* inputs are its settings (the panel's Clip controls) and mark the
preset as a glass preset.

usage: python3 tools/gen-glass-blur.py "<data>/presets/current/Glass Pill.setting" "<out .setting>"
"""
import re
import sys

SRC, OUT = sys.argv[1], sys.argv[2]
s = open(SRC, encoding="utf-8").read()


def sub1(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, (old, n)
    s = s.replace(old, new)


# 1. soft word-by-word fade on every row: 5 -> 8 frame ramp (fusion_bridge.anim_spec reads the ramp from the expression)
ramps = re.findall(r"\(tonumber\(Template\.Seg\dStart\) or 0\)\) / 5\\n", s)
assert len(ramps) == 6, len(ramps)          # Opacity1 + WordOffset on Upper / Emphasis / Lower followers
s = re.sub(r"(\(tonumber\(Template\.Seg\dStart\) or 0\)\) / )5(\\n)", r"\g<1>8\2", s)

# 2. glass skin on the pill: fill 0.42 -> 0.14 (Accent Opacity), rim 0.55 -> 0.5, inner fill 0.16 -> 0.05, shadow 0.3 -> 0.16
sub1("HighlightOpacity = Input { Value = 0.42, },", "HighlightOpacity = Input { Value = 0.14, },")
sub1("INP_Default = 0.42, INP_MinScale = 0, INP_MaxScale = 1,", "INP_Default = 0.14, INP_MinScale = 0, INP_MaxScale = 1,")
for old, new in (("0.55", "0.5"), ("0.16", "0.05"), ("0.3", "0.16")):
    sub1('Value = %s, Expression = ": return %s * (Highlight.Opacity1' % (old, old),
         'Value = %s, Expression = ": return %s * (Highlight.Opacity1' % (new, new))

# 3. glass settings on the Template (shown in the panel's Clip controls; hidden in Resolve's Inspector by addon-controls)
GLASS = [
    # id, label, default, min, max, tip
    ("GlassFrost", "Glass Frost", 22, 0, 60, "How frosted the footage behind the pill is (Gaussian Blur size)"),
    ("GlassBend", "Glass Bend", 0.06, 0, 0.3, "Lens bend at the pill's edges (Displace refraction)"),
    ("GlassVibrancy", "Glass Vibrancy", 1.3, 0.5, 2, "Colour saturation behind the glass (1 = unchanged)"),
    ("GlassBright", "Glass Brightness", 0.05, -0.3, 0.3, "Brightness added behind the glass"),
]
uc = "UserControls = ordered() { "
i = s.index(uc, s.index("Template = MultiText"))
ctl = "".join('%s = { LINKS_Name = "%s", LINKID_DataType = "Number", INPID_InputControl = "SliderControl", INP_Default = %s, '
              'INP_MinScale = %s, INP_MaxScale = %s, ICS_ControlPage = "Text", INP_External = false, INPS_StatusText = "%s", }, '
              % g for g in GLASS)
s = s[:i + len(uc)] + ctl + s[i + len(uc):]
anchor = "\t\t\t\tHighlightOpacity = Input { Value = 0.14, },\n"
s = s.replace(anchor, anchor + "".join("\t\t\t\t%s = Input { Value = %s, },\n" % (g[0], g[2]) for g in GLASS))

open(OUT, "w", encoding="utf-8").write(s)
print("wrote", OUT, len(s))
