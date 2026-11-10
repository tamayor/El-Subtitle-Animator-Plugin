#!/usr/bin/env python3
"""Generates the "Justified Pop (ML)" preset for El Subtitle Animator.

Look (from the user's reference, 2026-11-10): three rows in one colour (yellow).
    but     the     thing     is        <- Upper: small, justified
    NOT EVERYONE                        <- Emphasis: big, bold, upper case
    can         do          it          <- Lower: small, justified
The Upper and Lower rows are spread to exactly the Emphasis row's ink width: the first word's left ink edge sits on the
emphasis's left ink edge, the last word's right edge on its right edge, and the gaps between words are equal
(gap = (emphasis width - the row's word widths) / (words - 1)). One word on a row is centred.

Animation: only a word-by-word pop (each word scales up from nothing with a small overshoot), in reading order.
By default the words are spread over "Spread" of the clip length (so they roughly follow the speech); "Frames Per Word"
caps the spacing.

Which words go where:
  - text with line breaks: line 1 = Upper, line 2 = Emphasis, lines 3+ = Lower (2 lines = Upper + Emphasis);
  - text with *asterisks*: the starred words are the Emphasis, words before = Upper, after = Lower;
  - plain text: the middle third of the words is the Emphasis.

Nodes: Template (unrendered controller Text+: text, font, colours, sizes, sliders), U1..U8 / E1..E5 / L1..L8 (one Text+
per word; text, Size, Center, colour, font are expressions), Merges, MediaOut1. The layout is worked out once per input
set in Template.Comments (kinetic_cache), one "row" line per word slot.
Widths come from the Poppins font files (advance, left / right side bearing per character) x WSCALE, the Text+ em in
units of Size x frame height measured for the Kinetic presets (m = 0.34, capitals 0.24 at 1.067 / 0.755 em)."""
import os
import sys

from fontTools.ttLib import TTFont

from kinetic_cache import cached, lookup, COMMENTS

OUT = sys.argv[1]
NU, NE, NL = 8, 5, 8
SLOTS = [('U', k) for k in range(1, NU + 1)] + [('E', k) for k in range(1, NE + 1)] + [('L', k) for k in range(1, NL + 1)]
NS = len(SLOTS)
WSCALE = 0.318          # Text+ em in Size x frame-height units
BASEUP = 0.35           # Text+ Center (vertically centred) sits this many em above the baseline (line box 1.05 / -0.35)
EMPH_STYLE, ROW_STYLE = 'ExtraBold', 'SemiBold'
YELLOW = (242 / 255, 232 / 255, 89 / 255)


def lua(s):
    return s.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n')


def font_path(style):
    for d in (os.path.expanduser('~/Library/Fonts'), '/Library/Fonts',
              os.path.join(os.path.dirname(__file__), '..', '..', 'El Subtitle Animator', 'fonts')):
        p = os.path.join(d, 'Poppins-%s.ttf' % style)
        if os.path.exists(p):
            return p
    raise SystemExit('Poppins-%s.ttf not found' % style)


def metrics(style):
    """Lua table {[byte] = {advance, lsb, rsb}} in em, plus cap height and ascender (in em)."""
    f = TTFont(font_path(style))
    upm = f['head'].unitsPerEm
    cmap = f.getBestCmap()
    glyf = f['glyf']
    out = []
    for cp in range(32, 127):
        g = cmap.get(cp)
        if not g:
            continue
        adv = f['hmtx'][g][0]
        gl = glyf[g]
        if getattr(gl, 'numberOfContours', 0):
            lsb, rsb = gl.xMin, adv - gl.xMax
        else:
            lsb = rsb = 0
        out.append('[%d]={%.4f,%.4f,%.4f}' % (cp, adv / upm, lsb / upm, rsb / upm))
    asc = glyf[cmap[ord('d')]].yMax / upm
    return '{' + ','.join(out) + '}', f['OS/2'].sCapHeight / upm, asc


GE, CAPE, _ = metrics(EMPH_STYLE)
GR, _, ASCR = metrics(ROW_STYLE)

CORE = r'''local GE = ''' + GE + r'''
local GR = ''' + GR + r'''
local WS = ''' + repr(WSCALE) + r'''
local function chars(s) local o = {} for ch in s:gmatch("[%z\1-\127\194-\244][\128-\191]*") do o[#o + 1] = ch end return o end
-- width of a word in em, and its first char's left / last char's right side bearing
local function wm(s, G)
  local cs = chars(s)
  local w = 0
  for i = 1, #cs do local m = G[cs[i]:byte()] w = w + (#cs[i] == 1 and m and m[1] or 0.62) end
  local f, l = G[(cs[1] or " "):byte()], G[(cs[#cs] or " "):byte()]
  return w, (#cs[1] or 0) == 1 and f and f[2] or 0, l and #cs[#cs] == 1 and l[3] or 0
end
local txt = tostring(T.StyledText.Value or "")
local function words(s) local o = {} for w in s:gmatch("%S+") do o[#o + 1] = w end return o end
local up, em, lo = {}, {}, {}
if txt:find("\n") then
  local ls = {}
  for l in txt:gmatch("[^\r\n]+") do local z = l:gsub("^%s+", ""):gsub("%s+$", "") if #z > 0 then ls[#ls + 1] = z end end
  if #ls == 1 then em = words(ls[1])
  else
    up = words(ls[1]); em = words(ls[2])
    for i = 3, #ls do for _, w in ipairs(words(ls[i])) do lo[#lo + 1] = w end end
  end
elseif txt:find("%*") then
  local a, b, c3 = txt:match("^(.-)%*(.-)%*(.*)$")
  if a then up = words(a); em = words(b); lo = words(c3) else em = words(txt) end
else
  local ws = words(txt)
  local n = #ws
  if n <= 2 then em = ws else
    local ne = math.max(1, math.floor(n / 3 + 0.5))
    local s0 = math.floor((n - ne) / 2)
    for i = 1, n do
      if i <= s0 then up[#up + 1] = ws[i] elseif i <= s0 + ne then em[#em + 1] = ws[i] else lo[#lo + 1] = ws[i] end
    end
  end
end
if #em == 0 then if #up > 0 then em = up; up = {} elseif #lo > 0 then em = lo; lo = {} end end
local function clean(t, cap)
  local o = {}
  for i = 1, #t do local w = t[i]:gsub("%*", "") if #w > 0 then o[#o + 1] = w end end
  while #o > cap do o[#o - 1] = o[#o - 1] .. " " .. o[#o]; o[#o] = nil end
  return o
end
up = clean(up, ''' + str(NU) + r'''); em = clean(em, ''' + str(NE) + r'''); lo = clean(lo, ''' + str(NL) + r''')
if (tonumber(T.UpperEmph) or 1) > 0.5 then for i = 1, #em do em[i] = em[i]:upper() end end
local asp = (tonumber(T.Width) or 1080) / (tonumber(T.Height) or 1920)
local TW = (tonumber(T.StackWidth) or 0.82) * asp
local RATIO = tonumber(T.RowRatio) or 0.65
local GAP = tonumber(T.RowGap) or 1
-- emphasis row: words set with normal spaces, ink width = the block width
local vE = tonumber(T.Size) or 0.13
local spE = GE[32][1]
local ew, ewt = {}, 0
for i = 1, #em do ew[i] = wm(em[i], GE); ewt = ewt + ew[i] end
ewt = ewt + spE * math.max(0, #em - 1)
local _, eL = wm(em[1] or " ", GE)
local _, _, eR = wm(em[#em] or " ", GE)
local einkw = ewt - eL - (eR or 0)
if einkw * WS * vE > TW then vE = TW / (einkw * WS) end
local BW = einkw * WS * vE                -- block (ink) width, frame-height units
local c, acc, sz, cx, cy = {}, {}, {}, {}, {}
for k = 1, ''' + str(NS) + r''' do c[k] = ""; acc[k] = false; sz[k] = 0.01; cx[k] = 0; cy[k] = 0 end
-- x in frame-height units relative to the block centre (converted to frame-width fractions at the end)
local x = -BW / 2 - eL * WS * vE
for i = 1, #em do
  local w = ew[i] * WS * vE
  local k = ''' + str(NU) + r''' + i
  c[k] = em[i]; acc[k] = true; sz[k] = vE; cx[k] = x + w / 2
  x = x + w + spE * WS * vE
end
-- upper / lower: spread to the block width, equal gaps
local function row(t, base)
  if #t == 0 then return 0 end
  local v = vE * RATIO
  local ws, tot = {}, 0
  for i = 1, #t do ws[i] = wm(t[i], GR); tot = tot + ws[i] end
  local _, L0 = wm(t[1], GR)
  local _, _, R0 = wm(t[#t], GR)
  local minGap = GR[32][1]
  -- shrink the row if its words with plain spaces would not fit the block
  local need = (tot - L0 - (R0 or 0) + minGap * math.max(0, #t - 1)) * WS * v
  if need > BW and #t > 1 then v = v * BW / need end
  if #t == 1 then
    local w = ws[1] * WS * v
    if (ws[1] - L0 - (R0 or 0)) * WS * v > BW then v = BW / ((ws[1] - L0 - (R0 or 0)) * WS) end
    c[base + 1] = t[1]; sz[base + 1] = v; cx[base + 1] = (L0 - (R0 or 0)) * WS * v / 2 * 0
    return v
  end
  local left = -BW / 2 - L0 * WS * v
  local right = BW / 2 + (R0 or 0) * WS * v
  local gap = ((right - left) - tot * WS * v) / (#t - 1)
  local xx = left
  for i = 1, #t do
    local w = ws[i] * WS * v
    c[base + i] = t[i]; sz[base + i] = v; cx[base + i] = xx + w / 2
    xx = xx + w + gap
  end
  return v
end
local vU = row(up, 0)
local vL = row(lo, ''' + str(NU + NE) + r''')
-- vertical, frame-height units, y up, baselines relative to the emphasis baseline (0)
local EMs = WS * vE
local capE = ''' + repr(round(CAPE, 4)) + r''' * EMs
local ASC = ''' + repr(round(ASCR, 4)) + r'''
local bU = capE + 0.5 * capE * GAP
local bL = -(0.42 * capE * GAP + ASC * WS * vL)
local top = (#up > 0) and (bU + ASC * WS * vU) or capE
local bot = (#lo > 0) and bL or 0
local mid = (top + bot) / 2
local BU = ''' + repr(BASEUP) + r'''
for k = 1, ''' + str(NS) + r''' do
  local b
  if k <= ''' + str(NU) + r''' then b = bU elseif k <= ''' + str(NU + NE) + r''' then b = 0 else b = bL end
  cy[k] = b - mid + BU * WS * sz[k]
  cx[k] = cx[k] / asp
end
local cnt = ''' + str(NS) + r'''
return { cnt = cnt, c = c, acc = acc, sz = sz, cx = cx, cy = cy, nat = 1 }'''

CACHE = cached(CORE, 'ELSA_JP')
LAYOUT = CACHE + COMMENTS
LOOKUP = lookup(CORE, 'ELSA_JP', '1')

# timing: word order, step and the retime (Animation Start / Frames) — cheap, per frame
TIMING = r'''local L = math.max(1, comp.RenderEnd - comp.RenderStart + 1)
local NW = 0
for k = 1, cnt do if c[k] ~= "" then NW = NW + 1 end end
local POP = math.max(1, tonumber(T.PopFrames) or 6)
local STEP = tonumber(T.StepFrames) or 8
local SPREAD = tonumber(T.Spread) or 0.7
if SPREAD > 0 and NW > 1 then
  local s = (L * SPREAD - POP) / (NW - 1)
  if s < STEP then STEP = s end
end
if STEP < 1 then STEP = 1 end
local NAT = math.max(1, math.ceil((math.max(1, NW) - 1) * STEP + POP + 1))
local AF = math.floor(tonumber(T.AnimFrames) or 0)
local AS = math.max(0, math.floor(tonumber(T.AnimStart) or 0))
local rel = time - comp.RenderStart - AS
local tt = 0
if rel > 0 then
  if AF <= 0 then tt = rel else
    local D = math.max(1, AF - AS)
    if rel < D then tt = rel * NAT / D else tt = NAT + rel - D end
  end
end
'''


def slot_size(k):
    return LOOKUP + TIMING + f'''local K = {k}
if c[K] == "" then return 0 end
local ord = 0
for j = 1, K do if c[j] ~= "" then ord = ord + 1 end end
local p = (tt - (ord - 1) * STEP) / POP
if p <= 0 then return 0 end
if p >= 1 then return sz[K] end
local B = 1.70158 * (tonumber(T.Bounce) or 1)
local q = p - 1
return sz[K] * (1 + (B + 1) * q * q * q + B * q * q)'''


def slot_center(k):
    return LOOKUP + f'''local K = {k}
return Point(T.Center.X + cx[K], T.Center.Y + cy[K])'''


def slot_text(k):
    return LOOKUP + f'return c[{k}] or ""'


def slot_colour(k, ch):
    return LOOKUP + f'''if acc[{k}] then return T.{ch}2 end
return T.{ch}1'''


natural = LOOKUP + TIMING + 'return NAT'

ROW_STYLE_EXPR = (': local s = tostring(Template.Style.Value or "") '
                  f'if s == "{EMPH_STYLE}" or s == "Black" or s == "Bold" or s == "Heavy" then return "{ROW_STYLE}" end return s')


def slider(id_, name, default, lo, hi, scale_hi, status, integer=False):
    return (f'{id_} = {{ LINKS_Name = "{name}", LINKID_DataType = "Number", INPID_InputControl = "SliderControl", '
            f'{"INP_Integer = true, " if integer else ""}INP_Default = {default}, INP_MinAllowed = {lo}, INP_MaxAllowed = {hi}, '
            f'INP_MinScale = {lo}, INP_MaxScale = {scale_hi}, ICS_ControlPage = "Text", INP_External = false, '
            f'INPS_StatusText = "{status}", }}, ')


SLIDERS = [
    ('StackWidth', 'Max Width', 0.82, 0.2, 1.2, 1, 'The emphasis row is shrunk to fit this fraction of the frame width; the upper and lower rows spread to its width', False),
    ('RowRatio', 'Row Size', 0.65, 0.2, 1.2, 1, 'Upper / lower word size as a fraction of the emphasis size', False),
    ('RowGap', 'Row Gap', 1, 0, 4, 3, 'Space between the rows (1 = the reference look)', False),
    ('UpperEmph', 'Uppercase Emphasis', 1, 0, 1, 1, '1 = the emphasis row is set in capitals', True),
    ('StepFrames', 'Frames Per Word', 8, 1, 60, 30, 'Most frames between one word popping in and the next', True),
    ('Spread', 'Spread', 0.7, 0, 1, 1, 'Pop all words within this fraction of the clip (0 = always Frames Per Word)', False),
    ('PopFrames', 'Pop Frames', 6, 1, 30, 20, 'Frames a word takes to pop in', True),
    ('Bounce', 'Bounce', 1, 0, 3, 2, 'Overshoot of the pop (0 = none)', False),
]
uc = ''.join([
    slider('AnimStart', 'Animation Start', 0, 0, 100000, 120, 'Frame where the animation starts', True),
    slider('AnimFrames', 'Animation Frames', 0, 0, 100000, 120, "Frame where the last effect ends (0 = the preset's own timing)", True),
    'AnimNatural = { LINKS_Name = "Natural Frames", LINKID_DataType = "Number", INPID_InputControl = "SliderControl", IC_Visible = false, INP_Passive = true, INP_External = false, ICS_ControlPage = "Text", }, ',
] + [slider(*s_) for s_ in SLIDERS])
slider_inputs = '\n'.join(f'\t\t\t\t{id_} = Input {{ Value = {d}, }},' for id_, _, d, *_ in SLIDERS)
r, g, b = (round(v, 4) for v in YELLOW)

tools = [f'''		Template = TextPlus {{
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
				Red1 = Input {{ Value = {r}, }},
				Green1 = Input {{ Value = {g}, }},
				Blue1 = Input {{ Value = {b}, }},
				Softness1 = Input {{ Value = 1, }},
				Name2 = Input {{ Value = "Accent", }},
				Enabled2 = Input {{ Value = 0, }},
				Red2 = Input {{ Value = {r}, }},
				Green2 = Input {{ Value = {g}, }},
				Blue2 = Input {{ Value = {b}, }},
				StyledText = Input {{ Value = "but the thing is\\nNOT EVERYONE\\ncan do it", }},
				Font = Input {{ Value = "Poppins", }},
				Style = Input {{ Value = "{EMPH_STYLE}", }},
				Size = Input {{ Value = 0.13, }},
				VerticalJustificationNew = Input {{ Value = 3, }},
				HorizontalJustificationNew = Input {{ Value = 3, }}
			}},
			UserControls = ordered() {{ {uc}}},
			ViewInfo = OperatorInfo {{ Pos = {{ 0, -60 }} }},
			Version = 1
		}}''']

names = []
for i, (role, n) in enumerate(SLOTS, 1):
    name = f'{role}{n}'
    names.append(name)
    style = 'Expression = "Template.Style", ' if role == 'E' else f'Expression = "{lua(ROW_STYLE_EXPR)}", '
    tools.append(f'''		{name} = TextPlus {{
			CtrlWZoom = false,
			Inputs = {{
				GlobalOut = Input {{ Value = 89, }},
				Width = Input {{ Value = 1080, }},
				Height = Input {{ Value = 1920, }},
				UseFrameFormatSettings = Input {{ Value = 1, }},
				Softness1 = Input {{ Value = 1, }},
				StyledText = Input {{ Value = "", Expression = "{lua(': ' + slot_text(i))}", }},
				Font = Input {{ Value = "Poppins", Expression = "Template.Font", }},
				Style = Input {{ Value = "{EMPH_STYLE if role == 'E' else ROW_STYLE}", {style}}},
				Size = Input {{ Value = 0, Expression = "{lua(': ' + slot_size(i))}", }},
				Center = Input {{ Value = {{ 0.5, 0.5 }}, Expression = "{lua(': ' + slot_center(i))}", }},
				Red1 = Input {{ Value = {r}, Expression = "{lua(': ' + slot_colour(i, 'Red'))}", }},
				Green1 = Input {{ Value = {g}, Expression = "{lua(': ' + slot_colour(i, 'Green'))}", }},
				Blue1 = Input {{ Value = {b}, Expression = "{lua(': ' + slot_colour(i, 'Blue'))}", }},
				VerticalJustificationNew = Input {{ Value = 3, }},
				HorizontalJustificationNew = Input {{ Value = 3, }}
			}},
			ViewInfo = OperatorInfo {{ Pos = {{ {110 * i}, 0 }} }},
			Version = 1
		}}''')

prev = names[0]
for i, name in enumerate(names[1:], 1):
    tools.append(f'''		Merge{i} = Merge {{
			CtrlWZoom = false,
			Inputs = {{
				Background = Input {{ SourceOp = "{prev}", Source = "Output", }},
				Foreground = Input {{ SourceOp = "{name}", Source = "Output", }},
				PerformDepthMerge = Input {{ Value = 0, }},
			}},
			ViewInfo = OperatorInfo {{ Pos = {{ {110 * (i + 1)}, 60 }} }},
		}}''')
    prev = f'Merge{i}'

tools.append(f'''		MediaOut1 = Saver {{ CtrlWZoom = false,
			Inputs = {{
				Index = Input {{ Value = "0", }},
				Input = Input {{ SourceOp = "{prev}", Source = "Output", }}
			}},
			ViewInfo = OperatorInfo {{ Pos = {{ {110 * (NS + 2)}, 60 }} }},
		}}''')

comp = '''Composition {
	CurrentTime = 40,
	RenderRange = { 0, 89 },
	GlobalRange = { 0, 89 },
	CurrentID = 80,
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
