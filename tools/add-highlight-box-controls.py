"""Give highlight presets Inspector controls for their box: Box Width / Box Height (x the preset's box) and
Box X / Box Y (added to the box's Offset). Usage: python3 add-highlight-box-controls.py <preset.setting>...

- Template (the MultiText) gets user controls HighlightWidth / HighlightHeight / HighlightX / HighlightY on the Text page.
- The box (the "Highlight" Text+, or its HighlightFollower when the box is drawn per letter by a Follower) gets
  SizeX1 / SizeY1 multiplied by Template.HighlightWidth / HighlightHeight and every box element's Offset moved by
  Template.HighlightX / HighlightY. Expressions only read Template, never the tool's own Text (see the Follower
  self-reference crash). Elements 2-8 that follow Highlight.SizeX1 keep following it.
Running it again on a patched file changes nothing. fusion_bridge.hl_set writes these controls for the panel's
HIGHLIGHT_BOX sliders, so the panel and the Inspector show the same values.
"""
import re
import sys

CTRL = (
    'HighlightWidth = { LINKS_Name = "Box Width", LINKID_DataType = "Number", INPID_InputControl = "SliderControl", INP_Default = 1, INP_MinScale = 0.5, INP_MaxScale = 2, INP_MinAllowed = 0.05, INP_MaxAllowed = 5, ICS_ControlPage = "Text", INP_External = false, INPS_StatusText = "Width of the highlight box, x the preset\'s", }, '
    'HighlightHeight = { LINKS_Name = "Box Height", LINKID_DataType = "Number", INPID_InputControl = "SliderControl", INP_Default = 1, INP_MinScale = 0.5, INP_MaxScale = 2, INP_MinAllowed = 0.05, INP_MaxAllowed = 5, ICS_ControlPage = "Text", INP_External = false, INPS_StatusText = "Height of the highlight box, x the preset\'s", }, '
    'HighlightX = { LINKS_Name = "Box X", LINKID_DataType = "Number", INPID_InputControl = "SliderControl", INP_Default = 0, INP_MinScale = -0.3, INP_MaxScale = 0.3, ICS_ControlPage = "Text", INP_External = false, INPS_StatusText = "Move the highlight box right (+) / left (-)", }, '
    'HighlightY = { LINKS_Name = "Box Y", LINKID_DataType = "Number", INPID_InputControl = "SliderControl", INP_Default = 0, INP_MinScale = -0.3, INP_MaxScale = 0.3, ICS_ControlPage = "Text", INP_External = false, INPS_StatusText = "Move the highlight box up (+) / down (-)", }, '
)
MUL = {"SizeX": "(tonumber(Template.HighlightWidth) or 1)", "SizeY": "(tonumber(Template.HighlightHeight) or 1)"}


def block(s, name):
    """(start, end) of the top-level tool block 'name = Type {' ... its closing brace."""
    m = re.search(r"\n\t\t%s = \w+ \{" % re.escape(name), s)
    if not m:
        return None
    i, depth = m.end() - 1, 0
    for j in range(i, len(s)):
        if s[j] == "{":
            depth += 1
        elif s[j] == "}":
            depth -= 1
            if depth == 0:
                return m.start(), j + 1
    raise ValueError("unclosed block " + name)


def patch_size(body, k):
    """SizeX1 / SizeY1: the preset's value or expression times the control."""
    pat = re.compile(r'(\t\t\t\t%s1 = Input \{ Value = ([-\d.]+), )(Expression = "((?:[^"\\]|\\.)*)", )?\},' % k)
    m = pat.search(body)
    if not m:
        return body
    expr = m.group(4)
    if expr and "Template.Highlight" in expr:
        return body                                          # already patched
    if expr is None:
        new = ": return %s * %s" % (m.group(2), MUL[k])
    elif expr.startswith(":"):
        i = expr.rfind("\\nreturn ")
        if i < 0 and expr.startswith(": return "):
            new = ": return (%s) * %s" % (expr[len(": return "):], MUL[k])
        elif i < 0:
            raise ValueError("no final return in %s1 expression" % k)
        else:
            new = expr[:i] + "\\nreturn (" + expr[i + len("\\nreturn "):] + ") * " + MUL[k]
    elif re.fullmatch(r"\s*\w+\.%s\d+\s*" % k, expr):
        return body                                          # follows another element / tool
    else:
        new = ": return (%s) * %s" % (expr, MUL[k])
    # new is already in the file's escaped form (the preset's own expression is kept as written)
    return body[:m.start()] + m.group(1) + 'Expression = "%s", },' % new + body[m.end():]


def patch_offsets(body, elements=None):
    """OffsetN (no expression yet): moved by the Box X / Box Y controls."""
    pat = re.compile(r'\t\t\t\tOffset(\d) = Input \{ Value = \{ ([-\d.]+), ([-\d.]+) \}, \},')

    def rep(m):
        if elements is not None and m.group(1) not in elements:
            return m.group(0)
        x, y = m.group(2), m.group(3)
        return ('\t\t\t\tOffset%s = Input { Value = { %s, %s }, Expression = "Point(%s + Template.HighlightX, %s + Template.HighlightY)", },'
                % (m.group(1), x, y, x, y))
    return pat.sub(rep, body)


def patch(s):
    # 1. the controls on Template, after the highlight colour when there is one
    t = block(s, "Template")
    tpl = s[t[0]:t[1]]
    if "HighlightWidth = {" not in tpl:
        u = tpl.index("UserControls = ordered() { ") + len("UserControls = ordered() { ")
        m = re.search(r'HighlightBlue = \{[^{}]*\}, ', tpl)
        at = m.end() if m else u
        tpl = tpl[:at] + CTRL + tpl[at:]
        s = s[:t[0]] + tpl + s[t[1]:]
    # 2. the box: per letter through the Follower, or on the Highlight Text+ itself
    f = block(s, "HighlightFollower")
    if f:
        body = s[f[0]:f[1]]
        for k in ("SizeX", "SizeY"):
            body = patch_size(body, k)
        body = patch_offsets(body, {"1"})
        s = s[:f[0]] + body + s[f[1]:]
    else:
        h = block(s, "Highlight")
        body = s[h[0]:h[1]]
        for k in ("SizeX", "SizeY"):
            body = patch_size(body, k)
        body = patch_offsets(body)
        s = s[:h[0]] + body + s[h[1]:]
    return s


if __name__ == "__main__":
    for path in sys.argv[1:]:
        src = open(path, encoding="utf-8").read()
        out = patch(src)
        if out != src:
            open(path, "w", encoding="utf-8").write(out)
            print("patched", path)
        else:
            print("unchanged", path)
