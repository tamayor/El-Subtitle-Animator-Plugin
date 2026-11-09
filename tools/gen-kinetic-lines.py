#!/usr/bin/env python3
"""Generates the "Kinetic Lines (ML)" preset for El Subtitle Animator: the calm sibling of Kinetic Cloud.

Template (Text+)  the controller: holds the subtitle text, font, colour, Size and the sliders. It is not rendered.
Row1..Row12       one Text+ per row. Text, Size, Center and colour are Lua expressions of Template.
Pop1..Pop12       a StyledTextFollower per row: the fade-in, timed per row (named Pop<k> so the plugin's per-row
                  sound placement, bridge op row_times, works the same as for Kinetic Cloud).
Merge1..11        stack the rows; MediaOut1 reads the last merge.

Rows: the subtitle's words are packed greedily into rows of about "Row Length" characters (a line break in the text
forces a row), at most 12 rows. All rows share ONE font size (Template Size, shrunk only when the widest row would
exceed "Stack Width" or the stack "Max Stack Height"), are centred and stacked at "Row Tightness" pitch. Nothing is
tilted or staggered and there is no camera: every row simply slides in horizontally over "Slide Frames" from a
"Slide Distance" away and fades in, one row every "Frames Per Row" frames. "Slide Pattern" picks the directions:
0 alternate starting from the left, 1 alternate starting from the right, 2 all from the left, 3 all from the right.
"Settle" adds a gentle overshoot past the resting point (0 = none). A row wrapped in *asterisks* takes the Accent
colour (Template shading element 2).

Timing: the plugin's Animation Start / Animation Frames sliders are honoured inside the expressions (no TimeStretcher).
Glyph widths were measured from a Resolve render of Poppins ExtraBold (units of Size x frame height per character)."""
import sys

from kinetic_cache import cached, lookup, COMMENTS, ROW_TABLES

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
  local tgt = (tonumber(T.RowChars) or 14) * 0.2
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
local NAT = R.nat
local rel = time - comp.RenderStart - AS
local tt = 0
if rel > 0 then
  if AF <= 0 then tt = rel else
    local D = math.max(1, AF - AS)
    if rel < D then tt = rel * NAT / D else tt = NAT + rel - D end
  end
end
'''

# Speed: the word-wrap (ROWS), the row sizes and the stack positions don't depend on time. CORE works them out and
# kinetic_cache.cached() keeps the result in a Lua global keyed by the Template inputs it reads, so it runs once per
# input set instead of on every read (Fusion caches no expression results; followers evaluate once per letter).
# Template.Comments still shows the layout as text (row count, then "accent<TAB>size<TAB>x<TAB>y<TAB>text" per row) and
# Template.AnimNatural the natural length, for the plugin; no expression reads them any more.
SIZING = r'''local asp = (tonumber(T.Width) or 1080) / (tonumber(T.Height) or 1920)
local TW = (tonumber(T.StackWidth) or 0.85) * asp
local LH = tonumber(T.RowGap) or 0.42
local MH = tonumber(T.MaxHeight) or 0.6
local v = tonumber(T.Size) or 0.09
local mw = 0
for k = 1, cnt do local w = wd((c[k]:gsub("%*", ""))) if w > mw then mw = w end end
if mw > 0 and mw * v > TW then v = TW / mw end
if cnt * v * LH > MH then v = MH / (cnt * LH) end
local h = v * LH
local cy = {}
local yy = cnt * h / 2
for k = 1, cnt do cy[k] = yy - h / 2; yy = yy - h end
'''
NATCALC = r'''local STEP = tonumber(T.StepFrames) or 5
local SLIDE = math.max(1, tonumber(T.SlideFrames) or 12)
local nat = math.max(1, math.ceil((math.max(1, cnt) - 1) * STEP + SLIDE + 1))
'''
CORE = ROWS[len('local T = Template\n'):] + SIZING + ROW_TABLES + NATCALC + r'''local sz, cx = {}, {}
for k = 1, cnt do sz[k] = v; cx[k] = 0 end
return { cnt = cnt, c = rc, acc = ra, sz = sz, cx = cx, cy = cy, nat = nat }'''
CACHE = cached(CORE, 'ELSA_KL')
LAYOUT = CACHE + COMMENTS
LOOKUP = lookup(CORE, 'ELSA_KL', '(function() ' + NATCALC.replace('\n', ' ') + ' return nat end)()')


PARSE = LOOKUP

GEOM = PARSE + REMAP + r'''local STEP = tonumber(T.StepFrames) or 5
local SLIDE = math.max(1, tonumber(T.SlideFrames) or 12)
local DIST = tonumber(T.SlideDist) or 0.16
local PAT = math.floor(tonumber(T.Pattern) or 0)
local OVS = tonumber(T.Settle) or 0
local function dirof(k)
  if PAT == 2 then return -1 elseif PAT == 3 then return 1 end
  local d = (k % 2 == 1) and -1 or 1
  if PAT == 1 then d = -d end
  return d
end
local function prog(k)
  local p = (tt - (k - 1) * STEP) / SLIDE
  if p < 0 then p = 0 elseif p > 1 then p = 1 end
  return p
end
local function ease(p)
  local q = 1 - p
  local e = 1 - q * q * q
  if OVS > 0 then e = e + OVS * math.sin(p * math.pi) * q * 4 end
  return e
end
'''

def slot_center(k):
    return GEOM + f'''local K = {k}
if K > cnt then return Point(T.Center.X, T.Center.Y) end
local e = ease(prog(K))
return Point(T.Center.X + dirof(K) * DIST * (1 - e), T.Center.Y + cy[K])'''

def slot_size(k):
    return GEOM + f'''local K = {k}
if K > cnt then return 0.01 end
return sz[K]'''

def slot_text(k):
    return PARSE + f'''local K = {k}
return c[K] or ""'''

def slot_colour(k, ch):
    return PARSE + f'''local K = {k}
if acc[K] then return T.{ch}2 end
return T.{ch}1'''

def pop_prelude(k):
    return LOOKUP + REMAP + f'''local STEP = tonumber(Template.StepFrames) or 5
local SLIDE = math.max(1, tonumber(Template.SlideFrames) or 12)
local p = (tt - ({k} - 1) * STEP) / SLIDE
if p < 0 then p = 0 elseif p > 1 then p = 1 end
'''

natural = PARSE + 'return R.nat'

def slider(id_, name, default, lo, hi, scale_hi, status, integer=False):
    return (f'{id_} = {{ LINKS_Name = "{name}", LINKID_DataType = "Number", INPID_InputControl = "SliderControl", '
            f'{"INP_Integer = true, " if integer else ""}INP_Default = {default}, INP_MinAllowed = {lo}, INP_MaxAllowed = {hi}, '
            f'INP_MinScale = {lo}, INP_MaxScale = {scale_hi}, ICS_ControlPage = "Text", INP_External = false, '
            f'INPS_StatusText = "{status}", }}, ')

SLIDERS = [
    ('StackWidth', 'Stack Width', 0.85, 0.2, 1.5, 1.2, 'Widest row is shrunk to fit this fraction of the frame width', False),
    ('RowChars', 'Row Length', 14, 3, 40, 24, 'Characters a row holds before the next word starts a new row (a line break in the text always starts a row)', True),
    ('RowGap', 'Row Tightness', 0.42, 0.25, 1.2, 1, 'Row pitch as a fraction of the font size (lower = tighter stack)', False),
    ('MaxHeight', 'Max Stack Height', 0.6, 0.2, 1, 1, 'The whole stack is shrunk to stay within this fraction of the frame height', False),
    ('StepFrames', 'Frames Per Row', 5, 1, 60, 30, 'Frames between one row starting to slide in and the next (at the preset timing)', True),
    ('SlideFrames', 'Slide Frames', 12, 1, 60, 30, 'Frames a row takes to slide into place', True),
    ('SlideDist', 'Slide Distance', 0.16, 0, 0.6, 0.4, 'How far a row starts from its resting point, as a fraction of the frame width (0 = fade only)', False),
    ('Pattern', 'Slide Pattern', 0, 0, 3, 3, '0 = alternate, first row from the left; 1 = alternate, first row from the right; 2 = all from the left; 3 = all from the right', True),
    ('Settle', 'Settle', 0, 0, 0.3, 0.2, 'Gentle overshoot past the resting point before settling (0 = none)', False),
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
				StyledText = Input {{ Value = "Kinetic Lines slides each row in calmly", }},
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
    pp = pop_prelude(k)
    tools.append(f'''		Pop{k} = StyledTextFollower {{
			CtrlWZoom = false,
			Inputs = {{
				DelayType = Input {{ Value = 2, }},
				Delay = Input {{ Value = 0, }},
				Text = Input {{ Value = StyledText {{ Value = "row {k}" }}, Expression = "{lua(': ' + slot_text(k))}", }},
				SelectTransform = Input {{ Value = 1, }},
				Opacity1 = Input {{ Value = 1, Expression = "{lua(': ' + pp + 'local f = p / 0.6 if f > 1 then f = 1 end return f * f * (3 - 2 * f)')}", }},
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
