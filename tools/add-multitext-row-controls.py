"""Give MultiText presets (Upper / Emphasis / Lower rows) Inspector controls for the rows' layout.
Usage: python3 add-multitext-row-controls.py <preset.setting>...

Template (the MultiText) gets, on the Text page after the Box controls:
  Row Gap        space between the rows, in text lines (0 = the rows touch, negative = overlap). The same gap goes
                 above and below the emphasis, so the rows are always evenly spaced, whatever each row's Size,
                 number of lines, Line Spacing or Box Height.
  Justify        Manual (default) = the X sliders below place each row. Center / Left / Right line the rows up on
                 that edge (each layer's H Anchor and justification follow) and override the per-row X sliders;
                 the block stays where it was (recentred from an estimate of the widest row). All X still moves it.
  All X / All Y  move the three rows together.
  Link Rows      when on, the Upper / Emphasis / Lower X / Y sliders move every row (they are summed).
  Upper X / Y, Emphasis X / Y, Lower X / Y   move one row (Inspector Center units).
The layers' Center, H Anchor and justification inputs become expressions of these controls and of the layers' own
Size / LineSpacing and texts (read from the followers' Text inputs, never the followers' outputs), so the gap adapts
when the text is resized. Mirror Text+ tools that follow a layer's Center (the highlight box) follow its anchor too.
Row heights: one line of text is 0.36 x Size tall, further lines add 0.32 x Size x LineSpacing (measured on
Poppins, see memory textplus-size-glyph-widths); the gap is Row Gap x 0.32 x the two rows' mean Size. The Row Gap default is computed so the patched preset keeps its
original row positions. Running the tool again on a patched file changes nothing.
fusion_bridge.op_multitext_rows writes these controls for the plugin, so the panel and the Inspector agree.
"""
import re
import sys

CAP = 0.36          # ink height of one text line, x Size
PITCH = 0.32        # distance between two lines of one row at Line Spacing 1, x Size
ROLES = ("upper", "emphasis", "lower")

WIDTH_FN = (
    'local function W(s)\n'
    '  s = tostring(s or ""); local best = 0\n'
    '  for line in (s .. "\\n"):gmatch("(.-)\\n") do\n'
    '    local w = 0\n'
    '    for ch in line:gmatch("[%z\\1-\\127\\194-\\244][\\128-\\191]*") do\n'
    '      if ch == " " then w = w + 0.09\n'
    '      elseif ch:find("^[ijl!|\'.,:;]$") then w = w + 0.1\n'
    '      elseif ch:find("^[tfr]$") then w = w + 0.14\n'
    '      elseif ch:find("^[IJ]$") then w = w + 0.13\n'
    '      elseif ch:find("^[mw]$") then w = w + 0.33\n'
    '      elseif ch:find("^[MW]$") then w = w + 0.31\n'
    '      elseif ch:find("^[%u]$") then w = w + 0.24\n'
    '      elseif ch:find("^[%d]$") then w = w + 0.21\n'
    '      elseif ch:find("^[sczvxykg]$") then w = w + 0.19\n'
    '      elseif ch:find("^[-?]$") then w = w + 0.15\n'
    '      else w = w + 0.21 end\n'
    '    end\n'
    '    if w > best then best = w end\n'
    '  end\n'
    '  return best\n'
    'end\n'
)


def slider(idn, name, default, lo, hi, status, allowed=None):
    s = ('%s = { LINKS_Name = "%s", LINKID_DataType = "Number", INPID_InputControl = "SliderControl", INP_Default = %s, '
         'INP_MinScale = %s, INP_MaxScale = %s, ' % (idn, name, default, lo, hi))
    if allowed:
        s += 'INP_MinAllowed = %s, INP_MaxAllowed = %s, ' % allowed
    return s + 'ICS_ControlPage = "Text", INP_External = false, INPS_StatusText = "%s", }, ' % status


def controls(gap_default, bx, by):
    """The Inspector order: Row Gap, Link Rows, the Y group, the X group, then Justify right under the X sliders
    (it overrides them)."""
    return (
        slider("RowGap", "Row Gap", gap_default, -0.5, 2, "Space between the rows, in text lines (0 = touching; the same above and below the emphasis)", (-3, 6))
        + 'RowsLink = { LINKS_Name = "Link Rows", LINKID_DataType = "Number", INPID_InputControl = "CheckboxControl", INP_Integer = true, INP_Default = 0, '
          'ICS_ControlPage = "Text", INP_External = false, INPS_StatusText = "On: the Upper / Emphasis / Lower sliders move every row as one", }, '
        + slider("RowsY", "All Y", 0, -0.3, 0.3, "Move all rows up (+) / down (-)")
        + slider("UpperY", "Upper Y", 0, -0.3, 0.3, "Move the upper row up (+) / down (-)")
        + slider("EmphasisY", "Emphasis Y", 0, -0.3, 0.3, "Move the emphasis row up (+) / down (-)")
        + slider("LowerY", "Lower Y", 0, -0.3, 0.3, "Move the lower row up (+) / down (-)")
        + slider("RowsX", "All X", 0, -0.3, 0.3, "Move all rows right (+) / left (-)")
        + slider("UpperX", "Upper X", 0, -0.3, 0.3, "Move the upper row right (+) / left (-); overridden by Justify Center / Left / Right")
        + slider("EmphasisX", "Emphasis X", 0, -0.3, 0.3, "Move the emphasis row right (+) / left (-); overridden by Justify Center / Left / Right")
        + slider("LowerX", "Lower X", 0, -0.3, 0.3, "Move the lower row right (+) / left (-); overridden by Justify Center / Left / Right")
        + 'RowsJustify = { LINKS_Name = "Justify", LINKID_DataType = "Number", INPID_InputControl = "ComboControl", INP_Integer = true, INP_Default = 0, '
          '{ CCS_AddString = "Manual (X sliders)", }, { CCS_AddString = "Center", }, { CCS_AddString = "Left", }, { CCS_AddString = "Right", }, ICS_ControlPage = "Text", INP_External = false, '
          'INPS_StatusText = "Center / Left / Right line the rows up on that edge and override the Upper / Emphasis / Lower X sliders (All X still moves the block); Manual = the X sliders place each row", }, '
        + 'RowsBaseX = { LINKS_Name = "Rows Base X", LINKID_DataType = "Number", INPID_InputControl = "SliderControl", INP_Default = %s, INP_MinScale = 0, INP_MaxScale = 1, '
          'ICS_ControlPage = "Text", INP_External = false, IC_Visible = false, INPS_StatusText = "The preset\'s own centre of the emphasis row", }, ' % bx
        + 'RowsBaseY = { LINKS_Name = "Rows Base Y", LINKID_DataType = "Number", INPID_InputControl = "SliderControl", INP_Default = %s, INP_MinScale = 0, INP_MaxScale = 1, '
          'ICS_ControlPage = "Text", INP_External = false, IC_Visible = false, INPS_StatusText = "The preset\'s own centre of the emphasis row", }, ' % by
    )


CTRL_BLOCK = re.compile(r'RowGap = \{.*?RowsBaseY = \{[^{}]*\}, ', re.S)


def resync(tpl):
    """An already patched Template: the control block and the three Center expressions rewritten by the current tool
    (control values and the preset's geometry are kept)."""
    tpl = resync_controls(tpl)
    ls = layers_patched(tpl)
    roles = roles_of(ls)
    has_box = "HighlightHeight = {" in tpl
    m = CTRL_BLOCK.search(tpl)
    num = lambda k: float(re.search(k + r' = \{[^{}]*INP_Default = ([-\d.]+)', m.group(0)).group(1))
    gdef, bx, by = num("RowGap"), num("RowsBaseX"), num("RowsBaseY")
    for role in ROLES:
        n = roles[role]
        pat = re.compile(r'(\t\t\t\t\["Text%d\.Center"\] = Input \{ Value = \{ [-\d.]+, [-\d.]+ \}, Expression = )"(?:[^"\\]|\\.)*"(, \},)' % n)
        tpl, k = pat.subn(lambda mm: mm.group(1) + '"%s"' % esc(center_expr(role, ls, roles, has_box, gdef, bx, by)) + mm.group(2), tpl, count=1)
        if k != 1:
            raise ValueError("Text%d.Center expression not found" % n)
    return tpl


def layers_patched(tpl):
    """layers() for a patched Template, whose Center lines carry an expression."""
    out = {}
    for m in re.finditer(r'TextName(\d+) = Input \{ Value = "([^"]*)", \},', tpl):
        n = int(m.group(1))
        pre = r'\["Text%d\.' % n
        size = re.search(pre + r'Size"\] = Input \{ Value = ([-\d.]+), \},', tpl)
        cen = re.search(pre + r'Center"\] = Input \{ Value = \{ ([-\d.]+), ([-\d.]+) \}, ', tpl)
        ls = re.search(pre + r'LineSpacing"\] = Input \{ Value = ([-\d.]+), \},', tpl)
        src = re.search(pre + r'StyledText"\] = Input \{ SourceOp = "([^"]+)", Source = "StyledText", \},', tpl)
        if not size or not cen:
            continue
        out[n] = {"name": m.group(2), "size": float(size.group(1)), "center": (float(cen.group(1)), float(cen.group(2))),
                  "ls": float(ls.group(1)) if ls else 1.0,
                  "text": ("%s.Text.Value" % src.group(1)) if src else ("Template.Text%d.StyledText" % n)}
    return out


def resync_controls(tpl):
    """An already patched Template: its control block rewritten in the current order / wording (values kept)."""
    m = CTRL_BLOCK.search(tpl)
    if not m:
        return tpl
    old = m.group(0)
    num = lambda k: re.search(k + r' = \{[^{}]*INP_Default = ([-\d.]+)', old).group(1)
    return tpl[:m.start()] + controls(num("RowGap"), num("RowsBaseX"), num("RowsBaseY")) + tpl[m.end():]


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


def esc(lua):
    """A Lua chunk as the contents of a double-quoted string in a .setting file."""
    return lua.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def layers(tpl):
    """{n: {name, size, center, ls, text_ref}} for every Text<n> layer of the Template block."""
    out = {}
    for m in re.finditer(r'TextName(\d+) = Input \{ Value = "([^"]*)", \},', tpl):
        n = int(m.group(1))
        pre = r'\["Text%d\.' % n
        size = re.search(pre + r'Size"\] = Input \{ Value = ([-\d.]+), \},', tpl)
        cen = re.search(pre + r'Center"\] = Input \{ Value = \{ ([-\d.]+), ([-\d.]+) \}, \},', tpl)
        ls = re.search(pre + r'LineSpacing"\] = Input \{ Value = ([-\d.]+), \},', tpl)
        src = re.search(pre + r'StyledText"\] = Input \{ SourceOp = "([^"]+)", Source = "StyledText", \},', tpl)
        if not size or not cen:
            continue
        out[n] = {
            "name": m.group(2), "size": float(size.group(1)), "center": (float(cen.group(1)), float(cen.group(2))),
            "ls": float(ls.group(1)) if ls else 1.0,
            "text": ("%s.Text.Value" % src.group(1)) if src else ("Template.Text%d.StyledText" % n),
        }
    return out


def roles_of(ls):
    """{role: layer n}: by the layer names, else by height (upper = highest Center)."""
    by_name = {}
    for n, l in ls.items():
        nm = l["name"].strip().lower()
        for r in ROLES:
            if nm.startswith(r):
                by_name[r] = n
    if len(by_name) == 3:
        return by_name
    if len(ls) != 3:
        return None
    order = sorted(ls, key=lambda n: -ls[n]["center"][1])
    return dict(zip(ROLES, order))


def gap_default(ls, roles):
    """The Row Gap that reproduces the preset's own distances (mean of the two pairs)."""
    u, e, l = (ls[roles[r]] for r in ROLES)
    vals = []
    for a, b in ((u, e), (e, l)):
        d = abs(a["center"][1] - b["center"][1])
        half = (a["size"] + b["size"]) / 2 * CAP          # one line each: half heights add up to this
        unit = PITCH * (a["size"] + b["size"]) / 2
        vals.append((d - half) / unit if unit else 0)
    return round(sum(vals) / len(vals), 2)


def row_h(n, has_box_row):
    """Lua: the height of row n from its Size, its line count (the follower's text) and, for several lines, its
    Line Spacing (read only then: every Template input read costs about 0.15 ms per frame)."""
    s = ("local n%d = N(t%d)\nlocal H%d = S%d * (%s + (n%d > 1 and (n%d - 1) * %s * (tonumber(T.Text%d.LineSpacing) or 1) or 0))"
         % (n, n, n, n, CAP, n, n, PITCH, n))
    if has_box_row:
        s += " * (tonumber(T.HighlightHeight) or 1)"
    return s


def center_expr(role, ls, roles, has_box, gdef, bx, by):
    """The Lua expression of one row's Center, written to read as few Template inputs as possible (each read is a
    proxy call, ~0.15 ms per frame): a row reads only its own offsets unless Link Rows is on; the emphasis row
    estimates text widths only when Left / Right is active; every row places itself from the preset's base and the
    All sliders (no expression reads another layer's Center, so there is no evaluation chain inside the tool)."""
    u, e, l = roles["upper"], roles["emphasis"], roles["lower"]
    me = roles[role]
    own = {"upper": ("UpperX", "UpperY"), "emphasis": ("EmphasisX", "EmphasisY"), "lower": ("LowerX", "LowerY")}[role]
    L = [": local T = Template"]
    L.append("local lk = (tonumber(T.RowsLink) or 0) >= 0.5")
    L.append("local J = tonumber(T.RowsJustify) or 0")
    L.append("local ox, oy")
    L.append("if lk then ox = (tonumber(T.UpperX) or 0) + (tonumber(T.EmphasisX) or 0) + (tonumber(T.LowerX) or 0)")
    L.append("  oy = (tonumber(T.UpperY) or 0) + (tonumber(T.EmphasisY) or 0) + (tonumber(T.LowerY) or 0)")
    L.append("else ox, oy = tonumber(T.%s) or 0, tonumber(T.%s) or 0 end" % own)
    if role == "emphasis":
        L.append('local function N(s) s = tostring(s or ""); local n = 1; for _ in s:gmatch("\\n") do n = n + 1 end; return n end')
        L.append(WIDTH_FN.rstrip("\n"))
        L.append("if J >= 1 then ox = 0 end")
        L.append("local x = (tonumber(T.RowsBaseX) or %s) + (tonumber(T.RowsX) or 0) + ox" % bx)
        L.append("if J >= 2 then")
        L.append("  local a = (J == 2) and -1 or 1")
        for n in (u, e, l):
            L.append("  local t%d, S%d = %s, tonumber(T.Text%d.Size) or %s" % (n, n, ls[n]["text"], n, ls[n]["size"]))
        L.append('  local okw, fw = pcall(function() return comp:GetPrefs("Comp.FrameFormat.Width") end)')
        L.append('  local okh, fh = pcall(function() return comp:GetPrefs("Comp.FrameFormat.Height") end)')
        L.append("  fw = (okw and tonumber(fw)) or tonumber(T.Width) or 1080")
        L.append("  fh = (okh and tonumber(fh)) or tonumber(T.Height) or 1920")
        L.append("  local wm = math.max(W(t%d) * S%d, W(t%d) * S%d, W(t%d) * S%d) * fh / fw" % (u, u, e, e, l, l))
        L.append("  x = x + a * wm / 2")                   # anchor -1 = left edge at x: the block stays centred
        L.append("end")
        L.append("local y = (tonumber(T.RowsBaseY) or %s) + (tonumber(T.RowsY) or 0) + oy" % by)
    else:
        L.append('local function N(s) s = tostring(s or ""); local n = 1; for _ in s:gmatch("\\n") do n = n + 1 end; return n end')
        # from the preset's base and the All sliders, never from another layer's Center (no evaluation chain inside the tool)
        L.append("local x = (tonumber(T.RowsBaseX) or %s) + (tonumber(T.RowsX) or 0) + (J >= 1 and 0 or ox)" % bx)
        for n in (me, e):
            L.append("local t%d, S%d = %s, tonumber(T.Text%d.Size) or %s" % (n, n, ls[n]["text"], n, ls[n]["size"]))
        other = l if role == "upper" else u
        L.append("if J >= 2 then")                         # Left / Right: the same recentring as the emphasis row
        L.append(WIDTH_FN.rstrip("\n"))
        L.append("  local t%d, S%d = %s, tonumber(T.Text%d.Size) or %s" % (other, other, ls[other]["text"], other, ls[other]["size"]))
        L.append('  local okw, fw = pcall(function() return comp:GetPrefs("Comp.FrameFormat.Width") end)')
        L.append('  local okh, fh = pcall(function() return comp:GetPrefs("Comp.FrameFormat.Height") end)')
        L.append("  fw = (okw and tonumber(fw)) or tonumber(T.Width) or 1080")
        L.append("  fh = (okh and tonumber(fh)) or tonumber(T.Height) or 1920")
        L.append("  local wm = math.max(W(t%d) * S%d, W(t%d) * S%d, W(t%d) * S%d) * fh / fw" % (u, u, e, e, l, l))
        L.append("  x = x + ((J == 2) and -1 or 1) * wm / 2")
        L.append("end")
        L.append(row_h(me, False))
        L.append(row_h(e, has_box))
        L.append("local g = (tonumber(T.RowGap) or %s) * %s * (S%d + S%d) / 2" % (gdef, PITCH, me, e))
        sign = "+" if role == "upper" else "-"
        L.append("local y = (tonumber(T.RowsBaseY) or %s) + (tonumber(T.RowsY) or 0) + oy %s (H%d / 2 + g + H%d / 2)" % (by, sign, e, me))
    L.append("return Point(x, y)")
    return "\n".join(L)


ANCHOR_EXPR = ": local J = tonumber(Template.RowsJustify) or 0\nreturn (J == 2) and -1 or ((J == 3) and 1 or 0)"


def patch(s):
    t = block(s, "Template")
    if not t:
        return s
    tpl = s[t[0]:t[1]]
    if "RowGap = {" in tpl:
        return s[:t[0]] + resync(tpl) + s[t[1]:]             # already patched: controls and expressions refreshed
    ls = layers(tpl)
    roles = roles_of(ls)
    if not roles:
        raise ValueError("not an Upper / Emphasis / Lower MultiText (%d layers)" % len(ls))
    has_box = "HighlightHeight = {" in tpl
    gdef = gap_default(ls, roles)
    bx, by = ls[roles["emphasis"]]["center"]
    # 1. the controls, after the Box controls when there are any
    u = tpl.index("UserControls = ordered() { ") + len("UserControls = ordered() { ")
    m = re.search(r'HighlightY = \{[^{}]*\}, ', tpl)
    at = m.end() if m else u
    tpl = tpl[:at] + controls(gdef, bx, by) + tpl[at:]
    # 2. each layer's Center / anchor / justification
    for role in ROLES:
        n = roles[role]
        pat = re.compile(r'(\t\t\t\t\["Text%d\.Center"\] = Input \{ Value = \{ [-\d.]+, [-\d.]+ \}, )\},' % n)
        mm = pat.search(tpl)
        if not mm:
            raise ValueError("Text%d.Center not found" % n)
        rep = (mm.group(1) + 'Expression = "%s", },' % esc(center_expr(role, ls, roles, has_box, gdef, bx, by))
               + '\n\t\t\t\t["Text%d.HorizontalLeftCenterRight"] = Input { Value = 0, Expression = "%s", },' % (n, esc(ANCHOR_EXPR))
               + '\n\t\t\t\t["Text%d.HorizontalJustificationCenter"] = Input { Value = 0, Expression = "%s", },' % (n, esc(ANCHOR_EXPR)))
        tpl = tpl[:mm.start()] + rep + tpl[mm.end():]
    s = s[:t[0]] + tpl + s[t[1]:]
    # 3. mirrors of a layer's Center (the highlight box Text+) follow its anchor too
    pat = re.compile(r'(\t\t\t\tCenter = Input \{ Value = \{ [-\d.]+, [-\d.]+ \}, Expression = "Template\.Text(\d+)\.Center", \},)')

    def rep(m):
        n = m.group(2)
        return (m.group(1)
                + '\n\t\t\t\tHorizontalLeftCenterRight = Input { Value = 0, Expression = "Template.Text%s.HorizontalLeftCenterRight", },' % n
                + '\n\t\t\t\tHorizontalJustificationCenter = Input { Value = 0, Expression = "Template.Text%s.HorizontalJustificationCenter", },' % n)
    s = pat.sub(rep, s)
    return s


if __name__ == "__main__":
    for path in sys.argv[1:]:
        src = open(path, encoding="utf-8").read()
        try:
            out = patch(src)
        except ValueError as e:
            print("skipped", path, "-", e)
            continue
        if out != src:
            open(path, "w", encoding="utf-8").write(out)
            print("patched", path)
        else:
            print("unchanged", path)
