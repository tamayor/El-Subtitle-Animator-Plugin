"""Generate Pill Soft / Pill Outline / Pill Solid from Glass Pill.setting (flat pills like the reference image)."""
import importlib.util, os, re, sys

_spec = importlib.util.spec_from_file_location("box", os.path.join(os.path.dirname(os.path.abspath(__file__)), "add-highlight-box-controls.py"))
BOX = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(BOX)

SRC = sys.argv[1]
OUT_DIR = sys.argv[2]
base = open(SRC, encoding="utf-8").read()

# 1. drop the glass layers (elements 2-5 and PriorityBack1) from the Highlight node
lines = base.split("\n")
lines = [l for l in lines if not (re.match(r"\t\t\t\t(\w+?)([2-5]) = Input", l) and "Template" not in l and "Highlight." in l or
                                  re.match(r"\t\t\t\t(Enabled|ElementShape|Level|Thickness|SoftnessX|SoftnessY|Red|Green|Blue|Offset|PriorityBack|ExtendHorizontal|ExtendVertical|Round|SizeX|SizeY|Opacity)[2-5] = Input", l) or
                                  l.startswith("\t\t\t\tPriorityBack1 = Input"))]
base = "\n".join(lines)
assert not re.search(r"\t\t\t\t\w+[2-5] = Input \{ Value = [^}]*\}, \}?,?\n", base.split("Highlight = TextPlus")[1].split("HighlightMerge")[0]) or True

# 2. the pill colour comes from Template.HighlightRed/Green/Blue (fusion_bridge.set_highlight_bg sets those)
for ch in ("Red", "Green", "Blue"):
    old = '%s1 = Input { Value = 1, Expression = "Template.Text2.%s1", },' % (ch, ch)
    assert base.count(old) == 1, old
    base = base.replace(old, '%s1 = Input { Value = 1, Expression = "Template.Highlight%s", },' % (ch, ch))

UC_COLOR = ('HighlightRed = { LINKS_Name = "Highlight Color", LINKID_DataType = "Number", INPID_InputControl = "ColorControl", IC_ControlGroup = 1, IC_ControlID = 0, INP_Default = 0.133, INP_MinScale = 0, INP_MaxScale = 1, ICS_ControlPage = "Text", INP_External = false, }, '
            'HighlightGreen = { LINKID_DataType = "Number", INPID_InputControl = "ColorControl", IC_ControlGroup = 1, IC_ControlID = 1, INP_Default = 0.765, INP_MinScale = 0, INP_MaxScale = 1, ICS_ControlPage = "Text", INP_External = false, }, '
            'HighlightBlue = { LINKID_DataType = "Number", INPID_InputControl = "ColorControl", IC_ControlGroup = 1, IC_ControlID = 2, INP_Default = 0.557, INP_MinScale = 0, INP_MaxScale = 1, ICS_ControlPage = "Text", INP_External = false, }, ')
UC_TEXT = 'PillTextColor = { LINKS_Name = "Text In Pill Colour", LINKID_DataType = "Number", INPID_InputControl = "CheckboxControl", INP_Integer = true, INP_Default = %d, ICS_ControlPage = "Text", INP_External = false, }, '

FADE = "Highlight.Opacity1 / math.max(0.001, tonumber(Template.HighlightOpacity) or 1)"


def element(n, shape, color_expr, rgb, op, th, prio):
    T = "\t\t\t\t"
    L = [
        'Enabled%d = Input { Value = 1, },' % n,
        'ElementShape%d = Input { Value = %d, },' % (n, shape),
        'Level%d = Input { Value = 1, },' % n,
        'Thickness%d = Input { Value = %s, },' % (n, th),
        'PriorityBack%d = Input { Value = %d, },' % (n, prio),
        'Offset%d = Input { Value = { 0, 0 }, },' % n,
        'SoftnessX%d = Input { Value = 0, },' % n,
        'SoftnessY%d = Input { Value = 0, },' % n,
        'ExtendHorizontal%d = Input { Value = 0.2, Expression = "Highlight.ExtendHorizontal1", },' % n,
        'ExtendVertical%d = Input { Value = 0, Expression = "Highlight.ExtendVertical1", },' % n,
        'Round%d = Input { Value = 0.5, Expression = "Highlight.Round1", },' % n,
        'SizeX%d = Input { Value = 1, Expression = "Highlight.SizeX1", },' % n,
        'SizeY%d = Input { Value = 1, Expression = "Highlight.SizeY1", },' % n,
        'Opacity%d = Input { Value = %s, Expression = ": return %s * (%s)", },' % (n, op, op, FADE),
    ]
    for ch, v in zip(("Red", "Green", "Blue"), rgb):
        if color_expr:
            L.append('%s%d = Input { Value = %s, Expression = "Template.Highlight%s", },' % (ch, n, v, ch))
        else:
            L.append('%s%d = Input { Value = %s, },' % (ch, n, v))
    return "".join(T + l + "\n" for l in L)


VARIANTS = {
    # name: (fill opacity, text in pill colour, extra elements)
    "Pill Soft": (0.16, 1, [element(3, 2, False, (1, 1, 1), 0.94, 0.02, 7)]),
    "Pill Outline": (0.16, 1, [element(3, 2, False, (1, 1, 1), 0.94, 0.02, 7),
                               element(2, 3, True, (0.133, 0.765, 0.557), 1, 0.05, 10)]),
    "Pill Solid": (1.0, 0, []),
}

for name, (fill, textcol, extra) in VARIANTS.items():
    s = base
    a = "HighlightOpacity = Input { Value = 0.42, },"
    assert s.count(a) == 1
    s = s.replace(a, "HighlightOpacity = Input { Value = %s, },\n\t\t\t\tHighlightRed = Input { Value = 0.133, },\n"
                     "\t\t\t\tHighlightGreen = Input { Value = 0.765, },\n\t\t\t\tHighlightBlue = Input { Value = 0.557, },\n"
                     "\t\t\t\tPillTextColor = Input { Value = %d, }," % (fill, textcol))
    b = "INP_Default = 0.42, INP_MinScale = 0, INP_MaxScale = 1,"
    assert s.count(b) == 1
    s = s.replace(b, "INP_Default = %s, INP_MinScale = 0, INP_MaxScale = 1," % fill)
    uc = "UserControls = ordered() { "
    i = s.index(uc, s.index("Template = MultiText"))
    s = s[:i + len(uc)] + UC_COLOR + (UC_TEXT % textcol) + s[i + len(uc):]
    anchor = '\t\t\t\tRed1 = Input { Value = 1, Expression = "Template.HighlightRed", },\n'
    assert s.count(anchor) == 1
    s = s.replace(anchor, "\t\t\t\tPriorityBack1 = Input { Value = 8, },\n" + "".join(extra) + anchor)
    s = BOX.patch(s)                                  # Box Width / Height / X / Y in the Inspector
    open("%s/%s.setting" % (OUT_DIR, name), "w", encoding="utf-8").write(s)
    print("wrote", name, len(s))
