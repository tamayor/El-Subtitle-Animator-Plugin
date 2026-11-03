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
                return item
        except Exception:
            pass
        _items.pop(item_id, None)
    tl = timeline()
    for t in range(1, tl.GetTrackCount("video") + 1):
        for it in tl.GetItemListInTrack("video", t) or []:
            if str(it.GetUniqueId()) == str(item_id):
                _items[item_id] = it
                return it
    raise RuntimeError("That clip is not on the timeline any more. Select it again.")


def get_comp(item_id, comp_name):
    key = (item_id, comp_name)
    comp = _comps.get(key)
    if comp is not None:
        return comp
    item = find_item(item_id)
    comp = item.GetFusionCompByName(comp_name) if comp_name else None
    if comp is None:
        count = item.GetFusionCompCount() or 0
        comp = item.GetFusionCompByIndex(count) if count else None
    if comp is None:
        raise RuntimeError("Could not open that clip's composition")
    _comps[key] = comp
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
    if not td or not isinstance(td, dict):
        return
    apply_layout(tool, td.get("layout"))
    try:
        if td.get("font"):
            tool.SetInput("Font", str(td["font"]))
        if td.get("style"):
            tool.SetInput("Style", str(td["style"]))
        if td.get("size") is not None:
            tool.SetInput("Size", float(td["size"]))
        if td.get("tracking") is not None:
            tool.SetInput("CharacterSpacing", float(td["tracking"]))
        if td.get("lineSpacing") is not None:
            tool.SetInput("LineSpacing", float(td["lineSpacing"]))
    except Exception:
        pass

    elements = td.get("elements")
    if isinstance(elements, list):
        for el in elements:
            if not isinstance(el, dict):
                continue
            idx = int(el.get("index") or 0)
            if idx < 1 or idx > 8:
                continue
            en = 1 if el.get("enabled") else 0
            try:
                if en or el.get("modified"):
                    tool.SetInput("SelectElement", idx)
                    tool.SetInput("Enabled%d" % idx, 1)
                    if el.get("name"):
                        tool.SetInput("Name%d" % idx, str(el["name"]))
                    if el.get("opacity") is not None:
                        tool.SetInput("Opacity%d" % idx, float(el["opacity"]))
                    if el.get("type") is not None:
                        tool.SetInput("Type%d" % idx, int(el["type"]))
                    if el.get("shape") is not None:
                        tool.SetInput("ElementShape%d" % idx, int(el["shape"]))
                    if el.get("thickness") is not None:
                        tool.SetInput("Thickness%d" % idx, float(el["thickness"]))
                    if el.get("level") is not None:
                        tool.SetInput("Level%d" % idx, int(el["level"]))
                    if el.get("extendH") is not None:
                        tool.SetInput("ExtendHorizontal%d" % idx, float(el["extendH"]))
                    if el.get("extendV") is not None:
                        tool.SetInput("ExtendVertical%d" % idx, float(el["extendV"]))
                    if el.get("round") is not None:
                        tool.SetInput("Round%d" % idx, float(el["round"]))
                    if el.get("color"):
                        r, g, b = hex_to_rgb(el["color"])
                        tool.SetInput("Red%d" % idx, r)
                        tool.SetInput("Green%d" % idx, g)
                        tool.SetInput("Blue%d" % idx, b)
                    if el.get("softness") is not None:
                        soft = float(el["softness"])
                        tool.SetInput("SoftnessX%d" % idx, soft)
                        tool.SetInput("SoftnessY%d" % idx, soft)
                    if el.get("offsetX") is not None or el.get("offsetY") is not None:
                        ox = float(el.get("offsetX") or 0.0)
                        oy = float(el.get("offsetY") or 0.0)
                        try:
                            tool.SetInput("Offset%d" % idx, {1: ox, 2: oy, 3: 0.0})
                        except Exception:
                            pass
                tool.SetInput("Enabled%d" % idx, en)
            except Exception:
                pass
        try:
            sel = int(td.get("selectedElement") or 1)
            tool.SetInput("SelectElement", max(1, min(8, sel)))
        except Exception:
            pass



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
        # Older helpers could not see connections: fall back to setting any follower in the comp.
        hit = False
        for mod in all_tools:
            if attrs(mod).get("TOOLS_RegID") in FOLLOWERS:
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
            if not design_done and a.get("textDesign"):
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
                if old_f.startswith("p") and old_f.endswith(".png"):
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
    try:
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
    return {"step": step, "fps": fps, "count": len(frames), "frames": [] if out_dir else frames}


def op_live_frame(a):
    """Current composited timeline frame under the playhead for the live preview background."""
    tl = timeline()
    start = int(tl.GetStartFrame() or 0)
    frame = int(a.get("frame", start))
    offset = max(0, frame - start)
    r = tl.ExportFrame(offset, {"outputType": "encodedString", "encodedImageFormat": "jpg",
                                "maxDimension": int(a.get("maxDim") or 480)})
    if not r or not r.get("success"):
        raise RuntimeError((r or {}).get("error") or "Could not export timeline frame")
    return {
        "frame": frame,
        "width": int(tl.GetSetting("timelineResolutionWidth") or 1920),
        "height": int(tl.GetSetting("timelineResolutionHeight") or 1080),
        "data": r["data"],
    }


OPS = {"scan": op_scan, "set_boxes": op_set_boxes, "capture": op_capture, "live_frame": op_live_frame, "link_clips": op_link_clips, "refresh": op_refresh, "ping": op_ping, "set_text": op_set_text, "set_audio_volume": op_set_audio_volume}


def handle(req):
    fn = OPS.get(req.get("op"))
    if not fn:
        return {"id": req.get("id"), "ok": False, "error": "Unknown operation"}
    for attempt in (1, 2):
        try:
            return {"id": req.get("id"), "ok": True, "result": fn(req.get("args") or {})}
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
        except Exception:
            continue
        sys.stdout.write(json.dumps(handle(req), default=str) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
