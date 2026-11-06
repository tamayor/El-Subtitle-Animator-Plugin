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
import traceback

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
_items = {}   # item id -> TimelineItem
_comps = {}   # (item id, comp name) -> comp


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
    return comp


def tool_list(comp):
    tools = comp.GetToolList(False) or {}
    return list(tools.values()) if isinstance(tools, dict) else list(tools)


def as_list(x):
    if not x:
        return []
    return list(x.values()) if isinstance(x, dict) else list(x)


def attrs(obj):
    return obj.GetAttrs() or {}


# ---------------------------------------------------------------- operations
def op_ping(a):
    resolve()
    return True


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
                tool.SetInput("ShadingGradient%d" % idx, {0.0: c1 + [1.0], 1.0: c2 + [1.0]})
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


def wake_followers(comp):
    """A comp loaded with ImportFusionComp does not apply a Text+ Follower's shading-element overrides
    (for example an animated opacity that reveals the words) until those elements are switched.
    Switching every enabled element off and on again makes Fusion render the comp exactly as it was built."""
    try:
        tools = as_list(comp.GetToolList(False))
    except Exception:
        return
    for mod in tools:
        try:
            if attrs(mod).get("TOOLS_RegID") not in FOLLOWERS:
                continue
            for i in range(1, 9):
                key = "Enabled%d" % i
                if mod.GetInput(key) == 1:
                    mod.SetInput(key, 0)
                    mod.SetInput(key, 1)
        except Exception:
            pass


def op_set_text(a):
    comp = get_comp(a["item"], a.get("comp"))
    found = False
    all_tools = tool_list(comp)
    has_follower = False
    if a.get("text") is not None:
        for mod in all_tools:
            if attrs(mod).get("TOOLS_RegID") in ("StyledTextFollower", "Follower"):
                try:
                    mod.SetInput("Text", a["text"])
                    has_follower = True
                except Exception:
                    pass
    for tool in tool_list(comp):
        if attrs(tool).get("TOOLS_RegID") == "TextPlus":
            if a.get("text") is not None and not has_follower:
                tool.SetInput("StyledText", a["text"])
            if a.get("textDesign"):
                apply_text_design(tool, a["textDesign"])
            found = True
            break
    wake_followers(comp)
    return found


# ---------------------------------------------------------------- text boxes (Text+ / template nodes)
FOLLOWERS = ("StyledTextFollower", "Follower")


def get_in(tool, name):
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


def describe(tool):
    at = attrs(tool)
    rid = at.get("TOOLS_RegID")
    name = at.get("TOOLS_Name")
    if rid == "TextPlus":
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
                layers = sorted(set(int(float(v)) for v in order.values()))
        except Exception:
            layers = []
        if not layers:
            layers = [n for n in range(1, 17) if isinstance(get_in(tool, "Text%d.StyledText" % n), str)]
        for n in layers:
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
                    txt = get_in(tool, iid)
                    out.append({"id": "%s/%s" % (name, iid), "kind": "template", "tool": name, "input": iid,
                                "label": "Template · %s" % (ia.get("INPS_Name") or name),
                                "text": txt if isinstance(txt, str) else ""})
        except Exception:
            pass
    return out


def op_scan(a):
    """What Fusion really has in this clip's composition: every Text+ and every template with a text input."""
    comp = get_comp(a["item"], a.get("comp"))
    nodes = []
    for tool in tool_list(comp):
        nodes.extend(describe(tool))
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


def op_set_boxes(a):
    """Put text / position / size into each detected Text+ or template, one by one."""
    comp = get_comp(a["item"], a.get("comp"))
    all_tools = tool_list(comp)
    missing, fixed, design_done, first_text = [], [], False, True
    for b in a.get("boxes") or []:
        name = b.get("tool")
        tool = comp.FindTool(name) if name else None
        if tool is None:
            missing.append(b.get("label") or name or "?")
            continue
        if b.get("text") is not None:
            try:
                if b.get("kind") == "multitext":
                    tool.SetInput(b.get("input"), str(b["text"]))     # a MultiText layer: Text<n>.StyledText
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
    wake_followers(comp)
    return {"missing": missing, "fixedPosition": fixed, "nodes": op_scan(a)["nodes"]}


def find_any_item(item_id, kind="video"):
    tl = timeline()
    for t in range(1, tl.GetTrackCount(kind) + 1):
        for it in tl.GetItemListInTrack(kind, t) or []:
            if str(it.GetUniqueId()) == str(item_id):
                return it
    return None


def op_refresh(a):
    """Re-writes each text input with its own value. Right after a comp is imported, Resolve sometimes renders a
    Follower-driven Text+ as empty (black) until the text is touched again; doing it once everything is placed
    makes the clip show exactly what the comp was built to show."""
    comp = get_comp(a["item"], a.get("comp"))
    touched = 0
    tools = as_list(comp.GetToolList(False))
    has_follower = False
    for mod in tools:
        try:
            if attrs(mod).get("TOOLS_RegID") in FOLLOWERS:
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
                if attrs(tool).get("TOOLS_RegID") == "TextPlus":
                    inp = tool.StyledText
                    if inp is not None and not inp.GetConnectedOutput():
                        txt = tool.GetInput("StyledText")
                        if txt is not None:
                            tool.SetInput("StyledText", txt)
                            touched += 1
            except Exception:
                pass
    return {"touched": touched}


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


OPS = {"preview_bg": op_preview_bg, "scan": op_scan, "set_boxes": op_set_boxes, "capture": op_capture, "live_frame": op_live_frame, "link_clips": op_link_clips, "refresh": op_refresh, "ping": op_ping, "set_text": op_set_text, "set_audio_volume": op_set_audio_volume}


def handle(req):
    fn = OPS.get(req.get("op"))
    if not fn:
        return {"id": req.get("id"), "ok": False, "error": "Unknown operation"}
    for attempt in (1, 2):
        try:
            return {"id": req.get("id"), "ok": True, "result": fn(req.get("args") or {})}
        except Cancelled:
            return {"id": req.get("id"), "ok": False, "error": "cancelled"}
        except Exception as e:
            _items.clear()
            _comps.clear()
            if attempt == 2:
                return {"id": req.get("id"), "ok": False, "error": str(e) or e.__class__.__name__,
                        "trace": traceback.format_exc()[-600:]}


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
