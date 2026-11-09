#!/usr/bin/env python3
"""Generates the "Kinetic Cloud (ML)" preset for El Subtitle Animator.

Template (Text+)  the controller: holds the subtitle text, font, colour, Size and the sliders. It is not rendered.
Row1..Row12       one Text+ per row. Text, Size, Center, AngleZ and colour are Lua expressions of Template.
Pop1..Pop12       a StyledTextFollower per row: the pop-in (opacity, scale overshoot, spin) timed per row.
Merge1..11        stack the rows; MediaOut1 reads the last merge.

Rows: the subtitle's words are packed greedily into rows of about "Row Length" characters (a line break in the text
forces a row), at most 12 rows. Every row is sized so it spans "Stack Width" of the frame (short rows are sized as if
they were "Shortest Row" characters long, capped at "Max Row Size"), rows are stacked tightly and the whole stack is
shrunk to "Max Stack Height" when needed. Rows pop in one every "Frames Per Row" frames; a virtual camera zooms on the
row that pops in ("Camera Zoom", "Camera Tilt") and pulls back to the whole statement over "Pull Back Frames".
A row wrapped in *asterisks* takes the Accent colour (Template shading element 2).

Timing: the plugin's Animation Start / Animation Frames sliders are honoured inside the expressions (no TimeStretcher,
so nothing is ever asked for a frame past the clip's end). Glyph widths were measured from a Resolve render of Poppins
ExtraBold (units of Size x frame height per character)."""
import sys

N = 12
OUT = sys.argv[1]

def lua(s):
    return s.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n')

ROWS = r'''local T = Template
local txt = tostring(T.StyledText.Value or "")
local function wd(s)
  local w = 0
  for ch in s:gmatch("[%z\1-\127\194-\244][\128-\191]*") do
    if ch == " " then w = w + 0.09
    elseif ch:find("^[ijl!|'.,:;]$") then w = w + 0.1
    elseif ch:find("^[tfr]$") then w = w + 0.14
    elseif ch:find("^[IJ]$") then w = w + 0.13
    elseif ch:find("^[mw]$") then w = w + 0.33
    elseif ch:find("^[MW]$") then w = w + 0.31
    elseif ch:find("^[%u]$") then w = w + 0.24
    elseif ch:find("^[%d]$") then w = w + 0.21
    elseif ch:find("^[sczvxykg]$") then w = w + 0.19
    elseif ch:find("^[-?]$") then w = w + 0.15
    else w = w + 0.21 end
  end
  return w
end
local N = ''' + str(N) + r'''
local u = {}
local c = {}
if txt:find("\n") then
  for l in txt:gmatch("[^\r\n]+") do local z = l:gsub("^%s+", ""):gsub("%s+$", "") if #z > 0 then u[#u + 1] = z end end
  local n = #u
  c = u
  if n > N then
    c = {}
    for k = 1, N do c[k] = table.concat(u, " ", math.floor((k - 1) * n / N) + 1, math.floor(k * n / N)) end
  end
else
  for w in txt:gmatch("%S+") do u[#u + 1] = w end
  local tgt = (tonumber(T.RowChars) or 11) * 0.2
  local guard = 0
  repeat
    c = {}
    local cur, cw = nil, 0
    for i = 1, #u do
      local w = wd((u[i]:gsub("%*", "")))
      if cur and cw + 0.09 + w > tgt then c[#c + 1] = cur; cur = u[i]; cw = w
      elseif cur then cur = cur .. " " .. u[i]; cw = cw + 0.09 + w
      else cur = u[i]; cw = w end
    end
    if cur then c[#c + 1] = cur end
    if #c > 1 and wd((c[#c]:gsub("%*", ""))) < 0.35 * tgt then c[#c - 1] = c[#c - 1] .. " " .. c[#c]; c[#c] = nil end
    tgt = tgt * 1.3
    guard = guard + 1
  until #c <= N or guard > 12
end
local cnt = #c
'''

# the plugin's Animation Start / Frames retiming, as maths on the comp time (see src/main/retime.js remapExpr)
REMAP = r'''local AF = math.floor(tonumber(Template.AnimFrames) or 0)
local AS = math.max(0, math.floor(tonumber(Template.AnimStart) or 0))
local NAT = tonumber(Template.AnimNatural) or 1
local rel = time - comp.RenderStart - AS
local tt = 0
if rel > 0 then
  if AF <= 0 then tt = rel else
    local D = math.max(1, AF - AS)
    if rel < D then tt = rel * NAT / D else tt = NAT + rel - D end
  end
end
'''

# Speed: the word-wrap above (ROWS) and the row sizes / stack positions don't depend on time, and every row's Text,
# colour, Size, Center and AngleZ need them. They are worked out ONCE, in one expression on Template's Comments input
# (a built-in Text input; a Text user control loads into Resolve as a Number), and handed on as text: a first line
# with the row count, then one line per row "accent<TAB>size<TAB>x<TAB>y<TAB>text". The per-row expressions only
# parse that (PARSE) and add the per-frame camera (GEOM). Before this, the same word-wrap ran in 85 expressions on
# every frame and every Inspector change.
LAYOUT = ROWS + r'''local asp = (tonumber(T.Width) or 1080) / (tonumber(T.Height) or 1920)
local s = (tonumber(T.Size) or 0.09) / 0.09
local TW = (tonumber(T.StackWidth) or 0.8) * asp * s
local LH = tonumber(T.RowGap) or 0.4
local CAP = (tonumber(T.MaxRowSize) or 0.3) * s
local MINW = (tonumber(T.MinChars) or 5) * 0.2
local MH = tonumber(T.MaxHeight) or 0.6
local sz, h, tot = {}, {}, 0
for k = 1, cnt do
  local t = c[k]:gsub("%*", "")
  local v = TW / math.max(wd(t), MINW)
  if v > CAP then v = CAP end
  sz[k] = v; h[k] = v * LH; tot = tot + h[k]
end
if tot > MH then local f = MH / tot; for k = 1, cnt do sz[k] = sz[k] * f; h[k] = h[k] * f end; tot = MH end
local cy, cx = {}, {}
local yy = tot / 2
local pat = { -1, 0.6, -0.4, 1, -0.8, 0.3, -1, 0.7, -0.5, 0.9, -0.6, 0.4 }
local stag = (tonumber(T.Stagger) or 0) * asp * s
for k = 1, cnt do cy[k] = yy - h[k] / 2; yy = yy - h[k]; cx[k] = stag * pat[k] end
local o = { tostring(cnt) }
for k = 1, cnt do
  local r = c[k]
  local acc = r:find("%*") and 1 or 0
  r = r:gsub("%*", ""):gsub("[\t\r\n]", " ")
  o[#o + 1] = string.format("%d\t%.17g\t%.17g\t%.17g\t%s", acc, sz[k], cx[k], cy[k], r)
end
return table.concat(o, "\n")'''

PARSE = r'''local T = Template
local c, acc, sz, cx, cy = {}, {}, {}, {}, {}
local first = true
for ln in tostring(T.Comments.Value or ""):gmatch("[^\n]+") do
  if first then first = false else
    local a, s1, x1, y1, t = ln:match("^(%d)\t([^\t]*)\t([^\t]*)\t([^\t]*)\t(.*)$")
    if a then
      local k = #c + 1
      c[k] = t; acc[k] = a == "1"; sz[k] = tonumber(s1) or 0.01; cx[k] = tonumber(x1) or 0; cy[k] = tonumber(y1) or 0
    end
  end
end
local cnt = #c
'''

GEOM = PARSE + REMAP + r'''local asp = (tonumber(T.Width) or 1080) / (tonumber(T.Height) or 1920)
local pat = { -1, 0.6, -0.4, 1, -0.8, 0.3, -1, 0.7, -0.5, 0.9, -0.6, 0.4 }
local tilt = tonumber(T.Tilt) or 0
local STEP = tonumber(T.StepFrames) or 7
local POP = 8
local PULL = tonumber(T.PullFrames) or 12
local Z = tonumber(T.Zoom) or 1.4
local function sm(p) if p < 0 then p = 0 elseif p > 1 then p = 1 end return p * p * (3 - 2 * p) end
local px, py, z, ca = 0, 0, 1, 0
if cnt > 0 and Z > 1.001 then
  local f = tt / STEP + 1
  if f < 1 then f = 1 end
  local fi = math.floor(f); if fi > cnt then fi = cnt end
  local fj = fi + 1; if fj > cnt then fj = cnt end
  local fr = sm(f - fi)
  local fy = cy[fi] * (1 - fr) + cy[fj] * fr
  local fx = cx[fi] * (1 - fr) + cx[fj] * fr
  local pull = sm((tt - ((cnt - 1) * STEP + POP * 0.6)) / PULL)
  px = fx * (1 - pull)
  py = fy * (1 - pull)
  z = Z * (1 - pull) + pull
  ca = (tonumber(T.CamTilt) or 0) * math.sin(f * 1.9) * (1 - pull)
end
'''

def slot_center(k):
    return GEOM + f'''local K = {k}
if K > cnt then return Point(T.Center.X, T.Center.Y) end
local dx, dy = (cx[K] - px) * z, (cy[K] - py) * z
local r = math.rad(ca)
local rx = dx * math.cos(r) - dy * math.sin(r)
local ry = dx * math.sin(r) + dy * math.cos(r)
return Point(T.Center.X + rx / asp, T.Center.Y + ry)'''

def slot_size(k):
    return GEOM + f'''local K = {k}
if K > cnt then return 0.01 end
return sz[K] * z'''

def slot_angle(k):
    return GEOM + f'''local K = {k}
if K > cnt then return 0 end
return tilt * pat[K] + ca'''

def slot_text(k):
    return PARSE + f'''local K = {k}
return c[K] or ""'''

def slot_colour(k, ch):
    return PARSE + f'''local K = {k}
if acc[K] then return T.{ch}2 end
return T.{ch}1'''

def pop_prelude(k):
    return REMAP + f'''local STEP = tonumber(Template.StepFrames) or 7
local p = (tt - ({k} - 1) * STEP) / 8
if p < 0 then p = 0 elseif p > 1 then p = 1 end
local q = p - 1
local e = 1 + 2.70158 * q * q * q + 1.70158 * q * q
'''

natural = PARSE + r'''local STEP = tonumber(T.StepFrames) or 7
local PULL = tonumber(T.PullFrames) or 12
if (tonumber(T.Zoom) or 1.4) <= 1.001 then PULL = 0 end
return math.max(1, math.ceil((math.max(1, cnt) - 1) * STEP + math.max(11, 4.8 + PULL + 1)))'''

def slider(id_, name, default, lo, hi, scale_hi, status, integer=False):
    return (f'{id_} = {{ LINKS_Name = "{name}", LINKID_DataType = "Number", INPID_InputControl = "SliderControl", '
            f'{"INP_Integer = true, " if integer else ""}INP_Default = {default}, INP_MinAllowed = {lo}, INP_MaxAllowed = {hi}, '
            f'INP_MinScale = {lo}, INP_MaxScale = {scale_hi}, ICS_ControlPage = "Text", INP_External = false, '
            f'INPS_StatusText = "{status}", }}, ')

SLIDERS = [
    ('StackWidth', 'Stack Width', 0.8, 0.2, 1.5, 1.2, 'Width every row is fitted to, as a fraction of the frame width', False),
    ('RowChars', 'Row Length', 11, 3, 40, 24, 'Characters a row holds before the next word starts a new row (a line break in the text always starts a row)', True),
    ('MinChars', 'Shortest Row', 5, 1, 12, 10, 'A row shorter than this many characters is sized as if it were this long', True),
    ('MaxRowSize', 'Max Row Size', 0.3, 0.05, 0.8, 0.5, 'Biggest font size a short row may grow to', False),
    ('RowGap', 'Row Tightness', 0.4, 0.25, 1.2, 1, 'Row pitch as a fraction of the row font size (lower = tighter stack)', False),
    ('MaxHeight', 'Max Stack Height', 0.6, 0.2, 1, 1, 'The whole stack is shrunk to stay within this fraction of the frame height', False),
    ('Stagger', 'Row Stagger', 0.04, 0, 0.3, 0.2, 'Rows shift alternately left and right by this fraction of the frame width (0 = centred column)', False),
    ('Tilt', 'Row Tilt', 2, 0, 15, 10, 'Alternating rotation of the rows, degrees (0 = straight)', False),
    ('StepFrames', 'Frames Per Row', 7, 1, 60, 30, 'Frames between one row popping in and the next (at the preset timing)', True),
    ('Zoom', 'Camera Zoom', 1.4, 1, 4, 3, 'How far the camera zooms on the row that pops in (1 = no camera move)', False),
    ('CamTilt', 'Camera Tilt', 3, 0, 20, 10, 'Camera rotation while it follows the rows, degrees', False),
    ('PullFrames', 'Pull Back Frames', 12, 1, 120, 40, 'Frames the camera takes to pull back to the whole statement', True),
]
uc = ''.join([
    slider('AnimStart', 'Animation Start', 0, 0, 100000, 120, 'Frame where the animation starts', True),
    slider('AnimFrames', 'Animation Frames', 0, 0, 100000, 120, "Frame where the last effect ends (0 = the preset's own timing)", True),
    'AnimNatural = { LINKS_Name = "Natural Frames", LINKID_DataType = "Number", INPID_InputControl = "SliderControl", IC_Visible = false, INP_Passive = true, INP_External = false, ICS_ControlPage = "Text", }, ',
] + [slider(*s_) for s_ in SLIDERS])
slider_inputs = '\n'.join(f'\t\t\t\t{id_} = Input {{ Value = {d}, }},' for id_, _, d, *_ in SLIDERS)

tools = []
tools.append(f'''		Template = TextPlus {{
			CtrlWZoom = false,
			Inputs = {{
				AnimStart = Input {{ Value = 0, }},
				AnimFrames = Input {{ Value = 0, }},
				AnimNatural = Input {{ Value = 1, Expression = "{lua(': ' + natural)}", }},
				Comments = Input {{ Value = "0", Expression = "{lua(': ' + LAYOUT)}", }},
{slider_inputs}
				GlobalOut = Input {{ Value = 89, }},
				Width = Input {{ Value = 1080, }},
				Height = Input {{ Value = 1920, }},
				UseFrameFormatSettings = Input {{ Value = 1, }},
				Softness1 = Input {{ Value = 1, }},
				Name2 = Input {{ Value = "Accent", }},
				Enabled2 = Input {{ Value = 0, }},
				Red2 = Input {{ Value = 0.067, }},
				Green2 = Input {{ Value = 0.839, }},
				Blue2 = Input {{ Value = 0.129, }},
				StyledText = Input {{ Value = "Kinetic Cloud stacks any long statement row by row", }},
				Font = Input {{ Value = "Poppins", }},
				Style = Input {{ Value = "ExtraBold", }},
				Size = Input {{ Value = 0.09, }},
				VerticalJustificationNew = Input {{ Value = 3, }},
				HorizontalJustificationNew = Input {{ Value = 3, }}
			}},
			UserControls = ordered() {{ {uc}}},
			ViewInfo = OperatorInfo {{ Pos = {{ 0, -60 }} }},
			Version = 1
		}}''')

for k in range(1, N + 1):
    sgn = 1 if k % 2 else -1
    pp = pop_prelude(k)
    tools.append(f'''		Pop{k} = StyledTextFollower {{
			CtrlWZoom = false,
			Inputs = {{
				DelayType = Input {{ Value = 2, }},
				Delay = Input {{ Value = 3, }},
				Text = Input {{ Value = StyledText {{ Value = "row {k}" }}, Expression = "{lua(': ' + slot_text(k))}", }},
				SelectTransform = Input {{ Value = 1, }},
				TransformRotation = Input {{ Value = 1, }},
				TransformSize = Input {{ Value = 1, }},
				WordSizeX = Input {{ Value = 1, Expression = "{lua(': ' + pp + 'return 0.25 + 0.75 * e')}", }},
				WordSizeY = Input {{ Value = 1, Expression = "{lua(': ' + pp + 'return 0.25 + 0.75 * e')}", }},
				WordAngleZ = Input {{ Value = 0, Expression = "{lua(': ' + pp + f'return {sgn * 9} * (1 - e)')}", }},
				WordOffset = Input {{ Value = {{ 0, 0 }}, Expression = "{lua(': ' + pp + 'return Point(0, -0.02 * (1 - e))')}", }},
				Opacity1 = Input {{ Value = 1, Expression = "{lua(': ' + pp + 'return math.min(1, p * 3)')}", }},
				Softness1 = Input {{ Value = 1, }}
			}},
		}}''')
    tools.append(f'''		Row{k} = TextPlus {{
			CtrlWZoom = false,
			Inputs = {{
				GlobalOut = Input {{ Value = 89, }},
				Width = Input {{ Value = 1080, }},
				Height = Input {{ Value = 1920, }},
				UseFrameFormatSettings = Input {{ Value = 1, }},
				Softness1 = Input {{ Value = 1, }},
				StyledText = Input {{ SourceOp = "Pop{k}", Source = "StyledText", }},
				Font = Input {{ Value = "Poppins", Expression = "Template.Font", }},
				Style = Input {{ Value = "ExtraBold", Expression = "Template.Style", }},
				Size = Input {{ Value = 0.09, Expression = "{lua(': ' + slot_size(k))}", }},
				Center = Input {{ Value = {{ 0.5, 0.5 }}, Expression = "{lua(': ' + slot_center(k))}", }},
				AngleZ = Input {{ Value = 0, Expression = "{lua(': ' + slot_angle(k))}", }},
				Red1 = Input {{ Value = 1, Expression = "{lua(': ' + slot_colour(k, 'Red'))}", }},
				Green1 = Input {{ Value = 1, Expression = "{lua(': ' + slot_colour(k, 'Green'))}", }},
				Blue1 = Input {{ Value = 1, Expression = "{lua(': ' + slot_colour(k, 'Blue'))}", }},
				VerticalJustificationNew = Input {{ Value = 3, }},
				HorizontalJustificationNew = Input {{ Value = 3, }}
			}},
			ViewInfo = OperatorInfo {{ Pos = {{ {110 * k}, 0 }} }},
			Version = 1
		}}''')

prev = 'Row1'
for k in range(2, N + 1):
    tools.append(f'''		Merge{k - 1} = Merge {{
			CtrlWZoom = false,
			Inputs = {{
				Background = Input {{ SourceOp = "{prev}", Source = "Output", }},
				Foreground = Input {{ SourceOp = "Row{k}", Source = "Output", }},
				PerformDepthMerge = Input {{ Value = 0, }},
			}},
			ViewInfo = OperatorInfo {{ Pos = {{ {110 * k}, 60 }} }},
		}}''')
    prev = f'Merge{k - 1}'

tools.append(f'''		MediaOut1 = Saver {{ CtrlWZoom = false,
			Inputs = {{
				Index = Input {{ Value = "0", }},
				Input = Input {{
					SourceOp = "{prev}",
					Source = "Output",
				}}
			}},
			ViewInfo = OperatorInfo {{ Pos = {{ {110 * (N + 2)}, 60 }} }},
		}}''')

comp = '''Composition {
	CurrentTime = 20,
	RenderRange = { 0, 89 },
	GlobalRange = { 0, 89 },
	CurrentID = 60,
	HiQ = true,
	PlaybackUpdateMode = 0,
	StereoMode = false,
	Version = "DaVinci Resolve Studio 21.1.2.0010",
	SavedOutputs = 0,
	HeldTools = 0,
	DisabledTools = 0,
	LockedTools = 0,
	AudioOffset = 0,
	Resumable = true,
	OutputClips = {
	},
	CustomData = { TEMPLATE_ID = "Text+" },
	Tools = {
''' + ',\n'.join(tools) + '''
	},
	Frames = {
	},
	Prefs = {
		Comp = {
			FrameFormat = {
				Width = 1080,
				Height = 1920,
				Rate = 25,
				GuideRatio = 1.77777777777778,
				DepthFull = 3,
				DepthPreview = 3,
				DepthInteractive = 3,
			},
			Unsorted = {
				GlobalEnd = 89
			},
		}
	},
}
'''
open(OUT, 'w').write(comp)
print('wrote', OUT, len(comp), 'bytes')
