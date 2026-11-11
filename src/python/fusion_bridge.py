#!/usr/bin/env python3
# Fusion helper for the Subtitle Animator panel.
#
# Resolve's JavaScript plugin interface cannot reach the nodes inside a Fusion composition
# (tool.GetAttrs is not a function there), but Resolve's Python scripting can. The panel starts
# this file once and talks to it with one JSON message per line:
#   in : {"id": 1, "op": "nodes", "args": {...}}
#   out: {"id": 1, "ok": true, "result": ...}   or   {"id": 1, "ok": false, "error": "..."}

import sys
import os
import json
import math
import traceback
import time

try:
    import DaVinciResolveScript as dvr
except Exception as e:  # pragma: no cover
    sys.stdout.write(json.dumps({"id": 0, "ok": False, "error": "Cannot load Resolve's Python module: %s" % e}) + "\n")
    sys.stdout.flush()
    sys.exit(1)

# Things that hang off a node's inputs (splines, paths, followers) are not nodes you edit directly.
MODIFIER_IDS = {
    "BezierSpline", "XYPath", "PolyPath", "Path", "StyledTextFollower", "Follower", "Calculation",
    "Expression", "Publish", "Probe", "Perturb", "Shake", "Wireless", "Cos", "Sin", "Rand", "Ramp",
    "Sine", "Triangle", "Duplicate", "Scale", "Offset",
}

_resolve = None

# The Fusion fixes the panel applies (src/main/fusion-fixes.js; set with the "config" operation).
FIX = {"wakeMode": "all", "wakeOnInsert": True, "retouchText": True,
       "fitFollowerDelay": True, "fitSegments": True, "clipSliderMax": True,
       "wakeLock": False, "highlightProbeFrames": 9}

_items = {}   # item id -> TimelineItem
_comps = {}   # (item id, comp name) -> comp

# Per-request accounting for the panel's perf log (src/main/perf.js): how many Fusion calls an operation made.
COUNTERS = {"toolLists": 0, "getAttrs": 0, "getInputs": 0, "setInputs": 0, "woken": 0, "renders": 0}


def count(k, n=1):
    COUNTERS[k] = COUNTERS.get(k, 0) + n


# Per-request step timings (ms) for the long operations, reported next to the counters: with STEP("keys"): ...
STEPS = {}


class LOCKED(object):
    """comp.Lock() for a batch of changes: Fusion re-evaluates the comp once at Unlock instead of after every
    SetKeyFrames / SetExpression / SetInput (keying one clip's letters took 4 s unlocked). Nests safely."""
    def __init__(self, comp):
        self.comp = comp
        self.ok = False

    def __enter__(self):
        try:
            self.comp.Lock()
            self.ok = True
        except Exception:
            self.ok = False

    def __exit__(self, *a):
        if self.ok:
            try:
                self.comp.Unlock()
            except Exception:
                pass
        return False


class STEP(object):
    def __init__(self, name):
        self.name = name

    def __enter__(self):
        import time
        self.t0 = time.perf_counter()

    def __exit__(self, *a):
        import time
        STEPS[self.name] = STEPS.get(self.name, 0.0) + (time.perf_counter() - self.t0) * 1000.0
        return False


# Within one request a comp's tool list and each tool's attributes are read once (set_text / set_boxes used to walk
# the list and read every tool's attributes 6-8 times: typing frames, retime, segment fit, keyframes, wake, scan).
# Cleared at the start of every request, and whenever a tool is added (op_preview_bg).
_req_tools = {}   # id(comp) -> [tools]
_req_attrs = {}   # id(obj) -> (obj, attrs)
# Across requests: the attributes of a comp's tools, by the tool's position in the tool list, for COMP_ATTRS_TTL
# seconds. A placement sends set_text / set_boxes and then refresh (and highlight_box, multitext_rows) on the same
# comp within a second; each read every tool's attributes again (about 100 calls per request). The comp cannot be
# edited by hand in between (the panel is placing), and the only attribute a request changes, PassThrough, is
# toggled and put back. Dropped when a tool is added (op_preview_bg) or a request on the item fails.
COMP_ATTRS_TTL = 3.0
_comp_key = {}    # id(comp) -> (comp, (item id, comp name)) for the current request
_req_index = {}   # id(tool) -> ((item id, comp name), position in the tool list) for the current request
_comp_attrs = {}  # (item id, comp name) -> {"at": time, "n": tool count, "attrs": {position: attrs}}


def req_cache_clear():
    _req_tools.clear()
    _req_attrs.clear()
    _comp_key.clear()
    _req_index.clear()


def comp_attrs_forget(item_id=None):
    for k in [k for k in _comp_attrs if item_id is None or k[0] == str(item_id)]:
        _comp_attrs.pop(k, None)


def resolve():
    global _resolve
    if _resolve is None:
        _resolve = dvr.scriptapp("Resolve")
    if _resolve is None:
        raise RuntimeError("Could not connect to DaVinci Resolve. In Resolve: Preferences > General > "
                           "External scripting using: Local.")
    return _resolve


def timeline():
    project = resolve().GetProjectManager().GetCurrentProject()
    tl = project.GetCurrentTimeline() if project else None
    if not tl:
        raise RuntimeError("Open a timeline in Resolve")
    return tl


def find_item(item_id):
    item = _items.get(item_id)
    if item is not None:
        try:
            if str(item.GetUniqueId()) == str(item_id):
                _ = item.GetName()
                return item
        except Exception:
            pass
        _items.pop(item_id, None)
    tl = timeline()
    for t in range(1, tl.GetTrackCount("video") + 1):
        for it in tl.GetItemListInTrack("video", t) or []:
            try:
                if str(it.GetUniqueId()) == str(item_id):
                    _items[item_id] = it
                    return it
            except Exception:
                continue
    raise RuntimeError("That clip is not on the timeline any more. Select it again.")


def get_comp(item_id, comp_name=None):
    item = find_item(item_id)
    comp = item.GetFusionCompByName(comp_name) if comp_name else None
    if comp is None:
        count = item.GetFusionCompCount() or 0
        comp = item.GetFusionCompByIndex(count) if count else None
    if comp is None:
        raise RuntimeError("Could not open that clip's composition")
    _comp_key[id(comp)] = (comp, (str(item_id), str(comp_name or "")))
    return comp


def tool_list(comp):
    key = id(comp)
    hit = _req_tools.get(key)
    if hit is not None and hit[0] is comp:
        return list(hit[1])
    count("toolLists")
    tools = comp.GetToolList(False) or {}
    lst = list(tools.values()) if isinstance(tools, dict) else list(tools)
    _req_tools[key] = (comp, lst)
    ck = _comp_key.get(key)
    if ck is not None and ck[0] is comp:
        ckey = ck[1]
        c = _comp_attrs.get(ckey)
        if c is not None and (c["n"] != len(lst) or time.time() - c["at"] > COMP_ATTRS_TTL):
            _comp_attrs.pop(ckey, None)
            c = None
        for i, tool in enumerate(lst):
            _req_index[id(tool)] = (ckey, i, len(lst))
            if c is not None and i in c["attrs"]:
                _req_attrs[id(tool)] = (tool, c["attrs"][i])
                count("attrsReused")
    return list(lst)


def as_list(x):
    if not x:
        return []
    return list(x.values()) if isinstance(x, dict) else list(x)


def attrs(obj):
    key = id(obj)
    hit = _req_attrs.get(key)
    if hit is not None and hit[0] is obj:
        return hit[1]
    count("getAttrs")
    a = obj.GetAttrs() or {}
    # comps and tools keep RegID / Name for their life; the few attributes a request changes (PassThrough) are only
    # ever toggled and put back, so the value read before the toggle stays right
    _req_attrs[key] = (obj, a)
    ix = _req_index.get(key)
    if ix is not None:
        c = _comp_attrs.get(ix[0])
        if c is None or c["n"] != ix[2]:
            c = _comp_attrs[ix[0]] = {"at": time.time(), "n": ix[2], "attrs": {}}
        c["attrs"][ix[1]] = a
    return a


# ---------------------------------------------------------------- operations
def op_fonts(a):
    """Every font family Text+ offers, with the styles its Style box lists for each (Fusion's own font manager)."""
    fu = resolve().Fusion()
    fl = fu.FontManager.GetFontList() or {}
    out = {}
    for fam, styles in fl.items():
        if not fam or str(fam).startswith("."):
            continue
        out[str(fam)] = [str(k) for k in (styles.keys() if isinstance(styles, dict) else as_list(styles))]
    return out


def op_ping(a):
    resolve()
    return True


def op_config(a):
    for k, v in (a or {}).items():
        if k in FIX:
            FIX[k] = v
    return dict(FIX)


def hex_to_rgb(hex_str):
    s = str(hex_str or "#ffffff").strip().lstrip("#")
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    if len(s) != 6:
        return (1.0, 1.0, 1.0)
    try:
        return (int(s[0:2], 16) / 255.0, int(s[2:4], 16) / 255.0, int(s[4:6], 16) / 255.0)
    except Exception:
        return (1.0, 1.0, 1.0)


def apply_layout(tool, lay):
    """Text+ Layout tab values. An input that is keyframed / driven is left alone, so the animation is kept."""
    if not isinstance(lay, dict):
        return

    def put(input_id, value):
        try:
            if is_driven(tool, input_id) is None:
                tool.SetInput(input_id, value)
        except Exception:
            pass

    if lay.get("type") is not None:
        put("LayoutType", int(lay["type"]))
    if lay.get("centerZ") is not None:
        put("CenterZ", float(lay["centerZ"]))
    if lay.get("pivotX") is not None or lay.get("pivotY") is not None:
        cur = as_pt(get_in(tool, "Pivot")) or [0.5, 0.5]
        px = float(lay["pivotX"]) if lay.get("pivotX") is not None else cur[0]
        py = float(lay["pivotY"]) if lay.get("pivotY") is not None else cur[1]
        put("Pivot", {1: px, 2: py, 3: 0.0})
    if lay.get("pivotZ") is not None:
        put("PivotZ", float(lay["pivotZ"]))
    if lay.get("size") is not None:
        put("LayoutSize", float(lay["size"]))
    if lay.get("perspective") is not None:
        put("Perspective", float(lay["perspective"]))


def apply_text_design(tool, td):
    """Only the values present in td are written, and never into an input that is keyframed / driven by a
    modifier, so the preset's animation is left exactly as it was built."""
    if not td or not isinstance(td, dict):
        return

    def put(input_id, value):
        try:
            if is_driven(tool, input_id) is not None:
                return
            cur = get_in(tool, input_id)
            if isinstance(value, float) and isinstance(cur, (int, float)) and abs(float(cur) - value) < 1e-9:
                return
            if cur == value:
                return
            tool.SetInput(input_id, value)
        except Exception:
            pass

    apply_layout(tool, td.get("layout"))
    if td.get("font"):
        put("Font", str(td["font"]))
    if td.get("style") is not None:
        put("Style", str(td["style"]))
    if td.get("size") is not None:
        put("Size", float(td["size"]))
    if td.get("tracking") is not None:
        put("CharacterSpacing", float(td["tracking"]))
    if td.get("lineSpacing") is not None:
        put("LineSpacing", float(td["lineSpacing"]))
    for k, iid in (("vAnchor", "VerticalTopCenterBottom"), ("vJustify", "VerticallyJustified"),
                   ("hAnchor", "HorizontalLeftCenterRight"), ("hJustify", "HorizontallyJustified")):
        if td.get(k) is not None:
            put(iid, float(td[k]))
    for k, iid in (("direction", "Direction"), ("lineDirection", "LineDirection"),
                   ("strikeout", "Strikeout"), ("underline", "Underline")):
        if td.get(k) is not None:
            put(iid, int(round(float(td[k]))))

    elements = td.get("elements")
    if not isinstance(elements, list):
        return
    for el in elements:
        if not isinstance(el, dict):
            continue
        try:
            idx = int(el.get("index") or 0)
        except Exception:
            continue
        if idx < 1 or idx > 8:
            continue
        if el.get("enabled") is not None:
            put("Enabled%d" % idx, 1 if el["enabled"] else 0)
        if el.get("name"):
            put("Name%d" % idx, str(el["name"]))
        if el.get("opacity") is not None:
            put("Opacity%d" % idx, float(el["opacity"]))
        if el.get("type") is not None:
            put("Type%d" % idx, int(el["type"]))
        if el.get("shape") is not None:
            put("ElementShape%d" % idx, int(el["shape"]))
        if el.get("thickness") is not None:
            put("Thickness%d" % idx, float(el["thickness"]))
        if el.get("level") is not None:
            put("Level%d" % idx, int(el["level"]))
        if el.get("extendH") is not None:
            put("ExtendHorizontal%d" % idx, float(el["extendH"]))
        if el.get("extendV") is not None:
            put("ExtendVertical%d" % idx, float(el["extendV"]))
        if el.get("round") is not None:
            put("Round%d" % idx, float(el["round"]))
        if el.get("color"):
            r, g, b = hex_to_rgb(el["color"])
            put("Red%d" % idx, r)
            put("Green%d" % idx, g)
            put("Blue%d" % idx, b)
        if el.get("mappingAngle") is not None:
            put("MappingAngle%d" % idx, float(el["mappingAngle"]))
        if el.get("mappingSize") is not None:
            put("MappingSize%d" % idx, float(el["mappingSize"]))
        if el.get("mappingAspect") is not None:
            put("MappingAspect%d" % idx, float(el["mappingAspect"]))
        if el.get("mappingLevel") is not None:
            put("MappingLevel%d" % idx, int(el["mappingLevel"]))
        grad_type = el.get("type")
        if grad_type is None:
            try:
                grad_type = int(get_in(tool, "Type%d" % idx) or 0)
            except Exception:
                grad_type = 0
        if grad_type == 2 and (el.get("type") is not None or el.get("color") or el.get("color2")):
            # Fusion keeps a gradient as {position: [r, g, b, a]}; both stops are always written together, so a
            # change of only one colour (or only switching to Gradient) still gives the gradient you see in the panel.
            try:
                cur = get_in(tool, "ShadingGradient%d" % idx)
                stops = {}
                try:
                    stops = dict(cur.Value) if cur is not None else {}
                except Exception:
                    stops = {}

                def stop(key, fallback):
                    v = stops.get(key)
                    try:
                        return [float(v[1]), float(v[2]), float(v[3])] if v is not None else fallback
                    except Exception:
                        return fallback
                keys = sorted(stops.keys()) if stops else []
                c1 = list(hex_to_rgb(el["color"])) if el.get("color") else (
                    [float(get_in(tool, "Red%d" % idx) or 1), float(get_in(tool, "Green%d" % idx) or 1), float(get_in(tool, "Blue%d" % idx) or 1)])
                c2 = list(hex_to_rgb(el["color2"])) if el.get("color2") else stop(keys[-1] if keys else 1.0, [1.0, 1.0, 1.0])
                # stop positions: the ones sent, else the gradient's own first / last stop (else 0 and 1)
                p1 = float(el["stop1"]) if el.get("stop1") is not None else (float(keys[0]) if keys else 0.0)
                p2 = float(el["stop2"]) if el.get("stop2") is not None else (float(keys[-1]) if keys else 1.0)
                p1 = max(0.0, min(1.0, p1))
                p2 = max(p1, min(1.0, p2))
                if p2 - p1 < 1e-6:
                    p1, p2 = (p1, min(1.0, p1 + 1e-3)) if p1 < 1.0 else (p1 - 1e-3, p1)
                tool.SetInput("ShadingGradient%d" % idx, {p1: c1 + [1.0], p2: c2 + [1.0]})
            except Exception:
                pass
        if el.get("softness") is not None:
            soft = float(el["softness"])
            put("SoftnessX%d" % idx, soft)
            put("SoftnessY%d" % idx, soft)
        if el.get("offsetX") is not None or el.get("offsetY") is not None:
            cur = as_pt(get_in(tool, "Offset%d" % idx)) or [0.0, 0.0]
            ox = float(el["offsetX"]) if el.get("offsetX") is not None else cur[0]
            oy = float(el["offsetY"]) if el.get("offsetY") is not None else cur[1]
            put("Offset%d" % idx, {1: ox, 2: oy, 3: 0.0})


# Tools a wake must not switch: I/O and plumbing nodes (toggling MediaOut/Saver/MediaIn can drop the clip's
# image), and group/macro containers (their own tools are in the list and are woken one by one).
WAKE_SKIP = {"MediaIn", "MediaOut", "Saver", "Loader", "AudioDisplay", "Note", "Underlay", "PipeRouter",
             "GroupOperator", "MacroOperator"}
# Modifiers have no pass-through; the tool they drive is woken instead, which re-renders their result.
WAKE_MODIFIERS = {"BezierSpline", "CubicSpline", "LUTBezier", "XYPath", "PolyPath", "Path", "PerturbNumber",
                  "PerturbPoint", "Calculation", "Expression", "Shake", "KeyStretcher", "PublishNumber",
                  "PublishPoint", "PublishText", "PublishPolyLine", "PublishImage", "Probe", "Offset"}


def wake_effects(comp):
    """Wakes every effect in a freshly inserted title so Resolve renders it exactly as it was built.

    Right after insertion Resolve can render a title as if parts of it were missing: a Text+ Follower's
    overrides (a word-by-word reveal stays blank, a fly-in sits still), and likewise any other effect in the
    template (Transform, Displace, FastNoise, Dissolve, BrightnessContrast, wiggles, macro contents...).
    So: every Follower's enabled shading elements are switched off and on, and every other effect tool is
    put in pass-through and back. Nothing changes value; tools already in pass-through are left alone."""
    mode = FIX.get("wakeMode", "all")
    if mode == "off":
        return 0
    try:
        tools = tool_list(comp)
    except Exception:
        return 0
    woken = 0
    # wakeLock (Fusion fix, off by default): the toggles happen inside comp.Lock() / Unlock(), so Resolve re-renders
    # the comp once at the end instead of once per toggle. Whether a locked wake still "wakes" a blank title is what
    # the blank-render check (MCP verify_placed) is for.
    locked = False
    if FIX.get("wakeLock"):
        try:
            comp.Lock()
            locked = True
        except Exception:
            locked = False
    try:
        for tool in tools:
            rid = None
            try:
                a = attrs(tool)
                rid = a.get("TOOLS_RegID")
                if rid in FOLLOWERS:
                    for i in range(1, 9):
                        key = "Enabled%d" % i
                        count("getInputs")
                        if tool.GetInput(key) == 1:
                            tool.SetInput(key, 0)
                            tool.SetInput(key, 1)
                            count("setInputs", 2)
                    woken += 1
                elif mode == "followers" or rid in WAKE_SKIP or rid in WAKE_MODIFIERS or a.get("TOOLB_PassThrough"):
                    continue
                else:
                    tool.SetAttrs({"TOOLB_PassThrough": True})
                    tool.SetAttrs({"TOOLB_PassThrough": False})
                    count("setInputs", 2)
                    woken += 1
            except Exception:
                # never leave a tool switched off because a later call failed
                try:
                    if rid not in FOLLOWERS and rid not in WAKE_SKIP and rid not in WAKE_MODIFIERS:
                        tool.SetAttrs({"TOOLB_PassThrough": False})
                except Exception:
                    pass
    finally:
        if locked:
            try:
                comp.Unlock()
            except Exception:
                pass
    count("woken", woken)
    WAKE_RAN[0] = True
    return woken


WAKE_RAN = [False]   # set when a wake ran in the current request (handle: such a request is not retried)


wake_followers = wake_effects   # older name


def set_typing_frames(comp, frames, clip_frames=None):
    """Word-by-word typing presets: their "Typing Frames" slider = how long the typing takes on this clip; like the
    Animation Frames slider, it runs up to the clip's length."""
    if frames is None:
        return
    for tool in tool_list(comp):
        try:
            if get_in(tool, "TypingFrames") is not None:
                tool.SetInput("TypingFrames", int(frames))
                if clip_frames and FIX.get("clipSliderMax", True):
                    set_slider_max(tool, "TypingFrames", max(1, int(clip_frames)))
                    if get_in(tool, "TypingStart") is not None:
                        set_slider_max(tool, "TypingStart", max(1, int(clip_frames)))
        except Exception:
            pass


def set_slider_max(tool, input_id, top):
    """The slider's range on this clip: 0 .. top (the clip's length in frames)."""
    try:
        uc = tool.UserControls
        ctl = uc and uc.get(input_id)
        if not ctl or ctl.get("INP_MaxScale") == top:
            return
        ctl["INP_MaxScale"] = top
        uc[input_id] = ctl
        tool.UserControls = uc
        tool.Refresh()
    except Exception:
        pass


def init_retime(comp, clip_frames):
    """Presets with the Animation Frames slider (src/main/retime.js): the slider starts at the frame the effect ends at
    with the preset's own timing (for the text it holds now, at most the clip's length), and runs up to the clip's length."""
    if not clip_frames:
        return
    top = max(1, int(clip_frames))
    for tool in tool_list(comp):
        try:
            if get_in(tool, "AnimFrames") is None:
                continue
            nat = get_in(tool, "AnimNatural")
            n = int(round(float(nat))) if nat is not None else 0
            if n > top and FIX.get("fitFollowerDelay", True) and fit_follower_delay(comp, float(nat), top):
                # the letters now land inside the clip at normal speed: no remap needed
                tool.SetInput("AnimFrames", 0)
            else:
                restore_follower_delay(comp)
                tool.SetInput("AnimFrames", max(1, min(top, n)) if n > 0 else 0)
            if FIX.get("clipSliderMax", True):
                set_slider_max(tool, "AnimFrames", top)
        except Exception:
            pass


def fit_follower_delay(comp, natural, top):
    """A clip shorter than the preset's natural animation cannot be fitted by the AnimTime remap: it would have to read
    the text node past comp.RenderEnd, so the remap clamps there and the animation freezes part-way (e.g. the last word
    of "Kinetic Statements" stuck mid-overshoot, glued to the word before it). When one Follower's per-letter Delay
    sets the natural length (natural = per-letter animation + Delay x (letters - 1)), shorten that Delay so the last
    letter lands on the clip's last frame instead. Returns True when it did."""
    fol = []
    for t in tool_list(comp):
        try:
            if attrs(t).get("TOOLS_RegID") in FOLLOWERS and float(base_delay(t) or 0) > 0:
                fol.append(t)
        except Exception:
            pass
    if len(fol) != 1:
        return False
    f = fol[0]
    try:
        d = float(base_delay(f))  # the preset's own Delay: AnimNatural was worked out from it
        txt = get_in(f, "Text")
        letters = len(str(txt if txt is not None else "").replace("\r", "").replace("\n", ""))
        if letters < 2:
            return False
        per_letter = natural - d * (letters - 1)
        if per_letter <= 0 or per_letter >= top - 1:
            return False
        nd = (top - 1 - per_letter) / (letters - 1)
        if nd >= d:
            return False
        try:
            if f.GetData(BASE_DELAY_KEY) is None:
                f.SetData(BASE_DELAY_KEY, d)
        except Exception:
            pass
        f.SetInput("Delay", round(nd, 4))
        return True
    except Exception:
        return False


BASE_DELAY_KEY = "ElSA.BaseDelay"


def restore_follower_delay(comp):
    """Undo fit_follower_delay (the clip got long enough again, e.g. after a text change)."""
    for t in tool_list(comp):
        try:
            v = t.GetData(BASE_DELAY_KEY)
            if v is not None and attrs(t).get("TOOLS_RegID") in FOLLOWERS:
                t.SetInput("Delay", float(v))
        except Exception:
            pass


def base_delay(f):
    """The follower's Delay before fit_follower_delay shortened it (re-timing after a text change starts from it)."""
    try:
        v = f.GetData(BASE_DELAY_KEY)
        if v is not None:
            return float(v)
    except Exception:
        pass
    return get_in(f, "Delay")




def op_set_text(a):
    comp = get_comp(a["item"], a.get("comp"))
    found = False
    all_tools = tool_list(comp)
    has_follower = False
    if a.get("text") is not None:
        for mod in all_tools:
            if attrs(mod).get("TOOLS_RegID") in ("StyledTextFollower", "Follower"):
                try:
                    if mod.GetData(BAKE_DATA):
                        continue        # a baked Kinetic row: its text comes from the Template (bake_rows)
                    mod.SetInput("Text", a["text"])
                    has_follower = True
                except Exception:
                    pass
    for tool in tool_list(comp):
        if attrs(tool).get("TOOLS_RegID") == "TextPlus" and not is_mirror(tool):
            if a.get("text") is not None and not has_follower:
                tool.SetInput("StyledText", a["text"])
            if a.get("textDesign"):
                apply_text_design(tool, a["textDesign"])
            found = True
            break
    if a.get("light"):      # a text edit on a clip already placed: no timing / retime / wake pass (see liveUpdate)
        try:                # ...but Kinetic rows follow a changed row count, a box sweep its letter count
            rekey_comp(comp, a.get("item"))
        except Exception:
            pass
        return found
    with LOCKED(comp):
        with STEP("typing"):
            set_typing_frames(comp, a.get("typingFrames"), a.get("clipFrames"))
        with STEP("retime"):
            init_retime(comp, a.get("clipFrames"))
        with STEP("segments"):
            lead_single_segment(comp)
            fit_segments(comp, a.get("clipFrames"))
        with STEP("keys"):
            key_followers(comp)
    if FIX.get("wakeOnInsert", True):
        with STEP("wake"):
            wake_effects(comp)
    return found


# ---------------------------------------------------------------- text boxes (Text+ / template nodes)
FOLLOWERS = ("StyledTextFollower", "Follower")


def get_in(tool, name):
    count("getInputs")
    try:
        return tool.GetInput(name)
    except Exception:
        return None


def as_pt(v):
    try:
        if isinstance(v, dict):
            ks = sorted(v.keys(), key=lambda k: float(k))
            return [float(v[ks[0]]), float(v[ks[1]])]
        return [float(v[0]), float(v[1])]
    except Exception:
        return None


def is_mirror(tool):
    """A helper Text+ whose text is an expression of another node's text (e.g. the highlight box of "Highlight
    Select", which copies the MultiText's emphasis). It is not a text box: the plugin never writes text or design to it."""
    try:
        if tool.StyledText.GetExpression():
            return True
        # or its text comes through a follower whose own text is that expression
        d = is_driven(tool, "StyledText")
        if d is not None and attrs(d).get("TOOLS_RegID") in FOLLOWERS and d.Text.GetExpression():
            return True
        # or it is a Kinetic / Justified Pop row whose expressions were baked (bake_rows): still the Template's copy
        return bool(tool.GetData(BAKE_DATA))
    except Exception:
        return False


def is_driven(tool, input_id):
    """The modifier (spline, path, follower...) plugged into an input, or None."""
    try:
        inp = getattr(tool, input_id)
        out = inp.GetConnectedOutput()
        if out:
            return out.GetTool()
    except Exception:
        pass
    return None


def expr_inputs(tool):
    """The ids of the tool's expression-driven inputs (one scan of the input list; e.g. the row layout of a
    MultiText with Row controls)."""
    out = set()
    try:
        for inp in as_list(tool.GetInputList()):
            try:
                if inp.GetExpression():
                    out.add(attrs(inp).get("INPS_ID"))
            except Exception:
                pass
    except Exception:
        pass
    return out


def describe(tool, light=False):
    """light: only what each node is (id / kind / tool / label), no text, position or size reads. The scan at the
    end of set_boxes only counts the nodes for the panel's status line, and read 3 inputs per node (16 layers
    of a MultiText) while Fusion was busy with the fresh clip."""
    at = attrs(tool)
    rid = at.get("TOOLS_RegID")
    name = at.get("TOOLS_Name")
    if rid == "TextPlus":
        if is_mirror(tool):
            return []
        if light:
            return [{"id": name, "kind": "textplus", "tool": name, "input": "StyledText", "centerInput": "Center", "label": "Text+ · %s" % name}]
        txt = get_in(tool, "StyledText")
        return [{"id": name, "kind": "textplus", "tool": name, "input": "StyledText", "centerInput": "Center",
                 "label": "Text+ · %s" % name, "text": txt if isinstance(txt, str) else "",
                 "pt": as_pt(get_in(tool, "Center")), "size": get_in(tool, "Size")}]
    out = []
    if rid == "MultiText":
        layers = []
        try:
            order = get_in(tool, "TextOrder")
            if isinstance(order, dict):
                # Resolve adds bookkeeping keys to the table ("__flags": 256): only the numbered entries are layers
                layers = sorted(set(int(float(v)) for k, v in order.items() if not str(k).startswith("__")))
        except Exception:
            layers = []
        if not layers:
            layers = [n for n in range(1, 17) if isinstance(get_in(tool, "Text%d.StyledText" % n), str)]
        for n in layers:
            if light:
                out.append({"id": "%s/Text%d" % (name, n), "kind": "multitext", "tool": name, "input": "Text%d.StyledText" % n,
                            "centerInput": "Text%d.Center" % n, "label": "MultiText · Text %d" % n, "layer": n})
                continue
            txt = get_in(tool, "Text%d.StyledText" % n)
            nm = get_in(tool, "TextName%d" % n)
            nm = nm if isinstance(nm, str) and nm else "Text %d" % n
            out.append({"id": "%s/Text%d" % (name, n), "kind": "multitext", "tool": name,
                        "input": "Text%d.StyledText" % n, "centerInput": "Text%d.Center" % n,
                        "label": "MultiText · %s" % nm, "layer": n, "layerName": nm,
                        "text": txt if isinstance(txt, str) else "",
                        "pt": as_pt(get_in(tool, "Text%d.Center" % n)), "size": get_in(tool, "Text%d.Size" % n)})
        return out
    if rid in ("MacroOperator", "GroupOperator"):
        try:
            for inp in as_list(tool.GetInputList()):
                ia = attrs(inp)
                if ia.get("INPS_DataType") == "Text" and ia.get("INPS_ID"):
                    iid = ia.get("INPS_ID")
                    if light:
                        out.append({"id": "%s/%s" % (name, iid), "kind": "template", "tool": name, "input": iid,
                                    "label": "Template · %s" % (ia.get("INPS_Name") or name)})
                        continue
                    txt = get_in(tool, iid)
                    out.append({"id": "%s/%s" % (name, iid), "kind": "template", "tool": name, "input": iid,
                                "label": "Template · %s" % (ia.get("INPS_Name") or name),
                                "text": txt if isinstance(txt, str) else ""})
        except Exception:
            pass
    return out


def op_scan(a):
    """What Fusion really has in this clip's composition: every Text+ and every template with a text input.
    a.light: kinds only (see describe)."""
    comp = get_comp(a["item"], a.get("comp"))
    nodes = []
    light = bool(a.get("light"))
    for tool in tool_list(comp):
        nodes.extend(describe(tool, light))
    return {"nodes": nodes}


def set_node_text(tool, input_id, text, all_tools, first):
    driver = is_driven(tool, input_id)
    if driver is not None and attrs(driver).get("TOOLS_RegID") in FOLLOWERS:
        driver.SetInput("Text", text)
        return
    if driver is None and first:
        # Older helpers could not see connections: fall back to setting any follower in the comp - except the
        # followers that already drive another Text+, so each Text+ keeps its own text.
        owned = set()
        for t in all_tools:
            try:
                if attrs(t).get("TOOLS_RegID") == "TextPlus" and t is not tool:
                    d = is_driven(t, "StyledText")
                    if d is not None:
                        owned.add(attrs(d).get("TOOLS_Name"))
            except Exception:
                pass
        hit = False
        for mod in all_tools:
            if attrs(mod).get("TOOLS_RegID") in FOLLOWERS and attrs(mod).get("TOOLS_Name") not in owned:
                try:
                    mod.SetInput("Text", text)
                    hit = True
                except Exception:
                    pass
        if hit:
            return
    tool.SetInput(input_id, text)


def size_multitext(tool, f=1.0, max_size=None, line_spacing=None):
    """Resize a whole MultiText by f around its layers' common centre. Each layer's font size, layout box and
    distance from that centre scale together, so the gaps between layers and the line wrapping stay the same.
    max_size: f is lowered so the biggest layer's Size is at most this. line_spacing: each layer's Line Spacing,
    and the gaps between layers grow or shrink by the same ratio (new / the layers' current spacing).
    Inputs driven by a modifier (animated) are left alone and named in "skipped"."""
    layers, sizes = [], []
    for n in range(1, 65):              # the layers are numbered without gaps: the first missing Size ends the scan
        v = get_in(tool, "Text%d.Size" % n)
        if v is None:
            break
        layers.append(n)
        sizes.append(float(v))
    res = {"skipped": [], "capped": False}
    if not layers:
        return res
    if max_size and max(sizes) * f > float(max_size):
        f = float(max_size) / max(sizes)
        res["capped"] = True
    gap = 1.0
    if line_spacing:
        cur = [get_in(tool, "Text%d.LineSpacing" % n) for n in layers]
        cur = [float(v) for v in cur if isinstance(v, (int, float)) and v > 0] or [1.0]
        gap = float(line_spacing) / (sum(cur) / len(cur))
    if abs(f - 1.0) < 1e-6 and abs(gap - 1.0) < 1e-6 and not line_spacing:
        return res
    skipped = res["skipped"]
    if line_spacing:
        for n in layers:
            pre = "Text%d." % n
            if is_driven(tool, pre + "LineSpacing") is not None:
                skipped.append("%s (LineSpacing)" % (get_in(tool, "TextName%d" % n) or ("Text %d" % n)))
                continue
            try:
                tool.SetInput(pre + "LineSpacing", float(line_spacing))
            except Exception:
                pass
    centres = {n: as_pt(get_in(tool, "Text%d.Center" % n)) for n in layers}
    exprs = expr_inputs(tool) if abs(f * gap - 1.0) > 1e-6 else set()
    pts = [c for c in centres.values() if c]
    ax = (min(p[0] for p in pts) + max(p[0] for p in pts)) / 2 if pts else 0.5
    ay = (min(p[1] for p in pts) + max(p[1] for p in pts)) / 2 if pts else 0.5
    for n in layers:
        pre = "Text%d." % n
        name = get_in(tool, "TextName%d" % n) or ("Text %d" % n)
        for k in (("Size", "LayoutWidth", "LayoutHeight") if abs(f - 1.0) > 1e-6 else ()):
            v = get_in(tool, pre + k)
            if not isinstance(v, (int, float)):
                continue
            if is_driven(tool, pre + k) is not None:
                skipped.append("%s (%s)" % (name, k))
                continue
            try:
                tool.SetInput(pre + k, float(v) * f)
            except Exception:
                skipped.append("%s (%s)" % (name, k))
        c = centres.get(n)
        k = f * gap
        if c and abs(k - 1.0) > 1e-6 and (pre + "Center") in exprs:
            continue                                   # Row controls (tools/add-multitext-row-controls.py): the rows follow the sizes
        if c and abs(k - 1.0) > 1e-6:
            if is_driven(tool, pre + "Center") is not None:
                skipped.append("%s (Center)" % name)
            else:
                try:
                    tool.SetInput(pre + "Center", {1: ax + (c[0] - ax) * k, 2: ay + (c[1] - ay) * k, 3: 0.0})
                except Exception:
                    skipped.append("%s (Center)" % name)
    return res


def set_highlight_bg(comp, tpl, prefix, hex_color):
    """Colour the background box behind a MultiText layer (Highlight Select's box, Glass Pill's pill, Soft Marker,
    Underline Draw): a mirror Text+ drawing an element-1 background (ElementShape1 = 2) whose colour comes from the
    template, either from its own "Highlight Color" control (Template.HighlightRed ...) or linked to the layer's text
    colour (Template.Text2.Red1 ...). A linked box is unlinked so the word and its box can differ. Returns True when a
    box was coloured, False when the preset has none."""
    r, g, bl = hex_to_rgb(hex_color)
    tname = attrs(tpl).get("TOOLS_Name") or "Template"
    done = False
    for t in tool_list(comp):
        try:
            if t is tpl or attrs(t).get("TOOLS_RegID") != "TextPlus" or not is_mirror(t):
                continue
            if int(get_in(t, "ElementShape1") or 0) != 2:
                continue
            ex = ""
            try:
                ex = t.Red1.GetExpression() or ""
            except Exception:
                pass
            if tname + ".Highlight" in ex and get_in(tpl, "HighlightRed") is not None:
                for ch, v in (("HighlightRed", r), ("HighlightGreen", g), ("HighlightBlue", bl)):
                    tpl.SetInput(ch, v)
                done = True
            elif prefix and (tname + "." + prefix + ".") in ex:
                for ch, v in (("Red1", r), ("Green1", g), ("Blue1", bl)):
                    try:
                        getattr(t, ch).SetExpression(None)
                    except Exception:
                        pass
                    t.SetInput(ch, v)
                done = True
        except Exception:
            pass
    return done


# ---------------------------------------------------------------- highlight box size / position
# The box of a highlight preset (Highlight Select, Glass Pill, Pill Soft/Outline/Solid, Soft Marker, Underline Draw) is
# a mirror Text+ whose shading element 1 is a background shape (ElementShape1 = 2), with extra pill layers (outline,
# white fill) as more background elements. Width / height multiply each element's SizeX / SizeY on top of the
# preset's own pop / wipe expression; x / y move its Offset. The preset's own values are kept in the tool's data
# (HL_KEY) so applying again never stacks. auto evens out the padding: it renders the box and the word's ink and
# sizes / centres the box so the visible space around the word is the same on every side (a pill's rounded ends get
# the extra width they need to look as wide as the top and bottom).
HL_KEY = "ElsaHighlightBox"


def hl_tools(comp):
    out = []
    for t in tool_list(comp):
        try:
            if attrs(t).get("TOOLS_RegID") == "TextPlus" and is_mirror(t) and int(get_in(t, "ElementShape1") or 0) == 2:
                out.append(t)
        except Exception:
            pass
    return out


def hl_expr(tool, inp):
    try:
        return getattr(tool, inp).GetExpression() or None
    except Exception:
        return None


def hl_elements(tool):
    """Shading elements drawn as a background (2) or border (3) shape."""
    out = [1]
    for n in range(2, 9):
        try:
            if float(get_in(tool, "Enabled%d" % n) or 0) >= 0.5 and int(get_in(tool, "ElementShape%d" % n) or 0) in (2, 3):
                out.append(n)
        except Exception:
            pass
    return out


def hl_original(tool):
    try:
        raw = tool.GetData(HL_KEY)
        if raw:
            return json.loads(raw)
    except Exception:
        pass
    orig = {}
    for n in hl_elements(tool):
        e = {}
        for k in ("SizeX", "SizeY"):
            inp = "%s%d" % (k, n)
            e[k] = {"e": hl_expr(tool, inp), "v": num(get_in(tool, inp), 1.0), "d": is_driven(tool, inp) is not None}
        inp = "Offset%d" % n
        e["Offset"] = {"e": hl_expr(tool, inp), "v": as_pt(get_in(tool, inp)) or [0.0, 0.0], "d": is_driven(tool, inp) is not None}
        orig[str(n)] = e
    try:
        tool.SetData(HL_KEY, json.dumps(orig))
    except Exception:
        pass
    return orig


HL_CTRL = ("HighlightWidth", "HighlightHeight", "HighlightX", "HighlightY")


def hl_controls(comp):
    """The Template tool when the preset has the Box Width / Height / X / Y Inspector controls
    (tools/add-highlight-box-controls.py), else None."""
    try:
        t = comp.FindTool("Template")
        if t is not None and get_in(t, "HighlightWidth") is not None:
            return t
    except Exception:
        pass
    return None


def hl_set(tool, orig, w, h, dx, dy, ctrl=None):
    """The preset's own box times w / h, moved by dx / dy (Offset units). 1, 1, 0, 0 restores the preset's box.
    With ctrl (the Template that has the Box controls) the values go into those Inspector controls, which the box's
    expressions read, so the user can fine-tune them in the Inspector afterwards."""
    if ctrl is not None:
        hl_set(tool, orig, 1.0, 1.0, 0.0, 0.0)             # put back any expression hl_ink took off
        for k, v in zip(HL_CTRL, (w, h, dx, dy)):
            try:
                ctrl.SetInput(k, float(v))
            except Exception:
                pass
        return
    import re
    tname = attrs(tool).get("TOOLS_Name") or ""
    for n, e in orig.items():
        for k, m in (("SizeX", w), ("SizeY", h)):
            o, inp = e[k], k + n
            ex = o.get("e")
            if o.get("d"):
                continue                                    # animated by a spline: leave it
            if ex and re.fullmatch(r"\s*%s\.%s\d+\s*" % (re.escape(tname), k), ex):
                continue                                    # linked to element 1: follows it
            try:
                if abs(m - 1.0) < 1e-6:
                    if ex:
                        getattr(tool, inp).SetExpression(ex)
                    else:
                        getattr(tool, inp).SetExpression(None)
                        tool.SetInput(inp, float(o["v"]))
                elif ex:
                    body = ex.lstrip()[1:] if ex.lstrip().startswith(":") else "return (" + ex + ")"
                    getattr(tool, inp).SetExpression(": local function __o()\n%s\nend\nreturn __o() * %.5f" % (body, m))
                else:
                    getattr(tool, inp).SetExpression(None)
                    tool.SetInput(inp, float(o["v"]) * m)
            except Exception:
                pass
        o, inp = e["Offset"], "Offset" + n
        if o.get("d") or o.get("e"):
            continue
        try:
            v = o.get("v") or [0.0, 0.0]
            tool.SetInput(inp, {1: float(v[0]) + dx, 2: float(v[1]) + dy, 3: 0.0})
        except Exception:
            pass


def hl_window(tool, t):
    """The rendered pixels' bounding box [x0, y0, x1, y1] (y up), or None."""
    try:
        count("renders")
        img = tool.Output.GetValue(t)
        d = img.DataWindow if img is not None else None
        if not d:
            return None
        x0, y0, x1, y1 = float(d[1]), float(d[2]), float(d[3]), float(d[4])
        W, H = num(img.Width, 0), num(img.Height, 0)
        if x1 - x0 < 2 or y1 - y0 < 2 or (W and H and x1 - x0 >= W * 0.995 and y1 - y0 >= H * 0.995):
            return None
        return [x0, y0, x1, y1]
    except Exception:
        return None


def hl_full_time(comp, tool):
    """The frame where the box is widest (a wipe has finished, a pop has settled, the outro has not started)."""
    a = attrs(comp)
    s, e = num(a.get("COMPN_RenderStart"), 0), num(a.get("COMPN_RenderEnd"), 0)
    probes = int(num(FIX.get("highlightProbeFrames"), 9) or 9)
    best, best_t = -1, None

    def look(t):
        nonlocal best, best_t
        b = hl_window(tool, t)
        if b and b[2] - b[0] > best + 0.5:
            best, best_t = b[2] - b[0], t

    if probes >= 9:
        for i in range(9):
            look(int(round(s + (e - s) * (0.3 + 0.075 * i))))
        return best_t
    # coarse-to-fine (Fusion fix highlightProbeFrames < 9): 3 probes across the same 30%-90% span, then the two
    # frames half a step either side of the widest one. A wipe grows then holds, so the widest spot is found with 5 renders.
    steps = [0.3, 0.6, 0.9]
    for f in steps:
        look(int(round(s + (e - s) * f)))
    if best_t is None:
        return None
    for d in (-0.15, 0.15):
        f = (best_t - s) / float(e - s) + d if e > s else 0.0
        if 0.0 <= f <= 1.0:
            look(int(round(s + (e - s) * f)))
    return best_t


def hl_ink(tool, orig, t):
    """The word's own pixels: element 1 drawn as text, unscaled, the other box layers off."""
    others = [int(n) for n in orig.keys() if n != "1"]
    saved = {}
    try:
        for n in others:
            if not hl_expr(tool, "Enabled%d" % n):
                saved[n] = get_in(tool, "Enabled%d" % n)
                tool.SetInput("Enabled%d" % n, 0)
        for inp in ("SizeX1", "SizeY1"):
            if not orig["1"][inp[:-1]].get("d"):
                getattr(tool, inp).SetExpression(None)
                tool.SetInput(inp, 1.0)
        if not orig["1"]["Offset"].get("d") and not orig["1"]["Offset"].get("e"):
            tool.SetInput("Offset1", {1: 0.0, 2: 0.0, 3: 0.0})
        tool.SetInput("ElementShape1", 0)
        return hl_window(tool, t)
    finally:
        tool.SetInput("ElementShape1", 2)
        for n, v in saved.items():
            tool.SetInput("Enabled%d" % n, v if v is not None else 1)
        hl_set(tool, orig, 1.0, 1.0, 0.0, 0.0)


def hl_center(b):
    return ((b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0)


def hl_adjust(comp, tool, W, H, X, Y, auto):
    import math
    orig = hl_original(tool)
    ctrl = hl_controls(comp)
    hl_set(tool, orig, 1.0, 1.0, 0.0, 0.0, ctrl)
    name = attrs(tool).get("TOOLS_Name")
    if not auto and abs(W - 1) < 1e-6 and abs(H - 1) < 1e-6 and abs(X) < 1e-6 and abs(Y) < 1e-6:
        return {"tool": name, "reset": True}
    if not auto:
        hl_set(tool, orig, W, H, X, Y, ctrl)
        return {"tool": name, "width": W, "height": H, "offset": [X, Y]}
    # Rendering a Text+ whose text comes through a Follower (Highlight Select, Soft Marker, Underline Draw) from a
    # script crashed Resolve (2026-11-09): those boxes are never measured, they only get the sliders.
    if is_driven(tool, "StyledText") is not None:
        hl_set(tool, orig, W, H, X, Y, ctrl)
        return {"tool": name, "width": W, "height": H, "offset": [X, Y], "note": "Follower-driven box: not measured, sliders only"}
    t = hl_full_time(comp, tool)
    box = hl_window(tool, t) if t is not None else None
    if box is None:
        hl_set(tool, orig, W, H, X, Y, ctrl)
        return {"tool": name, "note": "the box did not render, so only the sliders were applied"}
    bw, bh = box[2] - box[0], box[3] - box[1]
    tw, th = bw * W, bh * H
    tcx, tcy = hl_center(box)
    out = {"tool": name, "frame": t}
    if auto:
        ink = hl_ink(tool, orig, t)
        # only a box that covers the word (not an underline / a marker stripe) is balanced
        if ink and box[1] <= ink[1] + 2 and box[3] >= ink[3] - 2:
            iw, ih = ink[2] - ink[0], ink[3] - ink[1]
            pv0 = ((box[3] - ink[3]) + (ink[1] - box[1])) / 2.0
            th = max(ih * 1.02, (ih + 2 * pv0) * H)
            pv = (th - ih) / 2.0
            hh = th / 2.0
            r = min(hh, max(0.0, num(get_in(tool, "Round1"), 0)) * 2 * hh)
            dyc = ih / 2.0 - (hh - r)
            inset = (r - math.sqrt(max(0.0, r * r - dyc * dyc))) if dyc > 0 else 0.0
            tw = (iw + 2 * (pv + inset)) * W
            tcx, tcy = hl_center(ink)
            out["balanced"] = {"pad": round(pv, 1), "sidePad": round(pv + inset, 1)}
        else:
            out["note"] = "not a full box (underline / marker): only the sliders were applied"
    wm, hm = tw / bw, th / bh
    hl_set(tool, orig, wm, hm, 0.0, 0.0, ctrl)
    b0 = hl_window(tool, t)
    if b0:                                                  # SizeX / SizeY may not scale exactly linearly: one fix-up
        wm *= tw / max(1.0, b0[2] - b0[0])
        hm *= th / max(1.0, b0[3] - b0[1])
        hl_set(tool, orig, wm, hm, 0.0, 0.0, ctrl)
        b0 = hl_window(tool, t)
    dx = dy = 0.0
    if b0:
        probe = 0.05                                        # Offset units -> pixels, measured
        hl_set(tool, orig, wm, hm, probe, probe, ctrl)
        b1 = hl_window(tool, t)
        c0, c1 = hl_center(b0), (hl_center(b1) if b1 else None)
        if c1:
            kx, ky = (c1[0] - c0[0]) / probe, (c1[1] - c0[1]) / probe
            dx = (tcx - c0[0]) / kx if abs(kx) > 1 else 0.0
            dy = (tcy - c0[1]) / ky if abs(ky) > 1 else 0.0
    dx, dy = dx + X, dy + Y                                 # the user's nudge, in Offset units on top
    hl_set(tool, orig, wm, hm, dx, dy, ctrl)
    fin = hl_window(tool, t)
    out.update({"width": round(wm, 4), "height": round(hm, 4), "offset": [round(dx, 4), round(dy, 4)]})
    if fin:
        out["box"] = [round(v) for v in fin]
    return out


def op_highlight_box(a):
    """Size / move the highlight box of every highlight layer in a clip: width, height (multipliers on the preset's
    box), x, y (added to the box's Offset, as the Inspector shows it; + = right / up), auto (even padding around the
    word; only boxes whose text is not Follower-driven are measured)."""
    comp = get_comp(a["item"], a.get("comp"))
    clamp = lambda v, lo, hi, d: max(lo, min(hi, num(v, d)))
    W = clamp(a.get("width"), 0.2, 4.0, 1.0)
    H = clamp(a.get("height"), 0.2, 4.0, 1.0)
    X = clamp(a.get("x"), -2.0, 2.0, 0.0)
    Y = clamp(a.get("y"), -2.0, 2.0, 0.0)
    auto = bool(a.get("auto"))
    tools = hl_tools(comp)
    res = []
    comp.Lock()
    try:
        for tool in tools:
            try:
                res.append(hl_adjust(comp, tool, W, H, X, Y, auto))
            except Exception as e:
                res.append({"tool": attrs(tool).get("TOOLS_Name"), "error": str(e)})
    finally:
        comp.Unlock()
    try:
        rekey_comp(comp, a.get("item"))         # the box sweep's keys carry Box Width
    except Exception:
        pass
    glass_after(a)
    return {"highlights": res}


ROW_JUSTIFY = {"manual": 0, "center": 1, "centre": 1, "left": 2, "right": 3}
ROW_CTRL = {"gap": "RowGap", "link": "RowsLink", "equalize": "RowsEqualize", "justify": "RowsJustify"}
ROW_XY = {"all": "Rows", "upper": "Upper", "emphasis": "Emphasis", "lower": "Lower"}


def controls_tool(comp, ids):
    """The tool holding a preset's own Inspector add-ons (its "Template"): the one that has the first of `ids`."""
    t = comp.FindTool("Template")
    if t is not None and any(get_in(t, i) is not None for i in ids[:3]):
        return t
    for t in tool_list(comp):
        if any(get_in(t, i) is not None for i in ids[:3]):
            return t
    return None


def op_controls_get(a):
    """The panel's Clip controls (src/main/clip-controls.js): current values of the preset's add-on inputs
    {item, ids} -> {values: {id: number | null}}. They are hidden in Resolve's Inspector and edited from the panel."""
    ids = [str(i) for i in (a.get("ids") or [])]
    comp = get_comp(a["item"], a.get("comp"))
    tool = controls_tool(comp, ids)
    if tool is None:
        return {"values": {}}
    out = {}
    for i in ids:
        v = get_in(tool, i)
        out[i] = v if isinstance(v, (int, float)) and not isinstance(v, bool) else None
    fh = None
    try:
        fh = float(comp.GetPrefs("Comp.FrameFormat.Height"))
    except Exception:
        pass
    # the frame height turns Row Y offsets into the pixel gaps (Upper Y <-> Gap Above Emphasis in the panel)
    return {"values": out, "frameHeight": fh}


def op_controls_set(a):
    """Sets add-on inputs from the panel's Clip controls: {item, values: {id: number}}. Each value is clamped to the
    range the panel sent (min / max). -> {values} as read back."""
    vals = a.get("values") or {}
    ids = [str(i) for i in vals.keys()]
    comp = get_comp(a["item"], a.get("comp"))
    tool = controls_tool(comp, ids)
    if tool is None:
        raise RuntimeError("This clip has none of those controls")
    comp.Lock()
    try:
        for i, v in vals.items():
            try:
                tool.SetInput(str(i), float(v))
            except Exception:
                continue
    finally:
        comp.Unlock()
    if any(i.startswith("Highlight") or i.startswith("Seg") for i in ids) or kinetic_template(comp)[0] is not None:
        try:
            rekey_comp(comp, a.get("item"))     # the box sweep's keys carry Box Width; Kinetic / Justified Pop rows
                                                # are baked from the Template's sliders (bake_rows)
        except Exception:
            pass
    glass_after(a)
    return {"values": {i: get_in(tool, i) for i in ids}}


def op_gradient_set(a):
    """Clip controls' gradient pickers: {item, tool, index, stops: [[pos, r, g, b, a], ...]} -> writes the whole
    ShadingGradient<index> table (and keeps the element a gradient). Write-only: the Text+ is follower-fed in
    Money Pop Up / $123,456, and a script read of such a tool can freeze Resolve."""
    comp = get_comp(a["item"], a.get("comp"))
    tool = comp.FindTool(str(a.get("tool") or ""))
    if tool is None:
        raise RuntimeError("This clip has no tool named %s" % a.get("tool"))
    idx = int(a.get("index") or 1)
    if is_driven(tool, "ShadingGradient%d" % idx) is not None:
        raise RuntimeError("That gradient is animated; edit it in Fusion")
    table = {}
    for s in a.get("stops") or []:
        try:
            table[float(s[0])] = [float(s[1]), float(s[2]), float(s[3]), float(s[4]) if len(s) > 4 else 1.0]
        except Exception:
            continue
    if len(table) < 2:
        raise RuntimeError("A gradient needs two colours")
    with LOCKED(comp):
        if is_driven(tool, "Type%d" % idx) is None:
            tool.SetInput("Type%d" % idx, 2)
        tool.SetInput("ShadingGradient%d" % idx, table)
    count("setInputs", 2)
    return {"ok": True, "stops": len(table)}


def op_multitext_rows(a):
    """Set the Row controls of a MultiText clip (tools/add-multitext-row-controls.py): gap (text lines between the
    rows), equalize (bool: equal ink-to-ink gaps above and below the emphasis), justify (manual / center / left / right), link (bool), all / upper / emphasis / lower {x, y} (Inspector
    Center units). Only the given values change. Returns the controls' values, or hasControls false for a preset
    without them."""
    comp = get_comp(a["item"], a.get("comp"))
    tpl = None
    with STEP("find"):
        for t in tool_list(comp):
            if attrs(t).get("TOOLS_RegID") == "MultiText" and get_in(t, "RowGap") is not None:
                tpl = t
                break
    if tpl is None:
        return {"hasControls": False}
    with STEP("set"):
        rows_set(a, tpl, comp)
    glass_after(a)
    with STEP("read"):
        return rows_read(tpl)


def rows_set(a, tpl, comp):
    comp.Lock()
    try:
        if a.get("gap") is not None:
            tpl.SetInput("RowGap", max(-3.0, min(6.0, float(a["gap"]))))
        if a.get("link") is not None:
            tpl.SetInput("RowsLink", 1 if a["link"] else 0)
        if a.get("equalize") is not None and get_in(tpl, "RowsEqualize") is not None:
            tpl.SetInput("RowsEqualize", 1 if a["equalize"] else 0)
        dist = a.get("distance") if isinstance(a.get("distance"), dict) else {}
        if get_in(tpl, "RowsDistOn") is not None:
            given = {k: dist[k] for k in ("upperEmphasis", "emphasisLower") if dist.get(k) is not None}
            # Lines mode: the pixel gaps (Gap Above / Below Emphasis) are kept equal to the gaps on screen, so
            # switching Gap Mode to Pixels (here or in the Inspector) starts from the current layout, no jump.
            if num(get_in(tpl, "RowsDistOn"), 0) < 0.5 and not given:
                for src, idn in (("RowsGapUE", "RowsSetUE"), ("RowsGapEL", "RowsSetEL")):
                    v = get_in(tpl, src)
                    if v is not None:
                        tpl.SetInput(idn, round(max(-300.0, min(1000.0, float(v))), 1))
            for k, idn in (("upperEmphasis", "RowsSetUE"), ("emphasisLower", "RowsSetEL")):
                if k in given:
                    tpl.SetInput(idn, max(-300.0, min(1000.0, float(given[k]))))
            if dist.get("on") is not None:
                tpl.SetInput("RowsDistOn", 1 if dist["on"] else 0)
        j = a.get("justify")
        if j is not None:
            jv = ROW_JUSTIFY.get(str(j).strip().lower()) if not isinstance(j, (int, float)) else int(j)
            if jv is not None:
                tpl.SetInput("RowsJustify", max(0, min(3, int(jv))))
        for key, pre in ROW_XY.items():
            v = a.get(key)
            if isinstance(v, dict):
                for ax in ("x", "y"):
                    if v.get(ax) is not None:
                        tpl.SetInput(pre + ax.upper(), max(-2.0, min(2.0, float(v[ax]))))
    finally:
        comp.Unlock()


def rows_read(tpl):
    jv = int(num(get_in(tpl, "RowsJustify"), 0))
    names = {v: k for k, v in ROW_JUSTIFY.items() if k != "centre"}
    out = {"hasControls": True, "tool": attrs(tpl).get("TOOLS_Name"), "gap": get_in(tpl, "RowGap"),
           "link": bool(num(get_in(tpl, "RowsLink"), 0) >= 0.5), "justify": names.get(jv, "manual")}
    if get_in(tpl, "RowsEqualize") is not None:      # presets patched before the Equalize toggle lack these
        out["equalize"] = bool(num(get_in(tpl, "RowsEqualize"), 1) >= 0.5)
        out["distancePx"] = {"upperEmphasis": get_in(tpl, "RowsGapUE"), "emphasisLower": get_in(tpl, "RowsGapEL")}
    if get_in(tpl, "RowsDistOn") is not None:        # Set Distance: the two sliders above set the gaps (else ignored)
        out["distanceOn"] = bool(num(get_in(tpl, "RowsDistOn"), 0) >= 0.5)
        out["distanceSet"] = {"upperEmphasis": get_in(tpl, "RowsSetUE"), "emphasisLower": get_in(tpl, "RowsSetEL")}
    for key, pre in ROW_XY.items():
        out[key] = {"x": get_in(tpl, pre + "X"), "y": get_in(tpl, pre + "Y")}
    out["rows"] = [{"layer": n, "name": get_in(tpl, "TextName%d" % n), "center": as_pt(get_in(tpl, "Text%d.Center" % n))}
                   for n in range(1, 17) if get_in(tpl, "Text%d.Size" % n) is not None]
    return out


def op_set_boxes(a):
    """Put text / position / size into each detected Text+ or template, one by one."""
    comp = get_comp(a["item"], a.get("comp"))
    all_tools = tool_list(comp)
    missing, fixed, design_done, first_text = [], [], False, True
    import time
    t_text = time.perf_counter()
    for b in a.get("boxes") or []:
        name = b.get("tool")
        tool = comp.FindTool(name) if name else None
        if tool is None:
            missing.append(b.get("label") or name or "?")
            continue
        if b.get("text") is not None:
            try:
                if b.get("kind") == "multitext":
                    # a MultiText layer: Text<n>.StyledText, or the follower that animates it
                    drv = is_driven(tool, b.get("input"))
                    if drv is not None and attrs(drv).get("TOOLS_RegID") in FOLLOWERS:
                        drv.SetInput("Text", str(b["text"]))
                    else:
                        tool.SetInput(b.get("input"), str(b["text"]))
                    if b.get("font"):                                 # automation's forced font: Text<n>.Font / .Style
                        prefix = str(b.get("input") or "").rsplit(".", 1)[0]
                        try:
                            tool.SetInput(prefix + ".Font", str(b["font"]))
                            if b.get("style"):
                                tool.SetInput(prefix + ".Style", str(b["style"]))
                        except Exception:
                            missing.append((b.get("label") or name) + " (font)")
                    text_color = b.get("color")
                    if b.get("bgColor"):                              # the emphasis colour: the highlight box behind the word
                        prefix = str(b.get("input") or "").rsplit(".", 1)[0]
                        try:
                            if not set_highlight_bg(comp, tool, prefix, b["bgColor"]):
                                text_color = b["bgColor"]             # no box in this preset: colour the word itself
                            elif float(get_in(tool, "PillTextColor") or 0) >= 0.5:
                                text_color = b["bgColor"]             # soft / outline pills: the word in the pill's colour too
                        except Exception:
                            missing.append((b.get("label") or name) + " (background colour)")
                    if text_color:                                    # automation's forced colour: Text<n>.Red1 / Green1 / Blue1
                        prefix = str(b.get("input") or "").rsplit(".", 1)[0]
                        try:
                            r, g, bl = hex_to_rgb(text_color)
                            if int(get_in(tool, prefix + ".Type1") or 0) == 2:
                                tool.SetInput(prefix + ".Type1", 0)   # a gradient fill would keep its second stop
                            for ch, v in (("Red1", r), ("Green1", g), ("Blue1", bl)):
                                if is_driven(tool, prefix + "." + ch) is None:
                                    tool.SetInput(prefix + "." + ch, v)
                        except Exception:
                            missing.append((b.get("label") or name) + " (colour)")
                else:
                    set_node_text(tool, b.get("input") or "StyledText", str(b["text"]), all_tools, first_text)
                    first_text = False
            except Exception:
                missing.append((b.get("label") or name) + " (text)")
        cin = b.get("centerInput")
        if cin and b.get("cx") is not None and b.get("cy") is not None:
            if is_driven(tool, cin) is not None:
                fixed.append(b.get("label") or name)   # animated by a path: do not fight it
            else:
                try:
                    tool.SetInput(cin, {1: float(b["cx"]), 2: float(b["cy"]), 3: 0.0})
                except Exception:
                    fixed.append(b.get("label") or name)
        elif b.get("cx") is not None and not cin:
            fixed.append(b.get("label") or name)
        if b.get("kind") == "textplus":
            if b.get("size") is not None and is_driven(tool, "Size") is None:
                try:
                    tool.SetInput("Size", float(b["size"]))
                except Exception:
                    pass
            if isinstance(b.get("design"), dict):
                # This Text+ has its own Text Design (its number in the Text Design panel).
                apply_text_design(tool, b["design"])
                design_done = True
            elif not design_done and a.get("textDesign"):
                apply_text_design(tool, a["textDesign"])
                design_done = True
    STEPS["text"] = STEPS.get("text", 0.0) + (time.perf_counter() - t_text) * 1000.0
    unscaled, capped = [], False
    mt = a.get("multitext")
    if isinstance(mt, dict):
        t_size = time.perf_counter()
        done = set()
        for b in a.get("boxes") or []:
            name = b.get("tool")
            if b.get("kind") != "multitext" or not name or name in done:
                continue
            done.add(name)
            tool = comp.FindTool(name)
            if tool is not None:
                r = size_multitext(tool, float(mt.get("textSize") or 1.0), mt.get("maxSize"), mt.get("lineSpacing"))
                unscaled += r["skipped"]
                capped = capped or r["capped"]
        STEPS["size"] = STEPS.get("size", 0.0) + (time.perf_counter() - t_size) * 1000.0
    if a.get("light"):      # a text edit on a clip already placed: no timing / retime / wake / scan pass (see liveUpdate)
        lead = False        # ...but a row left alone (or no longer alone) moves its start, and its letters follow
        try:
            with LOCKED(comp):
                lead = lead_single_segment(comp)
                if lead:
                    fit_segments(comp, a.get("clipFrames"))
            rekey_comp(comp, a.get("item"))     # moved rows, and the box sweep's letter count
        except Exception:
            pass
        return {"missing": missing, "fixedPosition": fixed, "unscaled": unscaled, "capped": capped, "nodes": [],
                "segLead": lead}
    with LOCKED(comp):
        with STEP("typing"):
            set_typing_frames(comp, a.get("typingFrames"), a.get("clipFrames"))
        with STEP("retime"):
            init_retime(comp, a.get("clipFrames"))
        with STEP("segments"):
            lead_single_segment(comp)
            fit_segments(comp, a.get("clipFrames"))
        with STEP("keys"):
            key_followers(comp)
    if FIX.get("wakeOnInsert", True):
        with STEP("wake"):
            wake_effects(comp)
    with STEP("scan"):
        nodes = op_scan(dict(a, light=True))["nodes"]      # the panel only counts them (status line)
    return {"missing": missing, "fixedPosition": fixed, "unscaled": unscaled, "capped": capped, "nodes": nodes}


_audio_items = {}   # audio item id -> TimelineItem (link_clips)


def find_any_item(item_id, kind="video"):
    if kind == "video":
        try:
            return find_item(item_id)
        except Exception:
            return None
    it = _audio_items.get(str(item_id))
    if it is not None:
        try:
            if str(it.GetUniqueId()) == str(item_id):
                return it
        except Exception:
            pass
        _audio_items.pop(str(item_id), None)
    tl = timeline()
    for t in range(1, tl.GetTrackCount(kind) + 1):
        for it in tl.GetItemListInTrack(kind, t) or []:
            try:
                uid = str(it.GetUniqueId())
            except Exception:
                continue
            _audio_items[uid] = it
            if uid == str(item_id):
                return it
    return None


def op_refresh(a):
    """Re-writes each text input with its own value. Right after a comp is imported, Resolve sometimes renders a
    Follower-driven Text+ as empty (black) until the text is touched again; doing it once everything is placed
    makes the clip show exactly what the comp was built to show."""
    comp = get_comp(a["item"], a.get("comp"))
    touched = 0
    tools = tool_list(comp)
    has_follower = not FIX.get("retouchText", True)      # off: no text is re-written
    for mod in (tools if not has_follower else []):
        try:
            if attrs(mod).get("TOOLS_RegID") in FOLLOWERS:
                if mod.Text.GetExpression():
                    continue      # a mirror (e.g. the highlight's copy of the emphasis): writing it would cut the link
                txt = mod.GetInput("Text")
                if txt is not None:
                    mod.SetInput("Text", txt)
                    has_follower = True
                    touched += 1
        except Exception:
            pass
    if not has_follower:
        for tool in tools:
            try:
                if attrs(tool).get("TOOLS_RegID") == "TextPlus" and not is_mirror(tool):
                    inp = tool.StyledText
                    if inp is not None and not inp.GetConnectedOutput():
                        txt = tool.GetInput("StyledText")
                        if txt is not None:
                            tool.SetInput("StyledText", txt)
                            touched += 1
            except Exception:
                pass
    # The wake in set_text/set_boxes runs while the freshly inserted title is still settling, and Resolve can
    # then render it as if its effects were not there (a reveal preset stays hidden, a fly-in or wiggle sits still).
    # Waking every effect again here, once everything is placed, makes the animation render - for every title,
    # with or without a Follower.
    woken = wake_effects(comp)
    return {"touched": touched, "woken": woken}


def op_link_clips(a):
    """Links or unlinks a video TimelineItem and an audio TimelineItem on the current timeline."""
    tl = timeline()
    v_item = find_any_item(a.get("videoId"), "video")
    a_item = find_any_item(a.get("audioId"), "audio")
    if a_item and a.get("volume") is not None:
        try:
            a_item.SetProperties({"AudioVolumeEnabled": True, "AudioVolume": float(a["volume"])})
        except Exception:
            pass
    if not v_item or not a_item:
        return False
    return bool(tl.SetClipsLinked([v_item, a_item], bool(a.get("linked", True))))


def op_set_audio_volume(a):
    item = find_any_item(a.get("item"), "audio")
    if not item:
        return {"ok": False, "error": "Item not found"}
    vol = float(a.get("volume", 0.0))
    res = item.SetProperties({"AudioVolumeEnabled": True, "AudioVolume": vol})
    return {"ok": bool(res)}


def capture_adaptive(item, n, max_dim, out_dir):
    """Exports frames 0..n-1 to out_dir, but skips the expensive render while the picture is not changing: once
    4 frames in a row come out identical, it renders only every 5th frame and copies the held frame in between.
    If a probe differs (the animation moves again), the skipped frames are rendered for real, so nothing is lost."""
    def path_of(i):
        return os.path.join(out_dir, "p%02d.png" % i)

    def render(i):
        fp = path_of(i)
        r = item.ExportFrame(i, {"outputType": "file", "filePath": fp, "maxDimension": max_dim})
        if not r or not r.get("success"):
            raise RuntimeError((r or {}).get("error") or "Resolve could not export a frame")
        with open(fp, "rb") as fh:
            return fh.read()

    def copy_to(i, data):
        with open(path_of(i), "wb") as fh:
            fh.write(data)

    PROBE = 5
    prev, same, i = None, 0, 0
    while i < n:
        data = render(i)
        same = same + 1 if (prev is not None and data == prev) else 0
        prev = data
        i += 1
        while same >= 3 and i < n:
            j = min(i + PROBE - 1, n - 1)
            probe = render(j)
            if probe == prev:
                for k in range(i, j):
                    copy_to(k, prev)
                i = j + 1
                continue
            # it moved again somewhere in between: render those frames properly
            for k in range(i, j):
                d = render(k)
                same = same + 1 if d == prev else 0
                prev = d
            same = same + 1 if probe == prev else 0
            prev = probe
            i = j + 1
            break
    return list(range(n))


class Cancelled(Exception):
    pass


def capture_unique(item, n, max_dim, out_dir, hold, cancel_path, pre="p"):
    """Exports frames 0..n-1 as p%02d.png but renders each distinct picture only once. A preset that holds every
    picture for `hold` frames (Stop Motion) is checked once and then rendered every `hold` frames; otherwise
    runs of identical frames are skipped by probing ahead. Returns frame -> rendered frame index."""
    def path_of(i):
        return os.path.join(out_dir, "%s%02d.png" % (pre, i))

    def render(i):
        if cancel_path and os.path.exists(cancel_path):
            raise Cancelled("cancelled")
        fp = path_of(i)
        r = item.ExportFrame(i, {"outputType": "file", "filePath": fp, "maxDimension": max_dim})
        if not r or not r.get("success"):
            raise RuntimeError((r or {}).get("error") or "Resolve could not export a frame")
        with open(fp, "rb") as fh:
            return fh.read()

    def drop(i):
        try:
            os.remove(path_of(i))
        except Exception:
            pass

    cache = {}                     # every frame rendered so far -> its PNG bytes

    def get(i):
        if i not in cache:
            cache[i] = render(i)
        return cache[i]

    src = [0] * n
    if n <= 0:
        return src
    get(0)
    if hold > 1 and n > hold and get(hold - 1) == cache[0]:
        # Stop Motion: one picture per `hold` frames. Checked again on the first moving groups; if a group is
        # not one held picture after all, the general walk below takes over (nothing rendered is wasted).
        last, checked, ok = 0, 0, True
        for g in range(hold, n, hold):
            d = get(g)
            if d != cache[last]:
                if checked < 2:
                    end = min(g + hold - 1, n - 1)
                    checked += 1
                    if get(end) != d:
                        ok = False
                        break
                last = g
            for k in range(g, min(g + hold, n)):
                src[k] = last
        if ok:
            for i in range(n):
                if src[i] != i:
                    drop(i)
            return src
        src = [0] * n
    PROBE = 5
    last, same, i = 0, 0, 1
    while i < n:
        d = get(i)
        if d == cache[last]:
            src[i] = last
            same += 1
        else:
            src[i] = last = i
            same = 0
        i += 1
        while same >= 2 and i < n:
            j = min(i + PROBE - 1, n - 1)
            if get(j) == cache[last]:
                for k in range(i, j + 1):
                    src[k] = last
                i = j + 1
                continue
            same = 0               # it moves again in between: walk those frames one by one
    for i in range(n):
        if src[i] == i:
            if not os.path.exists(path_of(i)):
                with open(path_of(i), "wb") as fh:
                    fh.write(cache[i])
        else:
            drop(i)
    return src


def link_held(out_dir, src, pre="p"):
    """Every frame gets its file, as a hard link to the frame it holds (no copying, no re-render)."""
    for i, k in enumerate(src):
        if k == i:
            continue
        dst = os.path.join(out_dir, "%s%02d.png" % (pre, i))
        srcf = os.path.join(out_dir, "%s%02d.png" % (pre, k))
        try:
            if os.path.exists(dst):
                os.remove(dst)
            os.link(srcf, dst)
        except Exception:
            try:
                with open(srcf, "rb") as fi, open(dst, "wb") as fo:
                    fo.write(fi.read())
            except Exception:
                pass


def op_capture(a):
    """Real 25fps or 30fps frames of a timeline clip over 3 seconds, for the panel's animation preview."""
    item = find_item(a["item"])
    tl = timeline()
    fps = float(tl.GetSetting("timelineFrameRate") or 25)
    duration = int(item.GetDuration() or 0) or 50
    span = min(duration, int(round(fps * 3)))
    count = int(a.get("count") or span)
    step = int(a.get("step") or 1)
    max_dim = int(a.get("maxDim") or 320)
    out_dir = a.get("outDir")
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
        try:
            for old_f in os.listdir(out_dir):
                if (old_f.startswith("p") or old_f.startswith("w")) and old_f.endswith(".png"):
                    try:
                        os.remove(os.path.join(out_dir, old_f))
                    except Exception:
                        pass
        except Exception:
            pass
    orig_props = {}
    try:
        orig_props = item.GetProperties() or {}
        item.SetProperties({"Pan": 0.0, "Tilt": 0.0, "ZoomX": 1.0, "ZoomY": 1.0, "RotationAngle": 0.0})
    except Exception:
        orig_props = {}
    frames, off = [], 0
    src_map, matte = None, False
    cancel_path = a.get("cancelPath")
    try:
        if out_dir and step == 1 and a.get("unique"):
            if a.get("matteBg"):
                # A draft render before this one leaves the preview background white: black first, always.
                try:
                    set_bg_colour(a["item"], a.get("comp"), a["matteBg"], [0.0, 0.0, 0.0])
                except Exception:
                    pass
            n = min(count, duration)
            src_map = capture_unique(item, n, max_dim, out_dir, int(a.get("hold") or 1), cancel_path)
            link_held(out_dir, src_map)
            if a.get("matteBg"):
                # Same frames again on white: black + white give the text's real colour and transparency.
                set_bg_colour(a["item"], a.get("comp"), a["matteBg"], [1.0, 1.0, 1.0])
                # Dark text on the black pass (or light text on white) is invisible, so frames that look identical there
                # may differ on the other: the white pass is de-duplicated on its own and the two are merged.
                src_w = capture_unique(item, n, max_dim, out_dir, int(a.get("hold") or 1), cancel_path, "w")
                link_held(out_dir, src_w, "w")
                seen, merged = {}, []
                for i in range(n):
                    merged.append(seen.setdefault((src_map[i], src_w[i]), i))
                src_map = merged
                matte = True
            frames = list(range(n))
            off = duration
        elif out_dir and step == 1:
            n = min(count, duration)
            frames = capture_adaptive(item, n, max_dim, out_dir)
            off = duration
        while off < duration and len(frames) < count:
            if out_dir:
                fp = os.path.join(out_dir, "p%02d.png" % len(frames))
                r = item.ExportFrame(off, {"outputType": "file", "filePath": fp, "maxDimension": max_dim})
                if not r or not r.get("success"):
                    raise RuntimeError((r or {}).get("error") or "Resolve could not export a frame")
                frames.append(len(frames))
            else:
                r = item.ExportFrame(off, {"outputType": "encodedString", "encodedImageFormat": "png",
                                            "maxDimension": max_dim})
                if not r or not r.get("success"):
                    raise RuntimeError((r or {}).get("error") or "Resolve could not export a frame")
                frames.append(r["data"])
            off += step
    finally:
        if orig_props:
            try:
                item.SetProperties({
                    "Pan": float(orig_props.get("Pan", 0.0)),
                    "Tilt": float(orig_props.get("Tilt", 0.0)),
                    "ZoomX": float(orig_props.get("ZoomX", 1.0)),
                    "ZoomY": float(orig_props.get("ZoomY", 1.0)),
                    "RotationAngle": float(orig_props.get("RotationAngle", 0.0)),
                })
            except Exception:
                pass
    return {"step": step, "fps": fps, "count": len(frames), "frames": [] if out_dir else frames,
            "map": src_map, "matte": matte, "unique": len(set(src_map)) if src_map else None}


def op_live_frame(a):
    """Current composited timeline frame under the playhead for the live preview background."""
    project = resolve().GetProjectManager().GetCurrentProject()
    tl = project.GetCurrentTimeline() if project else None
    if not tl:
        raise RuntimeError("Open a timeline in Resolve")
    start = int(tl.GetStartFrame() or 0)
    frame = int(a.get("frame", start))
    offset = max(0, frame - start)
    max_dim = int(a.get("maxDim") or 1280)
    if max_dim <= 0 or max_dim > 1920:
        max_dim = 1280
    r = tl.ExportFrame(offset, {"outputType": "encodedString", "encodedImageFormat": "jpg",
                                "maxDimension": max_dim})
    if not r or not r.get("success"):
        raise RuntimeError((r or {}).get("error") or "Could not export timeline frame")
    w = tl.GetSetting("timelineResolutionWidth")
    h = tl.GetSetting("timelineResolutionHeight")
    if not w or not h:
        if project:
            w = project.GetSetting("timelineResolutionWidth") or w
            h = project.GetSetting("timelineResolutionHeight") or h
    return {
        "frame": frame,
        "width": int(w or 1920),
        "height": int(h or 1080),
        "data": r["data"],
    }


def output_tool(comp):
    """The tool whose image the clip shows: the MediaOut's source, else the tool named Template."""
    for t in tool_list(comp):
        try:
            if attrs(t).get("TOOLS_RegID") == "MediaOut":
                src = t.Input.GetConnectedOutput()
                if src is not None:
                    return src.GetTool()
        except Exception:
            pass
    try:
        return comp.FindTool("Template")
    except Exception:
        return None


def op_probe_render(a):
    """Blank-render check (MCP verify_placed): renders the clip's output at one clip-relative frame and says whether
    anything was drawn. {nonEmpty, bbox: [x0, y0, x1, y1] | None, frame}. The frame is clip-relative."""
    comp = get_comp(a["item"], a.get("comp"))
    # Rendering a Text+ whose text comes through a Follower from a script crashed Resolve (2026-11-09, see
    # hl_adjust): such comps are never rendered here; the check reports them as skipped.
    for t in tool_list(comp):
        try:
            if attrs(t).get("TOOLS_RegID") == "TextPlus":
                drv = is_driven(t, "StyledText")
                if drv is not None and attrs(drv).get("TOOLS_RegID") in FOLLOWERS:
                    return {"skipped": "follower-fed text: not rendered (it crashed Resolve before)", "frame": int(a.get("frame") or 0)}
        except Exception:
            pass
    tool = output_tool(comp)
    if tool is None:
        raise RuntimeError("the comp has no output tool")
    rs = num(attrs(comp).get("COMPN_RenderStart"), 0)
    t = int(rs + max(0, int(a.get("frame") or 0)))
    count("renders")
    img = tool.Output.GetValue(t)
    d = img.DataWindow if img is not None else None
    if not d:
        return {"nonEmpty": False, "bbox": None, "frame": t}
    x0, y0, x1, y1 = float(d[1]), float(d[2]), float(d[3]), float(d[4])
    return {"nonEmpty": (x1 - x0) >= 1 and (y1 - y0) >= 1, "bbox": [x0, y0, x1, y1], "frame": t}


def op_set_output(a):
    """Title templates only: Resolve wires the inserted title's MediaOut to the tool named "Template", whatever the
    template file says. For a preset whose text runs through effects (wiggle, glitch, stop motion) that skips the whole
    chain, so the MediaOut is connected back to the tool the preset really outputs (a connection, not a comp swap, so
    the Inspector keeps working)."""
    comp = get_comp(a["item"], a.get("comp"))
    src = comp.FindTool(a["source"])
    if src is None:
        return {"ok": False, "why": "no tool " + a["source"]}
    out = getattr(src, a.get("output") or "Output", None) or src.Output
    done = []
    for t in as_list(comp.GetToolList(False)):
        if attrs(t).get("TOOLS_RegID") != "MediaOut":
            continue
        cur = t.Input.GetConnectedOutput()
        if cur is not None and attrs(cur.GetTool()).get("TOOLS_Name") == a["source"]:
            done.append(attrs(t).get("TOOLS_Name"))
            continue
        t.Input.ConnectTo(out)
        now = t.Input.GetConnectedOutput()
        if now is None or attrs(now.GetTool()).get("TOOLS_Name") != a["source"]:
            if cur is not None:
                t.Input.ConnectTo(cur)      # never leave the clip worse off than Resolve wired it
            return {"ok": False, "why": "could not connect " + str(attrs(t).get("TOOLS_Name"))}
        done.append(attrs(t).get("TOOLS_Name"))
    return {"ok": bool(done), "mediaOut": done}


def op_preview_bg(a):
    """Preview clips only: puts a solid colour behind the text (Background -> Merge -> MediaOut), so dark text is
    not lost against the black frame that Resolve exports. The clip is deleted right after the frames are taken."""
    comp = get_comp(a["item"], a.get("comp"))
    col = a.get("color") or [1.0, 1.0, 1.0]
    tools = as_list(comp.GetToolList(False))
    mo = None
    for t in tools:
        if attrs(t).get("TOOLS_RegID") == "MediaOut":
            mo = t
            break
    if mo is None:
        return {"ok": False, "why": "no MediaOut"}
    src = mo.Input.GetConnectedOutput()
    if src is None:
        return {"ok": False, "why": "MediaOut not connected"}
    comp.Lock()
    try:
        bg = comp.AddTool("Background", -32768, -32768)
        mg = comp.AddTool("Merge", -32768, -32768)
        req_cache_clear()      # the tool list changed
        comp_attrs_forget(a["item"])
        if bg is None or mg is None:
            return {"ok": False, "why": "could not add tools"}
        bg.SetInput("TopLeftRed", float(col[0]))
        bg.SetInput("TopLeftGreen", float(col[1]))
        bg.SetInput("TopLeftBlue", float(col[2]))
        bg.SetInput("TopLeftAlpha", 1.0)
        mg.Background.ConnectTo(bg.Output)
        mg.Foreground.ConnectTo(src)
        mo.Input.ConnectTo(mg.Output)
    finally:
        comp.Unlock()
    return {"ok": True, "bg": attrs(bg).get("TOOLS_Name")}


def set_bg_colour(item_id, comp_name, bg_name, col):
    comp = get_comp(item_id, comp_name)
    bg = comp.FindTool(bg_name) if bg_name else None
    if bg is None:
        raise RuntimeError("preview background is missing")
    bg.SetInput("TopLeftRed", float(col[0]))
    bg.SetInput("TopLeftGreen", float(col[1]))
    bg.SetInput("TopLeftBlue", float(col[2]))


# ---------------------------------------------------------------- Animation timing bar (src/main/anim-timing.js)
# Three kinds of timing a clip can have, each shown as one or more start/end ranges in the panel:
#   anim      the "Animation Frames" retiming (src/main/retime.js): AnimStart (if the preset has it) .. AnimFrames
#   typing    word-by-word typing presets: TypingStart (if the preset has it) .. TypingFrames
#   segments  presets with their own per-text ranges, e.g. MultiText "Highlight Select": Seg<n>Start .. Seg<n>End on
#             the text node; the Inspector name of Seg<n>Start ("Upper Start") gives the range its label ("Upper").
TIMING_INPUTS = (("Seg1Start", "segments"), ("AnimFrames", "anim"), ("TypingFrames", "typing"))
START_INPUT = {"anim": "AnimStart", "typing": "TypingStart"}   # the start head, when the preset has it


def timing_tool(comp):
    for inp, kind in TIMING_INPUTS:
        for tool in tool_list(comp):
            if get_in(tool, inp) is not None:
                return tool, inp, kind
    return None, None, None


def segment_list(tool):
    """[(n, label, default start, default end)] for every Seg<n>Start / Seg<n>End pair on the tool."""
    try:
        uc = tool.UserControls or {}
    except Exception:
        uc = {}
    out = []
    for n in range(1, 17):
        if get_in(tool, "Seg%dStart" % n) is None or get_in(tool, "Seg%dEnd" % n) is None:
            break
        cs, ce = (uc.get("Seg%dStart" % n) or {}), (uc.get("Seg%dEnd" % n) or {})
        label = str(cs.get("LINKS_Name") or ("Text %d" % n))
        if label.lower().endswith(" start"):
            label = label[:-6]
        out.append((n, label, num(cs.get("INP_Default"), 0), num(ce.get("INP_Default"), 0)))
    return out


def num(v, d):
    try:
        return float(v)
    except Exception:
        return d


def fit_segments(comp, clip_frames):
    """Placement: a clip shorter than a segment preset's own timing gets all its ranges scaled down to fit."""
    if not clip_frames or not FIX.get("fitSegments", True):
        return
    top = max(1, int(clip_frames) - 1)
    for tool in tool_list(comp):
        try:
            segs = segment_list(tool)
            if not segs:
                continue
            # rows without text do not count: an emphasis-only clip keeps its timing when that row alone fits
            mt = multitext_tool(comp)
            used = [n for n, _, _, _ in segs if not segment_text_empty(mt, n)] or [n for n, _, _, _ in segs]
            last = max(num(get_in(tool, "Seg%dEnd" % n), 0) for n in used)
            if last <= top:
                continue
            k = top / last
            for n, _, _, _ in segs:
                for key in ("Seg%dStart" % n, "Seg%dEnd" % n):
                    tool.SetInput(key, int(round(num(get_in(tool, key), 0) * k)))
        except Exception:
            pass


def multitext_tool(comp):
    return next((t for t in tool_list(comp) if attrs(t).get("TOOLS_RegID") == "MultiText"), None)


SEG_LEAD_DATA = "ElsaSegLead"     # Template CustomData: '{"n": row, "by": frames}' while a lone row is pulled to frame 0


def lead_single_segment(comp):
    """A MultiText row preset with text in ONE row only (e.g. just the Emphasis): that row's in-animation starts at
    the clip's first frame instead of waiting for the empty rows before it (Seg<n>Start -> 0, same length). The
    shift is remembered on the Template and taken back when another row gets text again. True when a Seg value
    changed (the caller re-keys the letters). Call it before fit_segments."""
    if not FIX.get("leadSingleRow", True):
        return False
    tpl = next((t for t in tool_list(comp) if get_in(t, "Seg1Start") is not None), None)
    mt = multitext_tool(comp)
    if tpl is None or mt is None:
        return False
    rows = [n for n, _, _, _ in segment_list(tpl)]
    if len(rows) < 2:
        return False
    try:
        rec = json.loads(tpl.GetData(SEG_LEAD_DATA) or "null")
    except Exception:
        rec = None
    if not (isinstance(rec, dict) and rec.get("n") in rows):
        rec = None
    filled = [n for n in rows if not segment_text_empty(mt, n)]
    only = filled[0] if len(filled) == 1 else None
    changed = False

    def shift(n, by):
        s0 = num(get_in(tpl, "Seg%dStart" % n), 0)
        e0 = num(get_in(tpl, "Seg%dEnd" % n), s0 + 1)
        s1 = max(0, int(round(s0 + by)))
        tpl.SetInput("Seg%dStart" % n, s1)
        tpl.SetInput("Seg%dEnd" % n, max(s1 + 1, int(round(e0 + by))))

    if rec and rec["n"] != only:            # the lone row got company (or changed): back to where it was
        shift(rec["n"], num(rec.get("by"), 0))
        rec, changed = None, True
    if only is not None:
        s = num(get_in(tpl, "Seg%dStart" % only), 0)
        if s > 0:
            shift(only, -s)
            rec = {"n": only, "by": s + (num(rec.get("by"), 0) if rec else 0)}
            changed = True
    if changed:
        try:
            tpl.SetData(SEG_LEAD_DATA, json.dumps(rec) if rec else "")
        except Exception:
            pass
    return changed


# ---------------------------------------------------------------- per-letter animation as keyframes
# Segment presets (Highlight Select, the Pills, Underline Draw, Soft Marker, Glass Pill) animate each follower's letters
# with Lua expressions of time and the Template's Seg<n>Start / Seg<n>End. A Follower evaluates those inputs once per
# letter at that letter's delayed time, every frame, and Resolve does not cache them: ~200 Lua runs (60-80 ms) per frame
# for one clip, which made dragging any Inspector control lag. key_followers swaps those expressions for plain
# keyframes (native, ~free) written from the Seg values, and re-keys them whenever the plugin changes the timing.
# Seg sliders dragged in the Inspector itself are picked up by op_seg_watch (polled by src/main/seg-watch.js while a
# MultiText clip is selected), which re-keys when the values changed.
FOLLOWER_ANIM = {"Opacity1": "smooth", "WordSizeX": "size", "WordSizeY": "size", "WordOffset": "rise"}
FOLLOWER_ANIM_TAIL = {"smooth": "p * p * (3 - 2 * p)", "size": "0.82 + 0.18 * e", "rise": "-0.035 * (1 - e)"}
ANIM_DATA = "ElsaSegAnim"
# last lines of the light letter expressions, spaces removed (WordSize has none: the light form drops the size pop)
LIGHT_TAIL = {"smooth": ("returnp*p*(3-2*p)",), "rise": ("returnPoint(0,-0.035*q*q*q)",)}


def anim_value(kind, p):
    e = 1 - (1 - p) ** 3
    if kind == "smooth":
        return p * p * (3 - 2 * p)
    if kind == "size":
        return 0.82 + 0.18 * e
    return -0.035 * (1 - e)


def anim_spec(inp_id, expr):
    """{seg, k, kind} parsed from one of the generated per-letter expressions, or None (anything else stays)."""
    import re
    kind = FOLLOWER_ANIM.get(inp_id)
    if not kind or not expr or "time" not in expr:
        return None
    # the light form (tools/gen-light-letters.py): Seg<n>Start only, a fixed ramp, tails written without spaces
    light = re.match(r": local p = \(time - comp\.RenderStart - \(tonumber\(Template\.Seg(\d+)Start\) or 0\)\) / ([\d.]+)\n",
                     expr)
    tail = expr.strip().split("\n")[-1].replace(" ", "")
    if light and tail in (LIGHT_TAIL.get(kind) or ()):
        return {"seg": int(light.group(1)), "k": 1.0, "kind": kind, "ramp": float(light.group(2))}
    if FOLLOWER_ANIM_TAIL[kind] not in expr.strip().split("\n")[-1]:
        return None
    m = re.search(r"Template\.Seg(\d+)Start.*?Template\.Seg\1End.*?\(E - S\) \* ([\d.]+)\)", expr, re.S)
    if not m:
        return None
    return {"seg": int(m.group(1)), "k": float(m.group(2)), "kind": kind}


def anim_spline(fol, inp_id, kind):
    """The BezierSpline carrying the input's animation (WordOffset: the Y of an XYPath), created when missing."""
    drv = is_driven(fol, inp_id)
    if drv is None:
        if not fol.AddModifier(inp_id, "XYPath" if kind == "rise" else "BezierSpline"):
            return None
        drv = is_driven(fol, inp_id)
        if drv is None:
            return None
    if kind != "rise":
        return drv if attrs(drv).get("TOOLS_RegID") == "BezierSpline" else None
    if attrs(drv).get("TOOLS_RegID") != "XYPath":
        return None
    ys = is_driven(drv, "Y")
    if ys is None:
        drv.SetInput("X", 0.0)
        if not drv.AddModifier("Y", "BezierSpline"):
            return None
        ys = is_driven(drv, "Y")
    return ys


def key_followers(comp):
    """Converts the per-letter segment expressions of every follower to keyframes (first call) and re-keys them from
    the Template's current Seg values. Returns the number of inputs keyed. Kinetic Cloud / Lines rows: key_kinetic."""
    with LOCKED(comp):
        return key_followers_inner(comp)


def key_followers_inner(comp):
    tpl = None
    for tool in tool_list(comp):
        if get_in(tool, "Seg1Start") is not None:
            tpl = tool
            break
    if tpl is None:
        try:
            return key_kinetic(comp)
        except Exception:
            return 0
    try:
        rs = float(attrs(comp).get("COMPN_RenderStart") or 0)
    except Exception:
        rs = 0.0
    keyed = 0
    for fol in tool_list(comp):
        if attrs(fol).get("TOOLS_RegID") not in FOLLOWERS:
            continue
        try:
            specs = dict(fol.GetData(ANIM_DATA) or {})
        except Exception:
            specs = {}
        changed = False
        for inp_id in FOLLOWER_ANIM:
            try:
                expr = getattr(fol, inp_id).GetExpression()
            except Exception:
                expr = None
            spec = anim_spec(inp_id, expr) if expr else None
            if spec:
                specs[inp_id] = spec
                changed = True
            spec = specs.get(inp_id)
            if not spec:
                continue
            try:
                s = num(get_in(tpl, "Seg%dStart" % int(spec["seg"])), 0)
                e = num(get_in(tpl, "Seg%dEnd" % int(spec["seg"])), s)
                d = max(1.0, (e - s) * float(spec["k"]))
                r = float(spec["ramp"]) if spec.get("ramp") else max(2.0, min(9.0, d * 0.5))
                kind = spec["kind"]
                if expr:
                    getattr(fol, inp_id).SetExpression(None)
                sp = anim_spline(fol, inp_id, kind)
                if sp is None:
                    if expr:
                        getattr(fol, inp_id).SetExpression(expr)     # never leave the letters without their animation
                    continue
                ts = sorted(set([float(j) for j in range(int(r) + 1)] + [r]))
                lo, hi = rs + s, rs + s + r
                keys = {lo + t: {1: anim_value(kind, min(1.0, t / r)), "Flags": {"Linear": True}} for t in ts}
                # Keys outside the new range (AddModifier's own key at frame 0 = the input's static value, e.g.
                # Opacity 1, or keys from an earlier timing) would make the letters show before their lane starts
                # and fade out into it. SetKeyFrames(..., True) does not drop them, and DeleteKeyFrames always
                # leaves one key, so they are first overwritten with the held value, then deleted.
                try:
                    old = [float(k) for k in (sp.GetKeyFrames() or {}).keys()]
                except Exception:
                    old = []
                for k in old:
                    if k < lo - 1e-3:
                        keys[k] = {1: anim_value(kind, 0.0), "Flags": {"Linear": True}}
                    elif k > hi + 1e-3:
                        keys[k] = {1: anim_value(kind, 1.0), "Flags": {"Linear": True}}
                    elif k not in keys:
                        keys[k] = {1: anim_value(kind, min(1.0, max(0.0, (k - lo) / r))), "Flags": {"Linear": True}}
                sp.SetKeyFrames(keys, True)
                try:
                    sp.DeleteKeyFrames(-1e6, lo - 0.5)
                    sp.DeleteKeyFrames(hi + 0.5, 1e6)
                except Exception:
                    pass
                keyed += 1
            except Exception:
                continue
        if changed:
            try:
                fol.SetData(ANIM_DATA, specs)
            except Exception:
                pass
    try:
        keyed += key_seg_paths(comp, tpl, rs)
    except Exception:
        pass
    try:
        keyed += key_box_sweep(comp, tpl, rs)
    except Exception:
        pass
    if keyed:
        try:
            tpl.SetData(SEG_KEYED_DATA, json.dumps(seg_state(comp, tpl)))
        except Exception:
            pass
    return keyed


# Group Slide Emphasize: each row's follower takes its WordOffset from a PolyPath whose Displacement is a Lua expression
# of time and the Template's Seg<n>Start / End (one of them with a 24-step bezier solve). The follower asks the path
# once per LETTER at that letter's delayed time, every frame, so that expression ran once per letter per frame (the
# same lag as the letter expressions above). key_seg_paths writes the same curve as keyframes on the Displacement and
# re-keys it with the letters (seg_state: RenderStart + Seg values). The preset file keeps the expression as fallback.
SEG_PATH_RE = None


def seg_path_spec(expr):
    """Flat {seg, a, b, v0, v1[, x1, x2, y0, y1, y2, y3]} from a generated Seg curve expression, or None."""
    import re
    global SEG_PATH_RE
    n = r"(-?[\d.]+(?:e-?\d+)?)"
    if SEG_PATH_RE is None:
        SEG_PATH_RE = (
            re.compile(r": local S = tonumber\(Template\.Seg(\d+)Start\) or " + n + r"\nlocal E = tonumber\(Template\.Seg\1End\) or " + n
                       + r"\nlocal x = " + n + r" \+ \(time - comp\.RenderStart - S\) \* " + n + r" / math\.max\(0\.001, E - S\)"
                       + r"\nif x <= " + n + r" then return " + n + r" end\nif x >= " + n + r" then return " + n + r" end\n(.*)\nreturn y\s*$", re.S),
            re.compile(r"local y = " + n + r" \+ \(" + n + r" - " + n + r"\) \* \(x - " + n + r"\) / " + n + r"$"),
            re.compile(r"local function bz\(a, b, c, d, u\) local v = 1 - u return v\*v\*v\*a \+ 3\*v\*v\*u\*b \+ 3\*v\*u\*u\*c \+ u\*u\*u\*d end"
                       + r"\nlocal lo, hi = 0, 1\nfor i = 1, 24 do local m = \(lo \+ hi\) / 2 if bz\(" + n + ", " + n + ", " + n + ", " + n
                       + r", m\) < x then lo = m else hi = m end end\nlocal y = bz\(" + n + ", " + n + ", " + n + ", " + n + r", \(lo \+ hi\) / 2\)$"))
    head, lin, bez = SEG_PATH_RE
    m = head.match(expr or "")
    if not m:
        return None
    a, b = float(m.group(6)), float(m.group(8))
    if not b > a:
        return None
    spec = {"seg": int(m.group(1)), "a": a, "b": b, "v0": float(m.group(7)), "v1": float(m.group(9))}
    body = m.group(10).strip()
    ml = lin.match(body)
    if ml:
        spec.update({"y0": float(ml.group(1)), "y1": float(ml.group(2))})
        return spec
    mb = bez.match(body)
    if mb:
        g = [float(mb.group(i)) for i in range(1, 9)]
        spec.update({"x1": g[1], "x2": g[2], "y0": g[4], "c1": g[5], "c2": g[6], "y1": g[7], "bz": 1})
        return spec
    return None


def seg_path_value(spec, p):
    """The expression's value at p = 0..1 of the row's range."""
    a, b = float(spec["a"]), float(spec["b"])
    if p <= 0:
        return float(spec["v0"])
    if p >= 1:
        return float(spec["v1"])
    y0, y1 = float(spec["y0"]), float(spec["y1"])
    if not spec.get("bz"):
        return y0 + (y1 - y0) * p
    x = a + (b - a) * p

    def bz(q0, q1, q2, q3, u):
        v = 1 - u
        return v * v * v * q0 + 3 * v * v * u * q1 + 3 * v * u * u * q2 + u * u * u * q3
    lo, hi = 0.0, 1.0
    for _ in range(24):
        mid = (lo + hi) / 2
        if bz(a, float(spec["x1"]), float(spec["x2"]), b, mid) < x:
            lo = mid
        else:
            hi = mid
    return bz(y0, float(spec["c1"]), float(spec["c2"]), y1, (lo + hi) / 2)


def key_seg_paths(comp, tpl, rs):
    keyed = 0
    for tool in tool_list(comp):
        if attrs(tool).get("TOOLS_RegID") != "PolyPath":
            continue
        try:
            expr = tool.Displacement.GetExpression()
        except Exception:
            expr = None
        spec = seg_path_spec(expr) if expr and "time" in expr else None
        if spec:
            try:
                tool.SetData(ANIM_DATA, spec)
            except Exception:
                pass
        else:
            if expr:
                continue                     # some other expression: it stays
            try:
                spec = dict(tool.GetData(ANIM_DATA) or {})
            except Exception:
                spec = None
            if not spec or "seg" not in spec:
                continue
        try:
            s = num(get_in(tpl, "Seg%d" % int(spec["seg"]) + "Start"), 0)
            e = num(get_in(tpl, "Seg%d" % int(spec["seg"]) + "End"), s)
            d = max(0.001, e - s)
            if expr:
                tool.Displacement.SetExpression(None)
            sp = anim_spline(tool, "Displacement", "smooth")
            if sp is None:
                if expr:
                    tool.Displacement.SetExpression(expr)      # never leave the row without its slide
                continue
            lo, hi = rs + s, rs + s + d
            ts = sorted(set([float(j) for j in range(int(d) + 1)] + [d]))
            keys = {lo + t: {1: seg_path_value(spec, t / d), "Flags": {"Linear": True}} for t in ts}
            try:
                old = [float(k) for k in (sp.GetKeyFrames() or {}).keys()]
            except Exception:
                old = []
            for k in old:      # as in key_followers: stray keys are first given the held value, then deleted
                if k not in keys:
                    keys[k] = {1: seg_path_value(spec, (k - lo) / d), "Flags": {"Linear": True}}
            sp.SetKeyFrames(keys, True)
            try:
                sp.DeleteKeyFrames(-1e6, lo - 0.5)
                sp.DeleteKeyFrames(hi + 0.5, 1e6)
            except Exception:
                pass
            keyed += 1
        except Exception:
            continue
    return keyed


# Highlight Select / Soft Marker / Underline Draw: the box grows letter by letter through HighlightFollower.SizeX1, a
# Lua expression of time, Seg2 Start / End, the emphasis letter count and Template.HighlightWidth. Like the letter
# expressions it ran once per emphasis LETTER every frame (also during export). key_box_sweep writes the same linear
# ramp as two keys (width baked in) and seg_state carries the width and letter count, so any change to them re-keys
# (seg_watch / sweep, text and Clip-control edits, op_highlight_box). The preset file keeps the expression as fallback.
BOX_FOLLOWER = "HighlightFollower"
BOX_SWEEP_RE = None


def box_sweep_spec(expr):
    """{kind: sweep, seg, k, src, scale} from the generated box-sweep expression, or None (anything else stays)."""
    import re
    global BOX_SWEEP_RE
    if BOX_SWEEP_RE is None:
        n = r"([\d.]+)"
        BOX_SWEEP_RE = re.compile(
            r": local S(\d+) = tonumber\(Template\.Seg\1Start\) or 0\n"
            r"local E\1 = tonumber\(Template\.Seg\1End\) or S\1\n"
            r"local D\1 = math\.max\(1, \(E\1 - S\1\) \* " + n + r"\)\n"
            r"local r\1 = math\.max\(2, math\.min\(9, D\1 \* 0\.5\)\)\n"
            r"local Sh = S\1 \+ r\1\n"
            r"local Dh = math\.max\(1, E\1 - Sh\)\n"
            r"local function n\(s\) [^\n]*\n"
            r"local c = math\.max\(1, n\((\w+)\.Text\.Value\)\)\n"
            r"local rh = math\.max\(1, Dh \* 1\.5 / \(c \+ 1\.5\)\)\n"
            r"local p = math\.min\(1, math\.max\(0, \(time - comp\.RenderStart - Sh\) / rh\)\)\n"
            r"return \(" + n + r" \* p\) \* \(tonumber\(Template\.HighlightWidth\) or 1\)\s*$")
    m = BOX_SWEEP_RE.match(expr or "")
    if not m:
        return None
    return {"kind": "sweep", "seg": int(m.group(1)), "k": float(m.group(2)), "src": m.group(3), "scale": float(m.group(4))}


def box_chars(comp, src):
    """The expression's c: letters in the source follower's text (newlines not counted), at least 1."""
    try:
        t = get_in(comp.FindTool(src), "Text")
    except Exception:
        t = None
    t = t if isinstance(t, str) else ""
    return max(1, len(t.replace("\r", "").replace("\n", "")))


def box_state(comp, tpl):
    """What the box keys depend on besides RenderStart / Seg: [width, letters], or None when there is no box sweep."""
    hf = comp.FindTool(BOX_FOLLOWER)
    if hf is None or get_in(tpl, "HighlightWidth") is None:
        return None
    src = "EmphasisFollower"
    try:
        src = ((hf.GetData(ANIM_DATA) or {}).get("SizeX1") or {}).get("src") or src
    except Exception:
        pass
    return ["box", num(get_in(tpl, "HighlightWidth"), 1), box_chars(comp, src)]


def key_box_sweep(comp, tpl, rs):
    hf = comp.FindTool(BOX_FOLLOWER)
    if hf is None or attrs(hf).get("TOOLS_RegID") not in FOLLOWERS:
        return 0
    try:
        expr = hf.SizeX1.GetExpression()
    except Exception:
        expr = None
    try:
        specs = dict(hf.GetData(ANIM_DATA) or {})
    except Exception:
        specs = {}
    spec = box_sweep_spec(expr) if expr else None
    if spec is None:
        if expr:
            return 0                     # some other expression: it stays
        spec = specs.get("SizeX1")
        if not spec or spec.get("kind") != "sweep":
            return 0
    s = num(get_in(tpl, "Seg%dStart" % int(spec["seg"])), 0)
    e = num(get_in(tpl, "Seg%dEnd" % int(spec["seg"])), s)
    d = max(1.0, (e - s) * float(spec["k"]))
    sh = s + max(2.0, min(9.0, d * 0.5))
    dh = max(1.0, e - sh)
    c = box_chars(comp, spec.get("src") or "EmphasisFollower")
    rh = max(1.0, dh * 1.5 / (c + 1.5))
    full = float(spec["scale"]) * num(get_in(tpl, "HighlightWidth"), 1)
    lo, hi = rs + sh, rs + sh + rh

    def val(k):
        return full * min(1.0, max(0.0, (k - lo) / rh))
    if expr:
        hf.SizeX1.SetExpression(None)
    sp = anim_spline(hf, "SizeX1", "value")
    if sp is None:
        if expr:
            hf.SizeX1.SetExpression(expr)        # never leave the box without its sweep
        return 0
    keys = {lo: {1: 0.0, "Flags": {"Linear": True}}, hi: {1: full, "Flags": {"Linear": True}}}
    try:
        old = [float(k) for k in (sp.GetKeyFrames() or {}).keys()]
    except Exception:
        old = []
    for k in old:          # as in key_followers: stray keys are first given the held value, then deleted
        if k not in keys:
            keys[k] = {1: val(k), "Flags": {"Linear": True}}
    sp.SetKeyFrames(keys, True)
    try:
        sp.DeleteKeyFrames(-1e6, lo - 1e-3)
        sp.DeleteKeyFrames(hi + 1e-3, 1e6)
    except Exception:
        pass
    if specs.get("SizeX1") != spec:
        specs["SizeX1"] = spec
        try:
            hf.SetData(ANIM_DATA, specs)
        except Exception:
            pass
    return 1


def rekey_comp(comp, item=None):
    """Re-keys a segment / Kinetic clip when what its keys depend on changed since they were written (compared with the
    state saved on its Template, so an unchanged clip costs a few reads). For edits made outside the timing ops: text,
    Clip controls, box sliders."""
    tpl = comp.FindTool("Template")
    if tpl is None or get_in(tpl, "Seg1Start") is None:
        tpl = next((t for t in tool_list(comp) if get_in(t, "Seg1Start") is not None), None) or kinetic_template(comp)[0]
    if tpl is None:
        return 0
    return rekey_if_changed(comp, tpl, None, str(item) if item is not None else None)


def op_key_followers(a):
    """key_followers on one clip (also converts clips placed before the keyframe change)."""
    return {"keyed": key_followers(get_comp(a["item"], a.get("comp")))}


_seg_seen = {}    # item id -> (comp, Template, last keyed state: RenderStart + Seg values)
SEG_KEYED_DATA = "ElsaSegKeyed"   # Template CustomData: the state the followers were last keyed for


def op_seg_watch(a):
    """The selected MultiText clip's Seg Start / End, re-keyed when they changed since the last look (an Inspector drag).
    Reads 6 inputs per call; the comp and its Template are kept between calls. {segments: False} = not a segment clip."""
    item = str(a["item"])
    ent = _seg_seen.get(item)
    if ent is not None:
        try:
            comp, tpl, last = ent
            if get_in(tpl, "Seg1Start") is None and get_in(tpl, "StepFrames") is None:
                raise RuntimeError("stale")
        except Exception:
            _seg_seen.pop(item, None)
            ent = None
    if ent is None:
        comp = get_comp(item, a.get("comp"))
        tpl = next((t for t in tool_list(comp) if get_in(t, "Seg1Start") is not None), None)
        if tpl is None:
            tpl = kinetic_template(comp)[0]     # Kinetic Cloud / Lines: row keys (key_kinetic)
        if tpl is None:
            return {"segments": False}
        last = None
    first = last is None
    keyed = rekey_if_changed(comp, tpl, last, item)
    out = {"segments": True, "keyed": keyed}
    if _glass_kind.get(item) is not False and (a.get("sweep") or time.time() - _glass_seen.get(item, 0) >= 2.0):
        _glass_seen[item] = time.time()
        try:
            gr = glass_sync(item)
            if gr and gr.get("glass") == "synced":
                out["glass"] = gr
        except Exception:
            pass
    if first:       # first look at this clip: are any slide paths still expressions, and how many are keyed
        try:
            out["pathExprs"] = seg_path_exprs(comp)
            out["pathKeyed"] = sum(1 for t in tool_list(comp) if attrs(t).get("TOOLS_RegID") == "PolyPath" and (t.GetData(ANIM_DATA) or {}).get("seg"))
        except Exception:
            pass
    return out


def op_seg_sweep(a):
    """Background check of several MultiText clips (src/main/seg-watch.js sweep: new clips and clips whose start / end
    changed, e.g. head-trimmed while the panel was closed). Re-keys the ones whose RenderStart or Seg values differ from
    what their letters were keyed for. -> {items: {id: {segments, keyed} | {error}}}"""
    ids = [str(x) for x in (a.get("items") or [])]
    if any(i not in _items for i in ids):
        tl = timeline()      # one scan of the timeline instead of one per clip (find_item)
        want = set(ids)
        for t in range(1, tl.GetTrackCount("video") + 1):
            for it in tl.GetItemListInTrack("video", t) or []:
                try:
                    uid = str(it.GetUniqueId())
                except Exception:
                    continue
                if uid in want:
                    _items[uid] = it
    out = {}
    for item in ids:
        try:
            out[item] = op_seg_watch({"item": item, "sweep": True})
        except Exception as e:
            out[item] = {"error": str(e)}
    return {"items": out}


def seg_state(comp, tpl):
    """What the letter keys depend on: the comp's RenderStart (it moves when the clip's head is trimmed or a copy is
    pasted trimmed) and every Seg Start / End (frames from the clip's start). Trim moves the keys with the clip; the
    slider values themselves are never changed or clamped to the new length. Kinetic Cloud / Lines: kinetic_state."""
    if get_in(tpl, "Seg1Start") is None:
        k_tpl, kind = kinetic_template(comp)
        if k_tpl is not None:
            return kinetic_state(comp, tpl, kind)
    try:
        rs = float(attrs(comp).get("COMPN_RenderStart") or 0)
    except Exception:
        rs = 0.0
    cur = [rs]
    for n in range(1, 10):
        st = get_in(tpl, "Seg%dStart" % n)
        if st is None:
            break
        cur.append((num(st, 0), num(get_in(tpl, "Seg%dEnd" % n), 0)))
    box = box_state(comp, tpl)
    if box is not None:
        cur.append(box)
    return tuple(cur)


def rekey_if_changed(comp, tpl, last, item):
    """Re-keys the followers when the timing or the clip's start changed since they were keyed. `last` is what this
    bridge saw before (None on first look: then the state saved on the Template decides, so a clip already keyed for
    its current start is not rewritten)."""
    cur = seg_state(comp, tpl)
    first = last is None
    if last is None:
        try:
            last = tpl.GetData(SEG_KEYED_DATA)    # a JSON string (a list would come back as a Lua-style dict)
        except Exception:
            last = None
    keyed = 0
    if json.dumps(cur) != (last if isinstance(last, str) else json.dumps(last)) or (first and seg_path_exprs(comp)):
        keyed = key_followers(comp)     # saves the new state on the Template
    if item is not None:
        _seg_seen[item] = (comp, tpl, cur)
    return keyed


def seg_path_exprs(comp):
    """How many slide paths still run their Seg expression (a Group Slide Emphasize clip placed before key_seg_paths)."""
    n = 0
    for tool in tool_list(comp):
        try:
            if attrs(tool).get("TOOLS_RegID") == "PolyPath" and seg_path_spec(tool.Displacement.GetExpression() or ""):
                n += 1
        except Exception:
            pass
    return n

# ---------------------------------------------------------------- Kinetic Cloud / Lines: row pop-ins as keyframes
# Their Pop<k> followers animate each row's letters with Lua expressions (tools/gen-kinetic-cloud.py / -lines.py). A
# Follower evaluates its inputs once per LETTER, every frame, and Fusion caches no expression results: even a trivial
# expression costs ~0.15 ms there, so a 90-letter statement spent well over 100 ms a frame in them (choppy timeline
# playback). key_kinetic replaces them with linear keyframes sampled from the same curves, placed at the comp frames
# where each row pops in (Animation Start / Frames retiming, Frames Per Row, the clip's RenderStart), and re-keys when
# any of those change (kinetic_state; placement, timing bar, seg-watch / sweep, text edits). The preset files keep
# the expressions: they are the fallback when keying fails, like the segment presets' light letters.
KINETIC_DATA = "ElsaRowPop"       # follower CustomData: which curves its keys carry ("cloud" / "lines")
KINETIC_INPUTS = {
    "cloud": ("WordSizeX", "WordSizeY", "WordAngleZ", "WordOffset", "Opacity1"),
    "lines": ("Opacity1",),
}
# the last line of each generated expression: only followers whose expressions are exactly these get converted
KINETIC_TAILS = {
    "WordSizeX": "return 0.25 + 0.75 * e", "WordSizeY": "return 0.25 + 0.75 * e",
    "WordAngleZ": "* (1 - e)", "WordOffset": "return Point(0, -0.02 * (1 - e))",
}
KINETIC_OPACITY_TAIL = {"cloud": "return math.min(1, p * 3)", "lines": "return f * f * (3 - 2 * f)"}


def kinetic_template(comp):
    """(Template, "cloud" | "lines" | "justpop") for a Kinetic Cloud / Lines / Justified Pop comp, else (None, None)."""
    try:
        tpl = comp.FindTool("Template")
        if tpl is None or get_in(tpl, "StepFrames") is None:
            return None, None
        if comp.FindTool("Pop1") is None:
            if get_in(tpl, "RowRatio") is not None and comp.FindTool("E1") is not None:
                return tpl, "justpop"
            return None, None
        if get_in(tpl, "SlideFrames") is not None:
            return tpl, "lines"
        if get_in(tpl, "Zoom") is not None and get_in(tpl, "PullFrames") is not None:
            return tpl, "cloud"
    except Exception:
        pass
    return None, None


def kinetic_state(comp, tpl, kind):
    """Everything the row keys depend on: RenderStart, Animation Start / Frames, the natural length (row count, Frames
    Per Row, Pull Back / Slide Frames, Zoom), Frames Per Row and the pop length."""
    a = attrs(comp)
    try:
        rs = float(a.get("COMPN_RenderStart") or 0)
    except Exception:
        rs = 0.0
    bake = bake_inputs(tpl, kind)     # the rows' layout, colours and motion sliders (bake_rows); last in the state
    if kind == "justpop":
        try:
            re_ = float(a.get("COMPN_RenderEnd") or rs)
        except Exception:
            re_ = rs
        return (kind, rs, re_, bake)
    width = max(1.0, num(get_in(tpl, "SlideFrames"), 12)) if kind == "lines" else 8.0
    return (kind, rs, max(0, int(num(get_in(tpl, "AnimStart"), 0) // 1)), int(num(get_in(tpl, "AnimFrames"), 0) // 1),
            num(get_in(tpl, "AnimNatural"), 1), num(get_in(tpl, "StepFrames"), 7 if kind == "cloud" else 5), width, bake)


def kinetic_value(kind, inp, k, p):
    """The generated expression's value for row k at pop progress p (0..1)."""
    if kind == "lines":
        f = min(1.0, p / 0.6)
        return f * f * (3 - 2 * f)
    if inp == "Opacity1":
        return min(1.0, p * 3)
    q = p - 1
    e = 1 + 2.70158 * q * q * q + 1.70158 * q * q
    if inp in ("WordSizeX", "WordSizeY"):
        return 0.25 + 0.75 * e
    if inp == "WordAngleZ":
        return (9 if k % 2 else -9) * (1 - e)
    return -0.02 * (1 - e)          # WordOffset (Y of its XYPath)


def kinetic_expr_ok(kind, inp, expr):
    if not expr or "time" not in expr or "local p = (tt - (" not in expr:
        return False
    # the last line: Lines' opacity ("local f = ... return f * f * (3 - 2 * f)") and the AngleZ sign share it with
    # other statements, so match its end
    tail = expr.strip().split("\n")[-1].strip()
    want = KINETIC_OPACITY_TAIL[kind] if inp == "Opacity1" else KINETIC_TAILS.get(inp)
    return bool(want) and tail.endswith(want)


def key_kinetic(comp):
    """Converts the Pop<k> followers' per-letter expressions to keyframes (first call) and re-keys them for the current
    timing. Returns the number of inputs keyed (0 = not a Kinetic comp, or nothing to key)."""
    with LOCKED(comp):
        return key_kinetic_inner(comp)


def key_kinetic_inner(comp):
    tpl, kind = kinetic_template(comp)
    if tpl is None:
        return 0
    st = kinetic_state(comp, tpl, kind)
    if kind == "justpop":       # no followers: its words pop by Size (bake_rows)
        keyed = bake_rows(comp, tpl, kind, st)
        if keyed:
            try:
                tpl.SetData(SEG_KEYED_DATA, json.dumps(st))
            except Exception:
                pass
        return keyed
    _, rs, AS, AF, NAT, STEP, W = st[:7]
    NAT = max(1.0, NAT)
    D = max(1.0, AF - AS)

    def frame(tt):        # comp frame where the remapped time reaches tt (inverse of REMAP in the generators)
        if AF <= 0:
            rel = tt
        elif tt < NAT:
            rel = tt * D / NAT
        else:
            rel = tt - NAT + D
        return rs + AS + rel

    keyed = 0
    for k in range(1, 65):
        fol = comp.FindTool("Pop%d" % k)
        if fol is None:
            break
        if attrs(fol).get("TOOLS_RegID") not in FOLLOWERS:
            continue
        try:
            marked = fol.GetData(KINETIC_DATA)
        except Exception:
            marked = None
        if marked not in (None, kind):
            continue
        t0 = (k - 1) * STEP
        # pop progress samples: every half frame of the remapped time, plus the kinks (opacity full at p 1/3 or 0.6,
        # the retime's end at NAT)
        ps = set(j / (2.0 * W) for j in range(int(2 * W) + 1)) | {1.0, 1 / 3.0, 0.6}
        if t0 < NAT < t0 + W:
            ps.add((NAT - t0) / W)
        ps = sorted(p for p in ps if 0 <= p <= 1)
        did = False
        for inp in KINETIC_INPUTS[kind]:
            try:
                expr = getattr(fol, inp).GetExpression()
            except Exception:
                expr = None
            if expr and not kinetic_expr_ok(kind, inp, expr):
                continue                     # not the generated curve (edited by hand): leave it alone
            if not expr and marked is None:
                continue                     # never keyed by us and no expression: nothing to do
            try:
                if expr:
                    getattr(fol, inp).SetExpression(None)
                sp = anim_spline(fol, inp, "rise" if inp == "WordOffset" else "value")
                if sp is None:
                    if expr:
                        getattr(fol, inp).SetExpression(expr)
                    continue
                keys = {}
                for p in ps:
                    keys[round(frame(t0 + p * W), 4)] = {1: kinetic_value(kind, inp, k, p), "Flags": {"Linear": True}}
                lo, hi = min(keys), max(keys)
                try:
                    old = [float(x) for x in (sp.GetKeyFrames() or {}).keys()]
                except Exception:
                    old = []
                for x in old:        # see key_followers: overwrite stray keys with the held value, then delete them
                    if x < lo - 1e-3:
                        keys[x] = {1: kinetic_value(kind, inp, k, 0.0), "Flags": {"Linear": True}}
                    elif x > hi + 1e-3:
                        keys[x] = {1: kinetic_value(kind, inp, k, 1.0), "Flags": {"Linear": True}}
                    elif x not in keys:
                        keys[x] = {1: kinetic_value(kind, inp, k, max(0.0, min(1.0, (x - lo) / max(1e-6, hi - lo)))),
                                   "Flags": {"Linear": True}}
                sp.SetKeyFrames(keys, True)
                try:
                    sp.DeleteKeyFrames(-1e6, lo - 1e-3)
                    sp.DeleteKeyFrames(hi + 1e-3, 1e6)
                except Exception:
                    pass
                keyed += 1
                did = True
            except Exception:
                continue
        if did and marked is None:
            try:
                fol.SetData(KINETIC_DATA, kind)
            except Exception:
                pass
    try:
        keyed += bake_rows(comp, tpl, kind, st)
    except Exception:
        pass
    if keyed:
        try:
            tpl.SetData(SEG_KEYED_DATA, json.dumps(st))
        except Exception:
            pass
    return keyed


# ---------------------------------------------------------------- Kinetic Cloud / Lines, Justified Pop: rows baked
# Each row (Kinetic) or word (Justified Pop) is its own Text+ whose text, Size, Center, colour (Cloud: AngleZ; Justified
# Pop rows: Style) were Lua expressions of the Template. Fusion caches no expression results, so ~170 of them ran on
# every frame of a Justified Pop clip, and every one of its 21 full-frame Text+ went through the Merge chain even when
# the line had 5 words: very slow playback. bake_rows writes the same values instead: plain values for what does not
# move, linear keys (one per frame where it moves, straight runs dropped) for Size / Center / AngleZ, and puts the
# Merge of each empty slot in pass-through. The layout comes from Template.Comments (the generators' cached layout:
# row count, then "accent<TAB>size<TAB>x<TAB>y<TAB>text" per row); only the Template is read, never a row (reading a
# follower-fed Text+ froze Resolve). The Template keeps its expressions; what the bake used is part of kinetic_state,
# so a text / colour / slider / trim change re-bakes through the same paths as the follower keys (placement, timing
# bar, seg-watch / sweep, text edits, Clip controls). Font and the emphasis Style stay plain links to the Template.
BAKE_DATA = "ElsaRowBake"         # CustomData on baked row Text+ / followers: they are not text boxes (is_mirror)
BAKE_COMMON = ("Comments", "Center", "Red1", "Green1", "Blue1", "Red2", "Green2", "Blue2")
BAKE_EXTRA = {
    "justpop": ("Style", "PopFrames", "StepFrames", "Spread", "AnimFrames", "AnimStart", "Pop", "Bounce"),
    "lines": ("SlideDist", "Pattern", "Settle"),
    "cloud": ("Tilt", "PullFrames", "Zoom", "CamTilt", "Width", "Height"),
}
JP_SLOTS = ["U%d" % k for k in range(1, 9)] + ["E%d" % k for k in range(1, 6)] + ["L%d" % k for k in range(1, 9)]
JP_EMPH_STYLE, JP_ROW_STYLE = "ExtraBold", "SemiBold"     # tools/gen-justified-pop.py EMPH_STYLE / ROW_STYLE


def bake_inputs(tpl, kind):
    """[[id, value]] of the Template inputs bake_rows uses (JSON-safe: Center as [x, y])."""
    out = []
    for i in BAKE_COMMON + BAKE_EXTRA.get(kind, ()):
        v = get_in(tpl, i)
        if i == "Center":
            v = as_pt(v) or [0.5, 0.5]
        elif not isinstance(v, (int, float, str)) and v is not None:
            v = str(v)
        out.append([i, v])
    return out


def bake_layout(txt):
    """Template.Comments -> [(accent, size, x, y, text)], or None when it is not a layout."""
    lines = str(txt or "").split("\n")
    try:
        n = int(lines[0])
    except Exception:
        return None
    rows = []
    for ln in lines[1:]:
        parts = ln.split("\t", 4)
        if len(parts) != 5:
            continue
        try:
            rows.append((parts[0] == "1", float(parts[1]), float(parts[2]), float(parts[3]), parts[4]))
        except Exception:
            continue
    return rows if len(rows) == n else None


def bake_prune(frames, vals, eps=1e-7):
    """Drops the samples a straight line between their neighbours already gives (keys are linear)."""
    n = len(vals)
    if n <= 2:
        return list(zip(frames, vals))
    keep = [0]
    for i in range(1, n - 1):
        if abs(vals[i - 1] - 2 * vals[i] + vals[i + 1]) > eps * (1 + abs(vals[i])):
            keep.append(i)
    keep.append(n - 1)
    return [(frames[i], vals[i]) for i in keep]


def bake_keys(sp, pts):
    """Writes [(frame, value)] as the spline's only keys (linear). Keys from an earlier bake are first given the new
    curve's value (DeleteKeyFrames always leaves one key) and then deleted."""
    keys = {float(f): {1: float(v), "Flags": {"Linear": True}} for f, v in pts}
    lo, hi = min(keys), max(keys)
    try:
        old = [float(x) for x in (sp.GetKeyFrames() or {}).keys()]
    except Exception:
        old = []
    xs = sorted(keys)
    stray = []
    for x in old:
        if x in keys:
            continue
        if x < lo:
            v = keys[lo][1]
        elif x > hi:
            v = keys[hi][1]
        else:
            j = next(k for k in range(1, len(xs)) if xs[k] >= x)
            a, b = xs[j - 1], xs[j]
            v = keys[a][1] + (keys[b][1] - keys[a][1]) * (x - a) / max(1e-9, b - a)
            stray.append((a, b))
        keys[x] = {1: v, "Flags": {"Linear": True}}
    sp.SetKeyFrames(keys, True)
    try:
        sp.DeleteKeyFrames(-1e6, lo - 1e-3)
        sp.DeleteKeyFrames(hi + 1e-3, 1e6)
        for a, b in sorted(set(stray)):
            sp.DeleteKeyFrames(a + 1e-3, b - 1e-3)
    except Exception:
        pass


def bake_clear(tool, inp):
    try:
        if getattr(tool, inp).GetExpression():
            getattr(tool, inp).SetExpression(None)
    except Exception:
        pass


def bake_value(tool, inp, v):
    """A plain value (text, number or [x, y])."""
    bake_clear(tool, inp)
    if isinstance(v, (list, tuple)):
        v = {1: float(v[0]), 2: float(v[1]), 3: 0.0}
    tool.SetInput(inp, v)


def bake_curve(tool, inp, frames, vals):
    """A number per frame: a plain value when it never changes (and no keys yet), else linear keys."""
    bake_clear(tool, inp)
    if max(vals) - min(vals) < 1e-9 and is_driven(tool, inp) is None:
        tool.SetInput(inp, float(vals[0]))
        return
    sp = anim_spline(tool, inp, "value")
    if sp is None:
        tool.SetInput(inp, float(vals[-1]))
        return
    bake_keys(sp, bake_prune(frames, vals))


def bake_point(tool, inp, frames, xs, ys):
    """A point per frame: a plain value when it never moves (and no path yet), else an XY path with linear keys."""
    bake_clear(tool, inp)
    drv = is_driven(tool, inp)
    if drv is None and max(xs) - min(xs) < 1e-9 and max(ys) - min(ys) < 1e-9:
        tool.SetInput(inp, {1: float(xs[0]), 2: float(ys[0]), 3: 0.0})
        return
    if drv is None:
        if not tool.AddModifier(inp, "XYPath"):
            tool.SetInput(inp, {1: float(xs[-1]), 2: float(ys[-1]), 3: 0.0})
            return
        drv = is_driven(tool, inp)
    if drv is None or attrs(drv).get("TOOLS_RegID") != "XYPath":
        return
    for axis, vals in (("X", xs), ("Y", ys)):
        sp = is_driven(drv, axis)
        if sp is None:
            if not drv.AddModifier(axis, "BezierSpline"):
                continue
            sp = is_driven(drv, axis)
        if sp is not None:
            bake_keys(sp, bake_prune(frames, vals))


def bake_mark(tool, kind):
    try:
        if tool.GetData(BAKE_DATA) != kind:
            tool.SetData(BAKE_DATA, kind)
    except Exception:
        pass


def bake_merge(comp, slot, empty):
    """The Merge that lays slot `slot` (1-based) over the ones before it: pass-through when the slot is empty."""
    if slot < 2:
        return
    m = comp.FindTool("Merge%d" % (slot - 1))
    if m is None:
        return
    try:
        if bool((m.GetAttrs() or {}).get("TOOLB_PassThrough")) != bool(empty):
            m.SetAttrs({"TOOLB_PassThrough": bool(empty)})
        # attrs() caches what it read: wake_effects must see the new state, or it would toggle the Merge back on
        attrs(m)["TOOLB_PassThrough"] = bool(empty)
    except Exception:
        pass


def remap_tt(t, rs, AS, AF, NAT):
    """The generators' REMAP: comp time -> the preset's own time (Animation Start / Frames retiming)."""
    rel = t - rs - AS
    if rel <= 0:
        return 0.0
    if AF <= 0:
        return rel
    D = max(1, AF - AS)
    return rel * NAT / D if rel < D else NAT + rel - D


def bake_rows(comp, tpl, kind, st):
    """Bakes the row / word Text+ of a Kinetic Cloud / Lines or Justified Pop clip from its Template (see above).
    Returns the number of tools written (0 = not such a comp, or its layout could not be read)."""
    B = dict(st[-1])
    rows = bake_layout(B.get("Comments"))
    if not rows:
        return 0
    cen = B.get("Center") or [0.5, 0.5]
    TX, TY = float(cen[0]), float(cen[1])

    def col(acc):
        n = "2" if acc else "1"
        return [num(B.get(c + n), 1.0) for c in ("Red", "Green", "Blue")]

    a = attrs(comp)
    try:
        rs = float(a.get("COMPN_RenderStart") or 0)
        re_ = float(a.get("COMPN_RenderEnd") or rs)
    except Exception:
        return 0
    frames = list(range(int(math.floor(rs)), int(math.ceil(re_)) + 1))
    done = 0
    if kind == "justpop":
        L = max(1.0, re_ - rs + 1)
        NW = sum(1 for r in rows if r[4] != "")
        POP = max(1.0, num(B.get("PopFrames"), 6))
        STEP = num(B.get("StepFrames"), 8)
        SPREAD = num(B.get("Spread"), 0.7)
        if SPREAD > 0 and NW > 1:
            STEP = min(STEP, (L * SPREAD - POP) / (NW - 1))
        STEP = max(1.0, STEP)
        NAT = max(1, int(math.ceil((max(1, NW) - 1) * STEP + POP + 1)))
        AF = int(math.floor(num(B.get("AnimFrames"), 0)))
        AS = max(0, int(math.floor(num(B.get("AnimStart"), 0))))
        pop = num(B.get("Pop"), 1) >= 0.5
        Bk = 1.70158 * num(B.get("Bounce"), 1)
        style = str(B.get("Style") or "")
        row_style = JP_ROW_STYLE if style in (JP_EMPH_STYLE, "Black", "Bold", "Heavy") else style
        tts = [remap_tt(t, rs, AS, AF, NAT) for t in frames]
        ordn = 0
        for k, name in enumerate(JP_SLOTS, 1):
            tool = comp.FindTool(name)
            if tool is None or k > len(rows):
                continue
            acc, sz, cx, cy, text = rows[k - 1]
            try:
                bake_value(tool, "StyledText", text)
                bake_value(tool, "Center", [TX + cx, TY + cy])
                for ch, v in zip(("Red1", "Green1", "Blue1"), col(acc)):
                    bake_value(tool, ch, v)
                if not name.startswith("E"):
                    bake_value(tool, "Style", row_style)
                if text == "":
                    bake_curve(tool, "Size", frames, [0.0])
                else:
                    ordn += 1
                    vals = []
                    for tt in tts:
                        p = (tt - (ordn - 1) * STEP) / POP
                        if p <= 0:
                            vals.append(0.0)
                        elif not pop or p >= 1:
                            vals.append(sz)
                        else:
                            q = p - 1
                            vals.append(sz * (1 + (Bk + 1) * q * q * q + Bk * q * q))
                    bake_curve(tool, "Size", frames, vals)
                bake_mark(tool, kind)
                done += 1
            except Exception:
                continue
            bake_merge(comp, k, text == "")
        return done

    _, _, AS, AF, NAT, STEP = st[:6]
    NAT = max(1.0, NAT)
    cnt = len(rows)
    tts = [remap_tt(t, rs, AS, AF, NAT) for t in frames]
    if kind == "lines":
        SLIDE = max(1.0, st[6])
        DIST = num(B.get("SlideDist"), 0.16)
        PAT = int(math.floor(num(B.get("Pattern"), 0)))
        OVS = num(B.get("Settle"), 0)

        def dirof(k):
            if PAT == 2:
                return -1
            if PAT == 3:
                return 1
            d = -1 if k % 2 == 1 else 1
            return -d if PAT == 1 else d

        def ease(p):
            q = 1 - p
            e = 1 - q * q * q
            if OVS > 0:
                e += OVS * math.sin(p * math.pi) * q * 4
            return e
    else:
        asp = num(B.get("Width"), 1080) / max(1.0, num(B.get("Height"), 1920))
        pat = [-1, 0.6, -0.4, 1, -0.8, 0.3, -1, 0.7, -0.5, 0.9, -0.6, 0.4]
        tilt = num(B.get("Tilt"), 0)
        POPF = 8
        PULL = num(B.get("PullFrames"), 12)
        Z = num(B.get("Zoom"), 1.4)
        CT = num(B.get("CamTilt"), 0)

        def sm(p):
            p = max(0.0, min(1.0, p))
            return p * p * (3 - 2 * p)

        cams = []
        for tt in tts:
            px, py, z, ca = 0.0, 0.0, 1.0, 0.0
            if cnt > 0 and Z > 1.001:
                f = max(1.0, tt / STEP + 1)
                fi = min(int(math.floor(f)), cnt)
                fj = min(fi + 1, cnt)
                fr = sm(f - fi)
                fy = rows[fi - 1][3] * (1 - fr) + rows[fj - 1][3] * fr
                fx = rows[fi - 1][2] * (1 - fr) + rows[fj - 1][2] * fr
                pull = sm((tt - ((cnt - 1) * STEP + POPF * 0.6)) / PULL) if PULL else (1.0 if tt - ((cnt - 1) * STEP + POPF * 0.6) > 0 else 0.0)
                px, py = fx * (1 - pull), fy * (1 - pull)
                z = Z * (1 - pull) + pull
                ca = CT * math.sin(f * 1.9) * (1 - pull)
            cams.append((px, py, z, ca))
    for k in range(1, 65):
        tool = comp.FindTool("Row%d" % k)
        if tool is None:
            break
        fol = comp.FindTool("Pop%d" % k)
        acc, sz, cx, cy, text = rows[k - 1] if k <= cnt else (False, 0.01, 0.0, 0.0, "")
        try:
            if fol is not None and attrs(fol).get("TOOLS_RegID") in FOLLOWERS:
                bake_value(fol, "Text", text)
                bake_mark(fol, kind)
            for ch, v in zip(("Red1", "Green1", "Blue1"), col(acc)):
                bake_value(tool, ch, v)
            if kind == "lines":
                bake_curve(tool, "Size", frames, [sz if k <= cnt else 0.01])
                if k > cnt:
                    bake_point(tool, "Center", frames, [TX], [TY])
                else:
                    d = dirof(k)
                    xs = [TX + d * DIST * (1 - ease(max(0.0, min(1.0, (tt - (k - 1) * STEP) / SLIDE)))) for tt in tts]
                    bake_point(tool, "Center", frames, xs, [TY + cy] * len(frames))
            elif k > cnt:
                bake_curve(tool, "Size", frames, [0.01])
                bake_point(tool, "Center", frames, [TX], [TY])
                bake_curve(tool, "AngleZ", frames, [0.0])
            else:
                xs, ys, ss, ang = [], [], [], []
                for px, py, z, ca in cams:
                    dx, dy = (cx - px) * z, (cy - py) * z
                    r = math.radians(ca)
                    xs.append(TX + (dx * math.cos(r) - dy * math.sin(r)) / asp)
                    ys.append(TY + dx * math.sin(r) + dy * math.cos(r))
                    ss.append(sz * z)
                    ang.append(tilt * pat[k - 1] + ca)
                bake_point(tool, "Center", frames, xs, ys)
                bake_curve(tool, "Size", frames, ss)
                bake_curve(tool, "AngleZ", frames, ang)
            bake_mark(tool, kind)
            done += 1
        except Exception:
            continue
        bake_merge(comp, k, k > cnt or text == "")
    return done


def segment_text_empty(mt, n):
    """True when MultiText layer n (segment n's text) holds no text, read through its follower when it has one.
    Unknown (no MultiText / no such layer) counts as not empty, so its lane still shows."""
    if mt is None:
        return False
    try:
        txt = None
        drv = is_driven(mt, "Text%d.StyledText" % n)
        if drv is not None and attrs(drv).get("TOOLS_RegID") in FOLLOWERS:
            txt = get_in(drv, "Text")
        if not isinstance(txt, str):
            txt = get_in(mt, "Text%d.StyledText" % n)
        return isinstance(txt, str) and not txt.strip()
    except Exception:
        return False


def segment_name(mt, n, label):
    """Segment n's lane name: the MultiText layer's own name (Upper / Emphasis / Lower, as in its Text List) when the
    preset only gave the generic "Text n"."""
    if mt is None or label != "Text %d" % n:
        return label
    nm = get_in(mt, "TextName%d" % n)
    return nm.strip() if isinstance(nm, str) and nm.strip() else label


def row_text(mt, n):
    """MultiText layer n's text, read through its follower when it has one (as segment_text_empty). None = no layer."""
    drv = is_driven(mt, "Text%d.StyledText" % n)
    if drv is not None and attrs(drv).get("TOOLS_RegID") in FOLLOWERS:
        txt = get_in(drv, "Text")
        if isinstance(txt, str):
            return txt
    txt = get_in(mt, "Text%d.StyledText" % n)
    return txt if isinstance(txt, str) else None


def op_mt_rows_get(a):
    """The panel's Upper / Emphasize / Lower splitter on a placed clip: {item} -> {rows: [{n, name, text}]}."""
    comp = get_comp(a["item"], a.get("comp"))
    mt = multitext_tool(comp)
    if mt is None:
        return {"rows": []}
    rows = []
    for n in range(1, 21):
        txt = row_text(mt, n)
        if txt is None:
            break
        nm = get_in(mt, "TextName%d" % n)
        rows.append({"n": n, "name": nm.strip() if isinstance(nm, str) else "", "text": txt})
    return {"rows": rows}


def op_mt_rows_set(a):
    """Sets row texts of a placed MultiText clip: {item, texts: {n: text}, clipFrames}. Like set_boxes' light pass:
    the new text only, plus the lone-row start (and its letter keys) when a row is now alone or no longer alone."""
    comp = get_comp(a["item"], a.get("comp"))
    mt = multitext_tool(comp)
    if mt is None:
        raise RuntimeError("This clip has no MultiText")
    done = []
    with LOCKED(comp):
        for k, v in (a.get("texts") or {}).items():
            n = int(k)
            inp = "Text%d.StyledText" % n
            if get_in(mt, inp) is None:
                continue
            drv = is_driven(mt, inp)
            if drv is not None and attrs(drv).get("TOOLS_RegID") in FOLLOWERS:
                drv.SetInput("Text", str(v))
            else:
                mt.SetInput(inp, str(v))
            done.append(n)
    lead = False
    try:
        with LOCKED(comp):
            lead = lead_single_segment(comp)
            if lead:
                fit_segments(comp, a.get("clipFrames"))
        rekey_comp(comp, a.get("item"))         # moved rows, and the box sweep's letter count
    except Exception:
        pass
    glass_after(a)
    return {"set": done, "segLead": lead}


def op_timing_get(a):
    """The clip's timing as ranges: [{key, label, start, end, defStart, defEnd, hasStart}]. Anim / typing ends of 0
    (= the preset's own timing) are sent as 0 with the natural length, and resolved in src/main/anim-timing.js."""
    comp = get_comp(a["item"], a.get("comp"))
    tool, inp, kind = timing_tool(comp)
    if tool is None:
        return {"kind": None}
    if kind == "segments":
        try:   # the clip under the playhead / selected: a head trim since it was keyed moves its letter keys along
            ent = _seg_seen.get(str(a["item"]))
            rekey_if_changed(comp, tool, ent[2] if ent else None, str(a["item"]))
        except Exception:
            pass
        mt = multitext_tool(comp)
        ranges = [{"key": str(n), "label": segment_name(mt, n, label), "start": num(get_in(tool, "Seg%dStart" % n), 0),
                   "end": num(get_in(tool, "Seg%dEnd" % n), 0), "defStart": ds, "defEnd": de, "hasStart": True,
                   "empty": segment_text_empty(mt, n)}
                  for n, label, ds, de in segment_list(tool)]
        # only: the one row with text when every other row is empty (then only that row's sound is placed)
        filled = [r["key"] for r in ranges if not r["empty"]]
        only = int(filled[0]) if (mt is not None and len(ranges) > 1 and len(filled) == 1) else None
        return {"kind": kind, "ranges": ranges, "only": only}
    if kind == "anim" and kinetic_template(comp)[0] is not None:
        try:   # Kinetic rows: a head trim / Inspector change since they were keyed moves their keys along
            ent = _seg_seen.get(str(a["item"]))
            rekey_if_changed(comp, tool, ent[2] if ent else None, str(a["item"]))
        except Exception:
            pass
    out = {"kind": kind, "input": inp, "value": get_in(tool, inp)}
    if kind == "anim":
        out["natural"] = get_in(tool, "AnimNatural")
    st = get_in(tool, START_INPUT.get(kind))
    out["hasStart"] = st is not None
    out["start"] = num(st, 0)
    return out


def op_timing_set(a):
    """a.ranges: [{key, start, end}] as op_timing_get gave them (a.value: the older single end frame)."""
    comp = get_comp(a["item"], a.get("comp"))
    tool, inp, kind = timing_tool(comp)
    if tool is None:
        return {"ok": False, "why": "That clip has no timing slider"}
    ranges = a.get("ranges")
    if ranges is None:
        ranges = [{"key": kind, "start": 0, "end": a.get("value")}]
    for r in ranges:
        start = max(0, int(round(num(r.get("start"), 0))))
        end = max(start + 1, int(round(num(r.get("end"), 1))))
        if kind == "segments":
            n = int(r.get("key"))
            tool.SetInput("Seg%dStart" % n, start)
            tool.SetInput("Seg%dEnd" % n, end)
        else:
            if get_in(tool, START_INPUT.get(kind)) is not None:
                tool.SetInput(START_INPUT[kind], start)
            tool.SetInput(inp, end)
    key_followers(comp)       # segment letters, Kinetic rows (no-op for other presets)
    if a.get("wake"):
        wake_effects(comp)
    glass_after(a)
    return {"ok": True}


# ---------------------------------------------------------------- Inspector repair (src/main/repair.js)
def op_tools(a):
    """The tools of a clip's composition: [[name, RegID], ...]. Used to tell which preset a clip holds."""
    comp = get_comp(a["item"], a.get("comp"))
    return {"tools": [[attrs(t).get("TOOLS_Name"), attrs(t).get("TOOLS_RegID")] for t in tool_list(comp)]}


def op_read_style(a):
    """The Inspector values of one clip's text tools: Size / Font / Style / LineSpacing only. Never a text input
    (StyledText) and never a mirror Text+ (a highlight box fed by a Follower): a script GetInput of a
    follower-driven text deadlocks Resolve's main thread. This is the read-back automation uses after a place."""
    comp = get_comp(a["item"], a.get("comp"))
    out = []

    def num(v):
        try:
            return round(float(v), 4)
        except Exception:
            return None

    def txt(v):
        return v if isinstance(v, str) else None

    for tool in tool_list(comp):
        at = attrs(tool)
        rid, name = at.get("TOOLS_RegID"), at.get("TOOLS_Name")
        if rid == "TextPlus":
            if is_mirror(tool):
                continue
            out.append({"tool": name, "kind": "textplus", "size": num(get_in(tool, "Size")), "font": txt(get_in(tool, "Font")),
                        "style": txt(get_in(tool, "Style")), "lineSpacing": num(get_in(tool, "LineSpacing"))})
        elif rid == "MultiText":
            layers = []
            try:
                order = get_in(tool, "TextOrder")
                if isinstance(order, dict):
                    layers = sorted(set(int(float(v)) for k, v in order.items() if not str(k).startswith("__")))
            except Exception:
                layers = []
            for n in layers[:16]:
                out.append({"tool": name, "kind": "multitext", "layer": n, "name": txt(get_in(tool, "TextName%d" % n)),
                            "size": num(get_in(tool, "Text%d.Size" % n)), "font": txt(get_in(tool, "Text%d.Font" % n)),
                            "style": txt(get_in(tool, "Text%d.Style" % n)), "lineSpacing": num(get_in(tool, "Text%d.LineSpacing" % n))})
    return {"tools": out}


# Inputs never copied between two clips of the same preset: the clip's own range / format, and the MultiText
# bookkeeping tables (the same in both clips, and not plain values).
COPY_SKIP = {"GlobalIn", "GlobalOut", "Width", "Height", "PixelAspect", "UseFrameFormatSettings", "Depth",
             "TextOrder", "TableIndices", "TextSelection", "GlobalTransformation", "GlobalTransformationAspectRatio",
             "Index"}


def op_copy_inputs(a):
    """Copies every plain input value from one clip's comp (from) to another's (to) that holds the same preset:
    tools are matched by name, inputs by id. Inputs that are animated / driven by a modifier or carry an expression in
    either clip are left alone (the same spline or expression already drives both). Nothing is imported or pasted,
    so the target clip stays a Resolve-built title and its Inspector keeps working."""
    src = get_comp(a["from"], None)
    dst = get_comp(a["to"], None)
    by_name = {attrs(t).get("TOOLS_Name"): t for t in tool_list(src)}
    copied, failed, skipped_tools = 0, [], []
    dst.Lock()
    try:
        for t in tool_list(dst):
            at = attrs(t)
            name = at.get("TOOLS_Name")
            if at.get("TOOLS_RegID") in ("MediaOut", "Saver"):
                continue
            s = by_name.get(name)
            if s is None or attrs(s).get("TOOLS_RegID") != at.get("TOOLS_RegID"):
                skipped_tools.append(name)
                continue
            src_inputs = {}
            for si in as_list(s.GetInputList()):
                sid = attrs(si).get("INPS_ID")
                if sid:
                    src_inputs[sid] = si
            for inp in as_list(t.GetInputList()):
                iid = attrs(inp).get("INPS_ID")
                if not iid or iid in COPY_SKIP:
                    continue
                si = src_inputs.get(iid)
                if si is None:
                    continue
                try:
                    if inp.GetConnectedOutput() is not None or si.GetConnectedOutput() is not None:
                        continue
                    if inp.GetExpression() or si.GetExpression():
                        continue
                    v = s.GetInput(iid)
                    # only plain values travel: numbers, text, points / colours (tables); gradients and other
                    # objects are the preset's own and the same in both clips
                    if v is None or not isinstance(v, (bool, int, float, str, dict, list)) or v == t.GetInput(iid):
                        continue
                    t.SetInput(iid, v)
                    copied += 1
                except Exception:
                    failed.append("%s.%s" % (name, iid))
    finally:
        dst.Unlock()
    try:
        key_followers(dst)      # the copied Seg ranges: the new clip's letter keyframes follow them
    except Exception:
        pass
    return {"ok": True, "copied": copied, "failed": failed, "skippedTools": skipped_tools}


def op_row_times(a):
    """Row-by-row presets (a Template with a "StepFrames" slider and Pop<k> followers, e.g. Kinetic Cloud): the clip
    frame (from the clip's start) at which each row starts to pop in, with the Animation Start / Frames retiming
    applied, so one sound can be placed per row. {"frames": []} when the comp is not such a preset."""
    comp = get_comp(a["item"], a.get("comp"))
    tpl = comp.FindTool("Template")
    step = get_in(tpl, "StepFrames") if tpl is not None else None
    if not isinstance(step, (int, float)) or step <= 0:
        return {"frames": [], "count": 0}
    rows = 0
    for k in range(1, 65):
        pop = comp.FindTool("Pop%d" % k)
        if pop is None:
            break
        try:
            if str(pop.GetInput("Text") or "").strip():
                rows += 1
        except Exception:
            pass
    start = max(0, int(num(get_in(tpl, "AnimStart"), 0)))
    frames_in = int(num(get_in(tpl, "AnimFrames"), 0))
    natural = max(1.0, num(get_in(tpl, "AnimNatural"), 1))
    out = []
    for k in range(rows):
        tt = k * float(step)
        if frames_in <= 0:
            f = start + tt
        else:
            d = max(1, frames_in - start)
            f = start + (tt * d / natural if tt < natural else natural + tt - natural)
        out.append(int(round(f)))
    return {"frames": out, "count": rows, "step": float(step), "natural": natural, "animFrames": frames_in}


# ---------------------------------------------------------------- effect presets (src/main/effect-presets.js)
# Stop Motion / Wiggle / Glitch are Resolve Fusion effects (Edit/Effects/Subtitle Animator/ELSA <name>.setting) put
# on any clip with TimelineItem.AddEffect: a video, a title or a placed text preset. Each is its own comp on the clip,
# so a title's own comp (and its Inspector) is never touched. Several on one clip stack in FX_ORDER.
FX_PREFIX = "Fusion/Effects/Subtitle Animator/"
FX_NAMES = {"Transform": "ELSA Transform", "Track": "ELSA Track Subject", "Glitch": "ELSA Glitch", "Wiggle": "ELSA Wiggle", "StopMotion": "ELSA Stop Motion"}
# Stop Motion is a Fusion effect (a TimeStretcher, the LAST effect before the clip's output), so the frames it holds
# already carry the glitch / wiggle: the look holds as one. Resolve's own OFX Stop Motion sits outside Fusion and ran
# before our effects (the glitch / wiggle kept moving over a held picture). The OFX is only the fallback for clips with
# Edit sizing (Zoom / Pan / Tilt / Rotation): in a Fusion effect, held frames come back without that sizing, so a
# punched-in clip jumped. The OFX's settings cannot be scripted.
FX_OFX = {"StopMotion": "Resolve FX/Resolve FX Temporal/Stop Motion"}
FX_OFX_NAMES = {"StopMotion": "Stop Motion"}
FX_ORDER = ["Transform", "Track", "Glitch", "Wiggle", "StopMotion"]
# the tool inside each effect holding its Strength (0..100); keep in step with STRENGTH_TOOL in effect-presets.js
FX_STRENGTH_TOOL = {"Glitch": "GlitchOut", "Wiggle": "WiggleDisplace"}
# the tool holding each effect's Hold (frames its clock steps by; Stop Motion's Frame Repeat)
FX_HOLD_TOOL = {"Transform": "XfMove", "Glitch": "GlitchOut", "Wiggle": "WiggleDisplace", "StopMotion": "StopMotionTime"}


def fx_is_ofx(effect):
    try:
        return effect.GetFusionComp() is None
    except Exception:
        return True


def fx_hold_tool(effect, key):
    try:
        comp = effect.GetFusionComp() if key in FX_HOLD_TOOL else None
        return comp.FindTool(FX_HOLD_TOOL[key]) if comp is not None else None
    except Exception:
        return None


def fx_clip_is_sized(it):
    """True when the clip has Edit sizing a Fusion time-remap would drop on held frames. Only media clips (video
    punch-ins): titles / generators have no Media Pool item, and placed text presets are positioned with Edit Tilt /
    Zoom, which must NOT send them to the OFX (it did nothing on them; dragging ELSA Stop Motion on worked)."""
    try:
        if it.GetMediaPoolItem() is None:
            return False
    except Exception:
        pass
    try:
        p = it.GetProperty() or {}
    except Exception:
        return False
    def num(k, d):
        try:
            return float(p.get(k, d))
        except Exception:
            return d
    return (abs(num("ZoomX", 1.0) - 1) > 1e-4 or abs(num("ZoomY", 1.0) - 1) > 1e-4 or abs(num("Pan", 0.0)) > 1e-4 or
            abs(num("Tilt", 0.0)) > 1e-4 or abs(num("RotationAngle", 0.0)) > 1e-4)


def fx_strength_tool(effect, key):
    if key not in FX_STRENGTH_TOOL:
        return None
    try:
        comp = effect.GetFusionComp()
        return comp.FindTool(FX_STRENGTH_TOOL[key]) if comp is not None else None
    except Exception:
        return None


# extra settings read back for the panel (on the Strength tool): Glitch's entry blink, fringe colours and opacity
FX_PARAMS = {"Glitch": ["BlinkIn", "ColorARed", "ColorAGreen", "ColorABlue", "ColorBRed", "ColorBGreen", "ColorBBlue", "Opacity"],
             "Transform": ["ZoomPct", "MoveX", "MoveY", "Ease", "Reverse", "InF", "OutF"],
             "Track": ["FollowX", "FollowY", "FollowScale", "FollowRot", "Smooth"]}
# the tool inside an effect holding its FX_PARAMS (Glitch: its Strength tool)
FX_PARAM_TOOL = {"Glitch": "GlitchOut", "Transform": "XfMove", "Track": "XfTrack"}


def fx_param_tool(effect, key):
    if key not in FX_PARAM_TOOL:
        return None
    try:
        comp = effect.GetFusionComp()
        return comp.FindTool(FX_PARAM_TOOL[key]) if comp is not None else None
    except Exception:
        return None


# ELSA Transform's template moves with expressions (Prog / E / Size / Center), which works when the effect is dragged on
# by hand but cost ~55 ms a frame on a 1080x1920 clip (measured 2026-11-10: none 8, expressions 83, keyed 28 ms/frame).
# Clips the panel manages get the move baked: expressions removed, Size and Center keyed every frame from the same
# formulas (Hold steps included). The bake's signature sits in XfMove's Comments; fx_get re-bakes when it no longer
# matches (settings changed by hand, clip trimmed while End Frame = 0 follows the clip's end).
def _ease(i, u):
    c1 = 1.70158
    c2, c3 = c1 * 1.525, c1 + 1
    if i == 1: return u * u
    if i == 2: return 1 - (1 - u) ** 2
    if i == 3: return 2 * u * u if u < 0.5 else 1 - (2 - 2 * u) ** 2 / 2
    if i == 4: return u ** 4
    if i == 5: return 1 - (1 - u) ** 4
    if i == 6: return 8 * u ** 4 if u < 0.5 else 1 - (2 - 2 * u) ** 4 / 2
    if i == 7: return 0.0 if u <= 0 else 2 ** (10 * u - 10)
    if i == 8: return 1.0 if u >= 1 else 1 - 2 ** (-10 * u)
    if i == 9:
        if u <= 0: return 0.0
        if u >= 1: return 1.0
        return 2 ** (20 * u - 10) / 2 if u < 0.5 else (2 - 2 ** (10 - 20 * u)) / 2
    if i == 10: return c3 * u ** 3 - c1 * u ** 2
    if i == 11: return 1 + c3 * (u - 1) ** 3 + c1 * (u - 1) ** 2
    if i == 12:
        return ((2 * u) ** 2 * ((c2 + 1) * 2 * u - c2) / 2 if u < 0.5
                else ((2 * u - 2) ** 2 * ((c2 + 1) * (2 * u - 2) + c2) + 2) / 2)
    return u


def _fx_modifier(tool, inp, reg):
    """The modifier of type `reg` (BezierSpline / XYPath) driving tool.inp, or None."""
    try:
        o = getattr(tool, inp).GetConnectedOutput()
        m = o.GetTool() if o else None
        return m if m is not None and (m.GetAttrs() or {}).get("TOOLS_RegID") == reg else None
    except Exception:
        return None


def fx_bake_transform(effect, force=False):
    """Keys ELSA Transform's Size / Center for the clip (see above). Returns True when it (re)baked."""
    try:
        comp = effect.GetFusionComp()
        t = comp.FindTool("XfMove") if comp is not None else None
        if t is None:
            return False
        ca = comp.GetAttrs() or {}
        rs, re_ = int(ca.get("COMPN_RenderStart") or 0), int(ca.get("COMPN_RenderEnd") or 0)
        v = {}
        for k in ("ZoomPct", "MoveX", "MoveY", "Ease", "Reverse", "InF", "OutF", "Hold"):
            x = get_in(t, k)
            v[k] = float(x) if isinstance(x, (int, float)) and not isinstance(x, bool) else 0.0
        sig = "elsa-bake " + " ".join("%s=%g" % (k, v[k]) for k in sorted(v)) + " rs=%d re=%d" % (rs, re_)
        if not force and str(get_in(t, "Comments") or "") == sig:
            return False
        hold = max(1, int(round(v["Hold"] or 1)))
        out = v["OutF"] if v["OutF"] > 0 else (re_ - rs)
        ease = int(round(v["Ease"]))
        size, cx, cy = {}, {}, {}
        for f in range(rs, re_ + 1):
            tt = ((f - rs) // hold) * hold
            prog = min(1.0, max(0.0, (tt - v["InF"]) / max(1.0, out - v["InF"])))
            e = _ease(ease, 1 - prog if v["Reverse"] > 0.5 else prog)
            size[f] = {1: 1 + (v["ZoomPct"] / 100 - 1) * e}
            cx[f] = {1: 0.5 + v["MoveX"] / 100 * e}
            cy[f] = {1: 0.5 + v["MoveY"] / 100 * e}
        for n in ("Prog", "E", "Size", "Center"):
            try:
                getattr(t, n).SetExpression(None)
            except Exception:
                pass
        # reuse the splines of an earlier bake (SetKeyFrames replace = True swaps all their keys)
        sp = _fx_modifier(t, "Size", "BezierSpline")
        if sp is None:
            sp = comp.BezierSpline()
            t.Size = sp
        sp.SetKeyFrames(size, True)
        xy = _fx_modifier(t, "Center", "XYPath")
        if xy is None:
            xy = comp.XYPath()
            t.Center = xy
        for inp, keys in (("X", cx), ("Y", cy)):
            s = _fx_modifier(xy, inp, "BezierSpline")
            if s is None:
                s = comp.BezierSpline()
                setattr(xy, inp, s)
            s.SetKeyFrames(keys, True)
        t.SetInput("Comments", sig)
        return True
    except Exception:
        return False


# ---------------------------------------------------------------- Track Subject (src/main/subject-track.js)
# The clip follows a subject in the footage under it. The panel draws a box on the footage, the frames are exported here
# (op_track_frames: the footage clip's own ExportFrame = timeline space with its Edit sizing, without the clips above),
# tracked by src/python/subject_tracker.py in the app's OpenCV venv, and keyed into ELSA Track Subject's XfTrack by
# fx_bake_track. The raw track (timeline frames -> subject box, 0..1 of the timeline picture) is kept on XfTrack
# (SetData TRACK_DATA), so Follow X / Y / Scale and Smoothing re-key without tracking again.
TRACK_DATA = "ELSA_Track"


def track_footage_under(tl, target, frame=None):
    """The topmost enabled video clip on a lower track overlapping the target (the one under `frame` first)."""
    try:
        tt = target.GetTrackTypeAndIndex()
        tidx = int(tt[1])
    except Exception:
        tidx = tl.GetTrackCount("video") + 1
    s0, e0 = int(target.GetStart()), int(target.GetEnd())
    best = None
    for t in range(tidx - 1, 0, -1):
        try:
            if not tl.GetIsTrackEnabled("video", t):
                continue
        except Exception:
            pass
        for it in tl.GetItemListInTrack("video", t) or []:
            try:
                s, e = int(it.GetStart()), int(it.GetEnd())
                if e <= s0 or s >= e0 or it.GetMediaPoolItem() is None:
                    continue
                if hasattr(it, "GetClipEnabled") and not it.GetClipEnabled():
                    continue
            except Exception:
                continue
            if frame is None or s <= frame < e:
                return it
            if best is None:
                best = it
        if best is not None:
            return best
    return best


def op_track_source(a):
    """{items?, frame?} -> the selected clip (target), the footage under it and that footage's picture at the anchor
    frame (the playhead when it is over both, else the first frame they share) for the panel to draw the box on."""
    tl = timeline()
    items = fx_targets(a)
    if not items:
        raise RuntimeError("Select the clip to attach on the timeline first")
    target = items[0]
    frame = a.get("frame")
    frame = int(frame) if frame is not None else None
    sub = track_footage_under(tl, target, frame)
    if sub is None:
        raise RuntimeError("There is no video under this clip to track. Put the clip on a track above the footage.")
    lo = max(int(target.GetStart()), int(sub.GetStart()))
    hi = min(int(target.GetEnd()), int(sub.GetEnd())) - 1
    anchor = frame if frame is not None and lo <= frame <= hi else lo
    max_dim = int(a.get("maxDim") or 720)
    r = sub.ExportFrame(anchor - int(sub.GetStart()), {"outputType": "encodedString", "encodedImageFormat": "jpg", "maxDimension": max_dim})
    if not r or not r.get("success"):
        raise RuntimeError((r or {}).get("error") or "Resolve could not export the footage frame")
    def info(it):
        try:
            tr = int(it.GetTrackTypeAndIndex()[1])
        except Exception:
            tr = None
        return {"id": str(it.GetUniqueId()), "name": it.GetName(), "start": int(it.GetStart()), "frames": int(it.GetDuration()), "track": tr}
    warn = []
    p = sub.GetProperty() or {}
    try:
        if abs(float(p.get("RotationAngle") or 0)) > 1e-3:
            warn.append("The footage is rotated in the Edit page: tracking still works, but check the result.")
    except Exception:
        pass
    have = fx_on_item(target).get("Track")
    old = track_read(have) if have is not None else None
    # Re-track: the box where the last track found the subject on this frame (0..1, top-left), so it opens ready
    tracked_box = None
    if old:
        r_ = old["track"].get(str(anchor))
        if r_ is None and old["track"]:
            near = min(old["track"], key=lambda k: abs(int(k) - anchor))
            r_ = old["track"][near] if abs(int(near) - anchor) <= 2 else None
        if r_:
            tracked_box = [r_[0] - r_[2] / 2, r_[1] - r_[3] / 2, r_[2], r_[3]]
    return {"target": info(target), "subject": info(sub), "range": [lo, hi], "anchor": anchor,
            "data": r["data"], "imgW": r.get("width"), "imgH": r.get("height"),
            "width": int(tl.GetSetting("timelineResolutionWidth") or 1920), "height": int(tl.GetSetting("timelineResolutionHeight") or 1080),
            "fps": float(tl.GetSetting("timelineFrameRate") or 25), "warnings": warn, "previous": {"anchor": old.get("anchor"), "box": old.get("box"), "trackedBox": tracked_box} if old else None}


def op_track_frames(a):
    """{subject, from, to (timeline frames, inclusive), outDir, maxDim, cancelPath?}: exports the footage frames as
    outDir/f<frame>.jpg for the tracker."""
    sub = find_item(str(a["subject"]))
    out_dir = a["outDir"]
    os.makedirs(out_dir, exist_ok=True)
    s0 = int(sub.GetStart())
    max_dim = int(a.get("maxDim") or 640)
    cancel = a.get("cancelPath")
    n = 0
    for f in range(int(a["from"]), int(a["to"]) + 1):
        if cancel and os.path.exists(cancel):
            raise Cancelled("cancelled")
        fp = os.path.join(out_dir, "f%d.jpg" % f)
        r = sub.ExportFrame(f - s0, {"outputType": "file", "filePath": fp, "maxDimension": max_dim})
        if not r or not r.get("success"):
            raise RuntimeError((r or {}).get("error") or "Resolve could not export a frame")
        n += 1
    return {"count": n}


def track_read(effect):
    """The raw track stored on the effect: {anchor, box, track: {frame: [cx, cy, w, h, ok]}} or None."""
    try:
        comp = effect.GetFusionComp()
        t = comp.FindTool("XfTrack") if comp is not None else None
        raw = t.GetData(TRACK_DATA) if t is not None else None
        d = json.loads(raw) if raw else None
        return d if isinstance(d, dict) and isinstance(d.get("track"), dict) else None
    except Exception:
        return None


TRACK_DEFAULTS = (("FollowX", 1.0), ("FollowY", 1.0), ("FollowScale", 0.0), ("FollowRot", 0.0), ("Smooth", 20.0))


def track_set_values(t, vals):
    """Sets Follow X / Y / Scale / Rotation / Smooth on XfTrack and keeps them in the stored track too: an effect added
    before an option existed has no input for it (Rotation came later), the stored copy still works."""
    vals = {str(k): float(x) for k, x in (vals or {}).items() if str(k) in dict(TRACK_DEFAULTS)}
    if not vals:
        return
    for k, x in vals.items():
        try:
            t.SetInput(k, x)
        except Exception:
            pass
    try:
        raw = t.GetData(TRACK_DATA)
        d = json.loads(raw) if raw else None
        if isinstance(d, dict):
            d.setdefault("values", {}).update(vals)
            t.SetData(TRACK_DATA, json.dumps(d))
    except Exception:
        pass


def track_values(t, d):
    """The settings: the stored copy first (always written), else the input, else the default."""
    stored = (d or {}).get("values") or {}
    v = {}
    for k, dflt in TRACK_DEFAULTS:
        x = stored.get(k)
        if not isinstance(x, (int, float)) or isinstance(x, bool):
            x = get_in(t, k)
        v[k] = float(x) if isinstance(x, (int, float)) and not isinstance(x, bool) else dflt
    return v


def _smooth(vals, sigma):
    if sigma <= 0.05 or len(vals) < 3:
        return list(vals)
    import math
    r = int(math.ceil(sigma * 3))
    k = [math.exp(-(i * i) / (2 * sigma * sigma)) for i in range(-r, r + 1)]
    n = len(vals)
    out = []
    for i in range(n):
        acc = wsum = 0.0
        for j, w in enumerate(k):
            x = min(n - 1, max(0, i + j - r))      # the ends hold their value
            acc += vals[x] * w
            wsum += w
        out.append(acc / wsum)
    return out


def fx_bake_track(effect, it, force=False, check_only=False):
    """Keys XfTrack from the stored track for the clip `it`. Returns True when it (re)baked.
    Fusion Transform: out = (p - Pivot) * Size + Pivot + (Center - 0.5). A Fusion effect on a timeline clip works on
    the clip AFTER its Edit sizing (Zoom / Pan / Tilt), in timeline space (measured 2026-11-11 on a Text+ and on a
    zoomed, panned still), so the track (0..1 of the timeline picture) is used as it is: Center - 0.5 = how far the
    subject moved since the anchor frame, Pivot = the subject on the anchor frame (scale grows around it). Along an
    axis that does not follow, the pivot is the clip's own centre (0.5 + its Pan / Tilt), so scaling never shifts it."""
    d = track_read(effect)
    if not d:
        return False
    comp = effect.GetFusionComp()
    t = comp.FindTool("XfTrack") if comp is not None else None
    if t is None:
        return False
    tl = timeline()
    W = float(tl.GetSetting("timelineResolutionWidth") or 1920)
    H = float(tl.GetSetting("timelineResolutionHeight") or 1080)
    v = track_values(t, d)
    p = it.GetProperty() or {}
    def num(k, dflt):
        try:
            return float(p.get(k, dflt))
        except Exception:
            return dflt
    tx, ty = num("Pan", 0.0) / W, num("Tilt", 0.0) / H
    ca = comp.GetAttrs() or {}
    rs = int(ca.get("COMPN_RenderStart") or 0)
    start, dur = int(it.GetStart()), int(it.GetDuration())
    trk = {int(k): v_ for k, v_ in d["track"].items()}
    keys = sorted(trk)
    if not keys:
        return False
    sig = ("elsa-track3 %s n=%d k=%d-%d s=%d d=%d rs=%d t=%g,%g" %
           (" ".join("%s=%g" % (k, v[k]) for k in sorted(v)), len(keys), keys[0], keys[-1], start, dur, rs, tx, ty))
    if check_only:
        return str(get_in(t, "Comments") or "") != sig      # stale: the clip moved / was trimmed since it was keyed
    if not force and str(get_in(t, "Comments") or "") == sig:
        return False
    # one value per clip frame: frames the footage does not cover hold the nearest tracked one
    def at(f):
        f = min(keys[-1], max(keys[0], f))
        while f not in trk:
            f += 1
        return trk[f]
    rows = [at(start + i) for i in range(dur)]
    sigma = max(0.0, v["Smooth"]) / 100.0 * 6.0
    cx = _smooth([r[0] for r in rows], sigma)
    cy = _smooth([1.0 - r[1] for r in rows], sigma)      # Fusion: y up from the bottom
    # the tracker's box size is much noisier than its position, and real distance changes are slow: scale is smoothed
    # harder (at least 3 frames)
    sc = _smooth([max(1e-6, r[2] * r[3]) ** 0.5 for r in rows], max(3.0, sigma * 4.0))
    # in-picture rotation (degrees, clockwise on screen; older tracks have none): smoothed like the scale
    rot = _smooth([float(r[5]) if len(r) > 5 else 0.0 for r in rows], max(2.0, sigma * 2.0))
    i0 = min(dur - 1, max(0, int(d.get("anchor", keys[0])) - start))
    sx0, sy0, s0 = cx[i0], cy[i0], sc[i0]
    # scale pivots on the subject along the axes that follow it; along a locked axis on the clip's own centre, so
    # scaling never pushes it sideways (a caption with Follow X off stays where it is horizontally)
    px = sx0 if v["FollowX"] >= 0.5 else 0.5 + tx
    py = sy0 if v["FollowY"] >= 0.5 else 0.5 + ty
    ckx, cky, size, ang = {}, {}, {}, {}
    for i in range(dur):
        f = rs + i
        ckx[f] = {1: 0.5 + (cx[i] - sx0 if v["FollowX"] >= 0.5 else 0.0)}
        cky[f] = {1: 0.5 + (cy[i] - sy0 if v["FollowY"] >= 0.5 else 0.0)}
        size[f] = {1: min(2.0, max(0.5, sc[i] / s0)) if v["FollowScale"] >= 0.5 and s0 > 0 else 1.0}
        ang[f] = {1: -(rot[i] - rot[i0]) if v["FollowRot"] >= 0.5 else 0.0}      # Fusion Angle: counter-clockwise
    with LOCKED(comp):
        t.SetInput("Pivot", {1: px, 2: py})
        sa = _fx_modifier(t, "Angle", "BezierSpline")
        if sa is None:
            sa = comp.BezierSpline()
            t.Angle = sa
        sa.SetKeyFrames(ang, True)
        sp = _fx_modifier(t, "Size", "BezierSpline")
        if sp is None:
            sp = comp.BezierSpline()
            t.Size = sp
        sp.SetKeyFrames(size, True)
        xy = _fx_modifier(t, "Center", "XYPath")
        if xy is None:
            xy = comp.XYPath()
            t.Center = xy
        for inp, ks in (("X", ckx), ("Y", cky)):
            s_ = _fx_modifier(xy, inp, "BezierSpline")
            if s_ is None:
                s_ = comp.BezierSpline()
                setattr(xy, inp, s_)
            s_.SetKeyFrames(ks, True)
        t.SetInput("Comments", sig)
    return True


def track_summary(effect, it=None):
    """For the panel. Never writes: a tracked clip that moved or was trimmed is reported stale and re-keyed only when
    the user asks (Update) - re-keying from the background poll while Resolve played / rendered preceded a crash
    (2026-11-11, signal 11 in a Fusion task)."""
    d = track_read(effect)
    if not d:
        return {"tracked": False}
    vals = list(d["track"].values())
    stale = False
    if it is not None:
        try:
            stale = bool(fx_bake_track(effect, it, check_only=True))
        except Exception:
            stale = False
    return {"tracked": True, "frames": len(vals), "lost": sum(1 for r in vals if not r[4]), "anchor": d.get("anchor"), "stale": stale}


def op_fx_bake_track(a):
    """{item, track?: {frame: [cx, cy, w, h, ok]}, anchor?, box?, values?: {FollowX ...}}: stores a new track (when
    given) on the clip's ELSA Track Subject (added when missing), sets its settings and keys it."""
    it = find_item(str(a["item"]))
    have = fx_on_item(it)
    e = have.get("Track")
    if e is None:
        e = it.AddEffect("fusion", FX_PREFIX + FX_NAMES["Track"])
        if e is None:
            raise RuntimeError("Resolve could not add Track Subject to " + it.GetName())
        have["Track"] = e
        total = len(it.GetEffects("fusion") or [])
        mine = [k for k in FX_ORDER if k in have and not fx_is_ofx(have[k])]
        for n, k in enumerate(mine):
            try:
                have[k].SetIndex(total - len(mine) + n + 1)
            except Exception:
                pass
    elif not e.GetIsEnabled():
        e.SetIsEnabled(True)
    t = fx_param_tool(e, "Track")
    if t is None:
        raise RuntimeError("Track Subject's settings could not be opened")
    if a.get("track"):
        old = track_read(e) or {}
        t.SetData(TRACK_DATA, json.dumps({"anchor": int(a.get("anchor") or 0), "box": a.get("box"), "track": a["track"],
                                          "values": old.get("values") or {}}))
    track_set_values(t, a.get("values"))
    baked = fx_bake_track(e, it, force=True)
    return {"baked": baked, "clips": fx_state([it], fresh=True)}


def fx_get_params(effect, key):
    t = fx_param_tool(effect, key)
    if key == "Track" and t is not None:
        return track_values(t, track_read(effect))
    out = {}
    for pid in FX_PARAMS.get(key, []):
        v = get_in(t, pid) if t is not None else None
        out[pid] = float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None
    return out


def fx_get_strength(effect, key):
    t = fx_strength_tool(effect, key)
    v = get_in(t, "Strength") if t is not None else None
    return round(float(v)) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


# Glitch and Wiggle have a Hold input (frames their own clock steps by): while Stop Motion is on the clip it is set to
# Stop Motion's Frame Repeat, so with the OFX fallback (which runs before our effects) the look still moves on one beat;
# without Stop Motion it is 1 (every frame). The Fusion Stop Motion's own Hold is its Frame Repeat. The OFX's Frame
# Repeat cannot be scripted: the panel tells the user to match it in the Inspector.
FX_HOLD_DEFAULT = 2


def fx_clamp_hold(v):
    try:
        return int(max(1, min(10, round(float(v)))))
    except Exception:
        return FX_HOLD_DEFAULT


def fx_get_hold(have):
    """The Hold set on this clip's glitch / wiggle (None when neither has one)."""
    for k in ("StopMotion", "Transform", "Glitch", "Wiggle"):
        if k in have:
            t = fx_hold_tool(have[k], k)
            v = get_in(t, "Hold") if t is not None else None
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                return int(round(float(v)))
    return None


def fx_sync_hold(have, hold):
    """Sets Hold on the clip's glitch / wiggle: hold frames while Stop Motion is on and enabled, else 1."""
    sm = have.get("StopMotion")
    try:
        on = sm is not None and bool(sm.GetIsEnabled())
    except Exception:
        on = sm is not None
    n = fx_clamp_hold(hold) if on else 1
    for k in ("StopMotion", "Transform", "Glitch", "Wiggle"):
        if k in have:
            t = fx_hold_tool(have[k], k)
            if t is None:
                continue
            try:
                if get_in(t, "Hold") != n:
                    t.SetInput("Hold", n)
            except Exception:
                pass


def fx_targets(a):
    """The clips an effect request is for: the given item ids, else the clips selected on the timeline (video
    track items only). No selection = no clips (the clip under the playhead was often an overlay, not the one meant)."""
    tl = timeline()
    ids = [str(i) for i in (a.get("items") or []) if i]
    if ids:
        return [find_item(i) for i in ids]
    out = []
    for it in tl.GetSelectedClips() or []:
        try:
            tt = it.GetTrackTypeAndIndex() if hasattr(it, "GetTrackTypeAndIndex") else None
            if tt and tt[0] != "video":
                continue
        except Exception:
            pass
        out.append(it)
    return out


def fx_nudge_inspector():
    """Resolve's Inspector keeps showing an effect removed by a script until something redraws it: the playhead
    steps one frame and back (cheap, and the user's position is kept)."""
    try:
        tl = timeline()
        tc = tl.GetCurrentTimecode()
        sep = ";" if ";" in tc else ":"
        parts = [int(x) for x in tc.replace(";", ":").split(":")]
        fps = int(round(float(tl.GetSetting("timelineFrameRate") or 25)))
        total = ((parts[0] * 60 + parts[1]) * 60 + parts[2]) * fps + parts[3] + 1
        f = total % fps
        sec = total // fps
        nxt = "%02d:%02d:%02d%s%02d" % (sec // 3600, (sec // 60) % 60, sec % 60, sep, f)
        tl.SetCurrentTimecode(nxt)
        tl.SetCurrentTimecode(tc)
    except Exception:
        pass


# An effect can also be dragged by hand into a clip's own node graph (Fusion page > Effects > Templates > Edit > Effects >
# Subtitle Animator), where the panel does not manage it. Adding the same effect from the panel on top would run it twice,
# so fx_set skips a clip whose own comp already holds that effect's node, and fx_state reports it (inNodes).
# Matched by node name: the macro's group (ELSAWiggle, ELSAWiggle1 ...) or its main tool. Names only (GetToolList +
# GetAttrs, as the other bridge reads do), never input values, and cached FX_NODES_TTL per clip.
FX_NODE_NAMES = {"Transform": ("ELSATransform", "XfMove"), "Track": ("ELSATrack", "XfTrack"), "Glitch": ("ELSAGlitch", "GlitchOut"),
                 "Wiggle": ("ELSAWiggle", "WiggleDisplace"), "StopMotion": ("ELSAStopMotion", "StopMotionTime")}
FX_NODES_TTL = 10.0
_fx_nodes = {}


def _fx_node_key(name):
    base = name.rstrip("0123456789") if name else ""
    for k, names in FX_NODE_NAMES.items():
        if base in names:
            return k
    return None


def fx_in_nodes(it, fresh=False):
    """The effect ids found as nodes in the clip's own Fusion comps (not its Edit-page effects)."""
    try:
        iid = str(it.GetUniqueId())
    except Exception:
        return set()
    hit = _fx_nodes.get(iid)
    if hit is not None and not fresh and time.time() - hit[0] < FX_NODES_TTL:
        return hit[1]
    found = set()
    try:
        names = it.GetFusionCompNameList() or []
        names = list(names.values()) if isinstance(names, dict) else list(names)
        for n in names:
            comp = it.GetFusionCompByName(n)
            if comp is None:
                continue
            for tool in tool_list(comp):
                try:
                    k = _fx_node_key(str(attrs(tool).get("TOOLS_Name") or ""))
                except Exception:
                    k = None
                if k:
                    found.add(k)
    except Exception:
        pass
    _fx_nodes[iid] = (time.time(), found)
    if len(_fx_nodes) > 300:
        _fx_nodes.pop(next(iter(_fx_nodes)))
    return found


def fx_on_item(it):
    """{effect id: Effect} of our effects on a clip."""
    have = {}
    for cat in ("fusion", "ofx"):
        names = FX_OFX_NAMES if cat == "ofx" else FX_NAMES
        for e in it.GetEffects(cat) or []:
            info = e.GetInfo() or {}
            for k, n in names.items():
                if info.get("name") == n:
                    have[k] = e
    return have


def fx_clip_frames(it):
    """The clip's length in frames (the panel's Transform End frame shows its last index)."""
    try:
        return int(it.GetDuration())
    except Exception:
        return None


def fx_clip_start(it):
    """The clip's first timeline frame (the panel puts the playhead on the Transform Start / End bar with it)."""
    try:
        return int(it.GetStart())
    except Exception:
        return None


# fx_get runs every 0.7-1.5 s while the Use tab shows. Its reads that rarely change (Strength / Frame Repeat / Glitch and
# Transform settings: ~25 GetInputs per clip, and the Transform bake check) are reused per clip for FX_READ_TTL /
# FX_BAKE_TTL while the clip's effects, start and length stay the same. The write ops pass fresh=True (read now).
FX_READ_TTL = 3.0
FX_BAKE_TTL = 10.0
_fx_reads = {}      # clip id -> (time, key, {strength, params})
_fx_bakes = {}      # clip id -> (time, start / length)


def fx_state(items, fresh=False):
    out = []
    now = time.time()
    for it in items:
        have = fx_on_item(it)
        iid = str(it.GetUniqueId())
        frames, start = fx_clip_frames(it), fx_clip_start(it)
        enabled = {k: bool(e.GetIsEnabled()) for k, e in have.items()}
        tr = have.get("Transform")
        if tr is not None and not fx_is_ofx(tr):
            b = _fx_bakes.get(iid)
            if fresh or b is None or b[1] != (start, frames) or now - b[0] > FX_BAKE_TTL:
                fx_bake_transform(tr)      # no-op while its signature still matches
                _fx_bakes[iid] = (now, (start, frames))
        key = repr(sorted(enabled.items()))
        r = _fx_reads.get(iid)
        if fresh or r is None or r[1] != key or now - r[0] > FX_READ_TTL:
            hold = fx_get_hold(have) if "StopMotion" in have else None
            vals = {"strength": dict([(k, fx_get_strength(e, k)) for k, e in have.items() if k in FX_STRENGTH_TOOL] +
                                     ([("StopMotion", hold)] if hold else [])),
                    "params": {k: fx_get_params(e, k) for k, e in have.items() if k in FX_PARAMS},
                    "track": track_summary(have["Track"], it) if "Track" in have else None}
            _fx_reads[iid] = (now, key, vals)
        else:
            vals = r[2]
        for cache in (_fx_reads, _fx_bakes):
            if len(cache) > 300:
                cache.pop(next(iter(cache)))
        out.append({"id": iid, "name": it.GetName(), "effects": enabled,
                    "strength": vals["strength"], "params": vals["params"], "track": vals.get("track"),
                    "frames": frames, "start": start,
                    "inNodes": sorted(fx_in_nodes(it)),
                    "stopMotionKind": ("ofx" if fx_is_ofx(have["StopMotion"]) else "fusion") if "StopMotion" in have else None})
    return out


def op_fx_get(a):
    """{items?} -> {clips: [{id, name, effects: {Glitch: enabled, ...}}]} for the selected (or given) clips."""
    return {"clips": fx_state(fx_targets(a))}


def op_fx_strength(a):
    """{effect, value 0..100, items?}: sets that effect's Strength on the selected (or given) clips that have it."""
    key = str(a.get("effect") or "")
    if key not in FX_NAMES:
        raise RuntimeError("Unknown effect " + key)
    v = max(0.0, min(100.0, float(a.get("value"))))
    items = fx_targets(a)
    done = 0
    if key == "StopMotion":      # its "strength" is the Frame Repeat our glitch / wiggle hold for
        for it in items:
            have = fx_on_item(it)
            if "StopMotion" in have:
                fx_sync_hold(have, v)
                done += 1
        return {"set": done, "clips": fx_state(items, fresh=True)}
    for it in items:
        e = fx_on_item(it).get(key)
        t = fx_strength_tool(e, key) if e is not None else None
        if t is None:
            continue
        try:
            t.SetInput("Strength", v)
            done += 1
        except Exception:
            pass
    return {"set": done, "clips": fx_state(items, fresh=True)}


def op_fx_param(a):
    """{effect, values: {Strength / BlinkIn / ColorARed / Opacity ...: number}, items?}: sets those settings of one
    effect on the selected (or given) clips that have it."""
    key = str(a.get("effect") or "")
    if key not in FX_NAMES:
        raise RuntimeError("Unknown effect " + key)
    allowed = set(["Strength"] + FX_PARAMS.get(key, []))
    vals = {str(k): float(v) for k, v in (a.get("values") or {}).items() if str(k) in allowed}
    items = fx_targets(a)
    done = 0
    for it in items:
        e = fx_on_item(it).get(key)
        if e is None:
            continue
        ts, tp = fx_strength_tool(e, key), fx_param_tool(e, key)
        if ts is None and tp is None:
            continue
        for k, v in vals.items():
            t = ts if k == "Strength" else tp
            try:
                if t is not None:
                    t.SetInput(k, v)
            except Exception:
                pass
        if key == "Track":
            try:
                if tp is not None:
                    track_set_values(tp, vals)
                fx_bake_track(e, it, force=True)
            except Exception:
                pass
        done += 1
    return {"set": done, "clips": fx_state(items, fresh=True)}


def op_fx_set(a):
    """{effect, on (true / false / null = flip, judged on the first clip), items?}: adds or removes one effect preset
    on the selected (or given) clips, keeping our effects in FX_ORDER after any of the clip's other effects."""
    key = str(a.get("effect") or "")
    if key not in FX_NAMES:
        raise RuntimeError("Unknown effect " + key)
    items = fx_targets(a)
    if not items:
        raise RuntimeError("Select a clip on the timeline first")
    on = a.get("on")
    if on is None:
        on = key not in fx_on_item(items[0])
    failed = []
    in_nodes = []      # clips that already have this effect as a node in their own graph: not added a second time
    removed = False
    hold_in = a.get("hold")
    if hold_in is None and key == "StopMotion":
        hold_in = a.get("strength")
    for it in items:
        have = fx_on_item(it)
        hold = hold_in if hold_in is not None else (fx_get_hold(have) or FX_HOLD_DEFAULT)
        if hold is not None and fx_clamp_hold(hold) <= 1 and hold_in is None:
            hold = FX_HOLD_DEFAULT
        if on:
            e = have.get(key)
            if e is None and key in fx_in_nodes(it, fresh=True):
                in_nodes.append(it.GetName())
                continue
            if e is None:
                if key in FX_OFX and fx_clip_is_sized(it):
                    e = it.AddEffect("ofx", FX_OFX[key])
                else:
                    e = it.AddEffect("fusion", FX_PREFIX + FX_NAMES[key])
                if e is None:
                    failed.append(it.GetName())
                    continue
                have[key] = e
                init = dict((a.get("params") or {}))
                if init:
                    t = fx_param_tool(e, key)
                    for pk, pv in init.items():
                        if t is not None and pk in FX_PARAMS.get(key, []):
                            try:
                                t.SetInput(str(pk), float(pv))
                            except Exception:
                                pass
                if a.get("strength") is not None and key in FX_STRENGTH_TOOL:
                    t = fx_strength_tool(e, key)
                    if t is not None:
                        try:
                            t.SetInput("Strength", max(0.0, min(100.0, float(a.get("strength")))))
                        except Exception:
                            pass
            elif not e.GetIsEnabled():
                e.SetIsEnabled(True)
            # stacking order: ours go last, glitch -> wiggle -> stop motion (stop motion holds the finished look)
            total = len(it.GetEffects("fusion") or [])
            mine = [k for k in FX_ORDER if k in have and not fx_is_ofx(have[k])]
            for n, k in enumerate(mine):
                try:
                    have[k].SetIndex(total - len(mine) + n + 1)
                except Exception:
                    pass
        elif key in have:
            if not it.DeleteEffects([have[key]]):
                failed.append(it.GetName())
            else:
                removed = True
                del have[key]
        fx_sync_hold(have, hold)
    if removed:
        fx_nudge_inspector()
    return {"on": bool(on), "failed": failed, "inNodes": in_nodes, "clips": fx_state(items, fresh=True)}


# ---------------------------------------------------------------- Glass Blur (frosted glass behind a caption's pill)
# A title cannot see the clips under it, so the "Glass Blur (ML)" preset's frost lives in an "ELSA Glass" Fusion effect
# (src/main/effect-presets.js glass()) on the footage clip(s) under the caption. glass_sync copies the caption's pill
# into it: the emphasis text (the follower's own Text input, never the follower-driven Text+), font / size from the
# Template, the row centre computed from the Template's plain Row controls (the same formula as the preset's
# Text2.Center expression, which is not evaluated here), Box sliders, Emphasis timing and the clip's Edit transform.
# Each effect is tagged with its caption's id (GlassShape data GLASS_FOR); glass.json remembers which clips carry
# effects for which caption, so a deleted caption's glass is removed (glass_gc) and a moved one is cleaned up.
GLASS_NAME = "ELSA Glass"
GLASS_FOR = "ElsaGlassFor"
GLASS_STATE = "ElsaGlassState"
_glass_kind = {}      # caption id -> True (glass preset) / False
_glass_seen = {}      # caption id -> time of the last check from seg_watch


def glass_reg_path():
    if sys.platform == "darwin":
        d = os.path.expanduser("~/Library/Application Support/el-subtitle-animator")
    else:
        d = os.path.expanduser("~/.el-subtitle-animator")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "glass.json")


def glass_reg_load():
    try:
        with open(glass_reg_path(), encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def glass_reg_save(d):
    try:
        p = glass_reg_path()
        with open(p + ".tmp", "w", encoding="utf-8") as f:
            json.dump(d, f)
        os.replace(p + ".tmp", p)
    except Exception:
        pass


def glass_tl_key(tl):
    try:
        proj = resolve().GetProjectManager().GetCurrentProject().GetName()
    except Exception:
        proj = ""
    return "%s / %s" % (proj, tl.GetName())


def glass_tpl(comp):
    t = comp.FindTool("Template")
    if t is not None and get_in(t, "GlassFrost") is not None:
        return t
    return None


def _text_w(s):
    """The preset's Text2.Center width estimate (Justify left / right), per Size unit."""
    best = 0.0
    for line in str(s or "").split("\n"):
        w = 0.0
        for ch in line:
            if ch == " ":
                w += 0.09
            elif ch in "ijl!|'.,:;":
                w += 0.1
            elif ch in "tfr":
                w += 0.14
            elif ch in "IJ":
                w += 0.13
            elif ch in "mw":
                w += 0.33
            elif ch in "MW":
                w += 0.31
            elif ch.isupper():
                w += 0.24
            elif ch.isdigit():
                w += 0.21
            elif ch in "sczvxykg":
                w += 0.19
            elif ch in "-?":
                w += 0.15
            else:
                w += 0.21
        best = max(best, w)
    return best


def glass_values(it, comp, tpl, tl):
    T = lambda k, d: num(get_in(tpl, k), d)
    texts = {n: (row_text(tpl, n) or "") for n in (1, 2, 3)}
    J = int(T("RowsJustify", 0))
    lk = T("RowsLink", 0) >= 0.5
    if lk:
        ox = T("UpperX", 0) + T("EmphasisX", 0) + T("LowerX", 0)
        oy = T("UpperY", 0) + T("EmphasisY", 0) + T("LowerY", 0)
    else:
        ox, oy = T("EmphasisX", 0), T("EmphasisY", 0)
    if J >= 1:
        ox = 0.0
    sizes = {1: T("Text1.Size", 0.065), 2: T("Text2.Size", 0.115), 3: T("Text3.Size", 0.065)}
    try:
        fw = float(comp.GetPrefs("Comp.FrameFormat.Width"))
        fh = float(comp.GetPrefs("Comp.FrameFormat.Height"))
    except Exception:
        fw, fh = T("Width", 1080), T("Height", 1920)
    x = T("RowsBaseX", 0.5) + T("RowsX", 0) + ox
    if J >= 2:
        wm = max(_text_w(texts[n]) * sizes[n] for n in (1, 2, 3)) * fh / max(1.0, fw)
        x += (-1 if J == 2 else 1) * wm / 2
    y = T("RowsBaseY", 0.47) + T("RowsY", 0) + oy
    s2 = T("Seg2Start", 0)
    e2 = T("Seg2End", s2)
    d2 = max(1.0, (e2 - s2) * 0.55)
    r2 = max(2.0, min(9.0, d2 * 0.5))
    dur = max(4.0, min(12.0, max(1.0, e2 - (s2 + r2))))
    p = it.GetProperty() or {}
    pn = lambda k, d: num(p.get(k), d)
    try:
        W = float(tl.GetSetting("timelineResolutionWidth"))
        H = float(tl.GetSetting("timelineResolutionHeight"))
    except Exception:
        W, H = fw, fh
    zoom = pn("ZoomX", 1.0)
    halign = -1 if J == 2 else (1 if J == 3 else 0)
    return {
        "text": texts[2], "font": get_in(tpl, "Text2.Font") or "Poppins", "style": get_in(tpl, "Text2.Style") or "Bold",
        "size": sizes[2], "cs": T("Text2.CharacterSpacing", 1), "ls": T("Text2.LineSpacing", 1),
        "center": [round(x, 5), round(y, 5)], "halign": halign,
        "box": [T("HighlightWidth", 1), T("HighlightHeight", 1), T("HighlightX", 0), T("HighlightY", 0)],
        "s2": s2, "dur": dur, "len": int(it.GetDuration()), "start": int(it.GetStart()),
        "glass": [T("GlassFrost", 22), T("GlassBend", 0.06), T("GlassVibrancy", 1.3), T("GlassBright", 0.05)],
        "xf": [0.5 + pn("Pan", 0) / max(1.0, W), 0.5 + pn("Tilt", 0) / max(1.0, H), zoom, pn("RotationAngle", 0)],
        "lens": [0.5 + (x - 0.5) * zoom + pn("Pan", 0) / max(1.0, W), 0.5 + (y - 0.5) * zoom + pn("Tilt", 0) / max(1.0, H)],
    }


def glass_under(tl, it):
    """[(clip, id)] of the footage the caption covers: for every frame of the caption, the topmost enabled media clip
    on a lower track (a cut under the caption gives two clips)."""
    try:
        tidx = int(it.GetTrackTypeAndIndex()[1])
    except Exception:
        return []
    left = [(int(it.GetStart()), int(it.GetEnd()))]
    out = []
    for t in range(tidx - 1, 0, -1):
        if not left:
            break
        try:
            if not tl.GetIsTrackEnabled("video", t):
                continue
        except Exception:
            pass
        for v in tl.GetItemListInTrack("video", t) or []:
            try:
                s, e = int(v.GetStart()), int(v.GetEnd())
                if v.GetMediaPoolItem() is None:
                    continue
                if hasattr(v, "GetClipEnabled") and not v.GetClipEnabled():
                    continue
            except Exception:
                continue
            nxt, hit = [], False
            for a0, a1 in left:
                if e <= a0 or s >= a1:
                    nxt.append((a0, a1))
                    continue
                hit = True
                if a0 < s:
                    nxt.append((a0, s))
                if e < a1:
                    nxt.append((e, a1))
            if hit:
                out.append((v, str(v.GetUniqueId())))
            left = nxt
    return out


def glass_find(v, tid):
    for e in v.GetEffects("fusion") or []:
        try:
            if (e.GetInfo() or {}).get("name") != GLASS_NAME:
                continue
            c = e.GetFusionComp()
            sh = c.FindTool("GlassShape") if c is not None else None
            if sh is not None and sh.GetData(GLASS_FOR) == tid:
                return e
        except Exception:
            continue
    return None


def glass_write(e, tid, g, lead):
    c = e.GetFusionComp()
    sh, xf, disp = c.FindTool("GlassShape"), c.FindTool("GlassXf"), c.FindTool("GlassDisplace")
    if sh is None:
        raise RuntimeError("ELSA Glass has no GlassShape")
    c.Lock()
    try:
        vals = {"Lead": lead, "S2": g["s2"], "Dur": g["dur"], "Len": g["len"],
                "BoxW": g["box"][0], "BoxH": g["box"][1],
                "Frost": g["glass"][0], "Bend": g["glass"][1], "Vib": g["glass"][2], "Bright": g["glass"][3],
                "StyledText": g["text"], "Font": g["font"], "Style": g["style"], "Size": g["size"],
                "CharacterSpacing": g["cs"], "LineSpacing": g["ls"],
                "HorizontalLeftCenterRight": g["halign"], "HorizontalJustificationCenter": g["halign"]}
        for k, v in vals.items():
            sh.SetInput(k, v)
        sh.SetInput("Center", {1: g["center"][0], 2: g["center"][1], 3: 0.0})
        sh.SetInput("Offset1", {1: g["box"][2], 2: g["box"][3], 3: 0.0})
        sh.SetData(GLASS_FOR, tid)
        if xf is not None:
            xf.SetInput("Center", {1: g["xf"][0], 2: g["xf"][1], 3: 0.0})
            xf.SetInput("Size", g["xf"][2])
            xf.SetInput("Angle", g["xf"][3])
        if disp is not None:
            disp.SetInput("Center", {1: g["lens"][0], 2: g["lens"][1], 3: 0.0})
    finally:
        c.Unlock()


def glass_items_by_id(tl, ids):
    want, out = set(ids), {}
    for t in range(1, tl.GetTrackCount("video") + 1):
        for v in tl.GetItemListInTrack("video", t) or []:
            try:
                uid = str(v.GetUniqueId())
            except Exception:
                continue
            if uid in want:
                out[uid] = v
    return out


def glass_drop(tl, tid, clip_ids):
    n = 0
    for v in glass_items_by_id(tl, clip_ids).values():
        e = glass_find(v, tid)
        if e is not None and v.DeleteEffects([e]):
            n += 1
    return n


def glass_sync(item_id, force=False):
    """Adds / updates / removes the ELSA Glass effects for one Glass Blur caption. Writes only when something the
    glass depends on changed since the last sync (state kept on the caption's Template). None = not a glass caption."""
    tid = str(item_id)
    it = find_item(tid)
    comp = get_comp(tid)
    tpl = glass_tpl(comp)
    _glass_kind[tid] = tpl is not None
    if tpl is None:
        return None
    tl = timeline()
    g = glass_values(it, comp, tpl, tl)
    under = glass_under(tl, it) if g["text"].strip() else []
    state = json.dumps([g, [(uid, int(v.GetStart())) for v, uid in under]], sort_keys=True)
    try:
        last = tpl.GetData(GLASS_STATE)
    except Exception:
        last = None
    if not force and last == state:
        return {"glass": "unchanged", "clips": len(under)}
    reg = glass_reg_load()
    key = glass_tl_key(tl)
    prev = list((reg.get(key) or {}).get(tid) or [])
    from_fx = FX_PREFIX + GLASS_NAME
    done, failed = [], []
    for v, uid in under:
        e = glass_find(v, tid)
        if e is None:
            e = v.AddEffect("fusion", from_fx)
            if e is None:
                failed.append(v.GetName())
                continue
        try:
            glass_write(e, tid, g, g["start"] - int(v.GetStart()))
            done.append(uid)
        except Exception as ex:
            failed.append("%s (%s)" % (v.GetName(), ex))
    gone = [c for c in prev if c not in done]
    removed = glass_drop(tl, tid, gone) if gone else 0
    reg.setdefault(key, {})
    if done:
        reg[key][tid] = done
    else:
        reg[key].pop(tid, None)
    glass_reg_save(reg)
    try:
        tpl.SetData(GLASS_STATE, state if not failed else None)
    except Exception:
        pass
    return {"glass": "synced", "clips": len(done), "removed": removed, "failed": failed}


def glass_after(a):
    """After a panel edit of a caption (text, rows, box, timing, Clip controls): resync its glass. Never raises."""
    try:
        if a.get("item") is not None and _glass_kind.get(str(a["item"])) is not False:
            glass_sync(a["item"])
    except Exception:
        pass


def op_glass_sync(a):
    return glass_sync(a["item"], bool(a.get("force"))) or {"glass": None}


def op_glass_remove(a):
    """Removes a caption's glass effects (before the caption is deleted, or for a caption already gone)."""
    tid = str(a["item"])
    tl = timeline()
    reg = glass_reg_load()
    key = glass_tl_key(tl)
    ids = list((reg.get(key) or {}).pop(tid, None) or [])
    n = glass_drop(tl, tid, ids) if ids else 0
    glass_reg_save(reg)
    return {"removed": n}


def op_glass_gc(a):
    """Removes the glass of captions no longer on the current timeline (deleted by hand)."""
    tl = timeline()
    reg = glass_reg_load()
    key = glass_tl_key(tl)
    ent = reg.get(key) or {}
    if not ent:
        return {"removed": 0, "captions": 0}
    present = glass_items_by_id(tl, list(ent.keys()))
    n = 0
    for tid in [t for t in ent if t not in present]:
        n += glass_drop(tl, tid, ent.pop(tid))
    glass_reg_save(reg)
    return {"removed": n, "captions": len(ent)}


OPS = {"glass_sync": op_glass_sync, "glass_remove": op_glass_remove, "glass_gc": op_glass_gc, "highlight_box": op_highlight_box, "multitext_rows": op_multitext_rows, "row_times": op_row_times, "set_output": op_set_output, "preview_bg": op_preview_bg, "scan": op_scan, "set_boxes": op_set_boxes, "capture": op_capture, "live_frame": op_live_frame, "link_clips": op_link_clips, "refresh": op_refresh, "ping": op_ping, "fonts": op_fonts, "config": op_config, "set_text": op_set_text, "set_audio_volume": op_set_audio_volume,
       "timing_get": op_timing_get, "timing_set": op_timing_set, "tools": op_tools, "copy_inputs": op_copy_inputs, "key_followers": op_key_followers, "seg_watch": op_seg_watch, "seg_sweep": op_seg_sweep, "controls_get": op_controls_get, "controls_set": op_controls_set, "gradient_set": op_gradient_set, "mt_rows_get": op_mt_rows_get, "mt_rows_set": op_mt_rows_set, "probe_render": op_probe_render, "read_style": op_read_style, "fx_get": op_fx_get, "fx_set": op_fx_set, "fx_strength": op_fx_strength, "fx_param": op_fx_param, "track_source": op_track_source, "track_frames": op_track_frames, "fx_bake_track": op_fx_bake_track}


# Operations run a second time when the first attempt fails quickly (a stale handle, Resolve mid-update). Not the
# renders (they already took their time, the panel retries itself), not the watchers (the next tick comes anyway), and
# never once a wake has run (a second attempt would wake - re-render - the whole comp again).
NO_RETRY = {"track_frames", "capture", "live_frame", "probe_render", "seg_watch", "seg_sweep", "ping", "config", "fonts"}


def handle(req):
    import time
    fn = OPS.get(req.get("op"))
    if not fn:
        return {"id": req.get("id"), "ok": False, "error": "Unknown operation"}
    op = req.get("op")
    t_start = time.perf_counter()
    for k in COUNTERS:
        COUNTERS[k] = 0
    STEPS.clear()
    WAKE_RAN[0] = False
    out = None
    attempts = (2,) if op in NO_RETRY else (1, 2)
    for attempt in attempts:
        req_cache_clear()
        t0 = time.perf_counter()
        try:
            out = {"id": req.get("id"), "ok": True, "result": fn(req.get("args") or {})}
            break
        except Cancelled:
            out = {"id": req.get("id"), "ok": False, "error": "cancelled"}
            break
        except Exception as e:
            # only what this request touched can be stale: its item and comps, not every handle the helper knows
            item = (req.get("args") or {}).get("item") if isinstance(req.get("args"), dict) else None
            if item is not None:
                _items.pop(str(item), None)
                for k in [k for k in _comps if k[0] == str(item)]:
                    _comps.pop(k, None)
                _seg_seen.pop(str(item), None)
                comp_attrs_forget(item)
            else:
                _items.clear()
                _comps.clear()
                comp_attrs_forget()
            slow = (time.perf_counter() - t0) > 2.0
            if attempt == 2 or slow or WAKE_RAN[0]:
                out = {"id": req.get("id"), "ok": False, "error": str(e) or e.__class__.__name__,
                       "trace": traceback.format_exc()[-600:]}
                break
    req_cache_clear()
    out["perf"] = {"ms": round((time.perf_counter() - t_start) * 1000.0, 2), "counters": {k: v for k, v in COUNTERS.items() if v},
                   "steps": {k: round(v, 1) for k, v in STEPS.items()}}
    return out


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            if not isinstance(req, dict):
                continue
        except Exception:
            continue
        try:
            out = handle(req)
        except BaseException as e:  # never let one bad request end the helper
            if isinstance(e, (KeyboardInterrupt, SystemExit)):
                raise
            out = {"id": req.get("id") if isinstance(req, dict) else None, "ok": False, "error": str(e) or e.__class__.__name__}
        try:
            sys.stdout.write(json.dumps(out, default=str) + "\n")
            sys.stdout.flush()
        except (BrokenPipeError, OSError):
            break   # the panel is gone


if __name__ == "__main__":
    main()
