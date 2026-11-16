#!/usr/bin/env python3
"""Reads the text / size / font of the title clips on a Resolve timeline WITHOUT opening any Fusion composition.

Why: a script that does GetFusionCompByIndex + GetInput("StyledText") (or Size) on a Text+ whose text comes through
a Follower deadlocks Resolve's main thread; Resolve then has to be killed. A timeline export never evaluates a comp.

Two ways to use it:

  1. Let it export (needs Resolve running, external scripting on):
       python3 tools/drt-read.py --export [--timeline "Name"] [--track V9,V10] [--from 5000 --to 9300] [--json]
  2. Decode a DRT that a script already exported with  timeline.Export(path, resolve.EXPORT_DRT)
     (the folder must exist):
       python3 tools/drt-read.py /path/to/timeline.drt [--track V9] [--from F --to F] [--json]

Frames are timeline frames, the same numbers TimelineItem.GetStart() returns.
"""
import argparse
import json
import os
import re
import sys
import tempfile
import zipfile
import zlib
import xml.etree.ElementTree as ET

ZSTD_MAGIC = b"\x28\xb5\x2f\xfd"
MODULES = "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/Modules"


def _zstd(raw):
    try:
        import zstandard
    except ImportError:
        return None
    try:
        return zstandard.ZstdDecompressor().decompressobj().decompress(raw)
    except Exception:
        return None


def _inflate(raw):
    """Every plain payload that can be got out of a blob: zlib or zstd, at the start or further in."""
    out = []
    for off in (4, 0):
        try:
            out.append(zlib.decompress(raw[off:]))
            break
        except Exception:
            pass
    if not out:
        i = raw.find(ZSTD_MAGIC)
        if i >= 0:
            d = _zstd(raw[i:])
            if d:
                out.append(d)
    return out


def _has_tools(d):
    return b"Compressed = true" not in d[:4000] and (b"Tools = ordered()" in d or b"Inputs = {" in d)


def comp_texts(hex_blob):
    """The Fusion composition text(s) held in a CompositionBA blob."""
    try:
        raw = bytes.fromhex(hex_blob.strip())
    except Exception:
        return []
    found = []
    todo = _inflate(raw) or [raw]
    seen = 0
    while todo and seen < 12:
        seen += 1
        d = todo.pop(0)
        if _has_tools(d):
            found.append(d.decode("utf-8", "replace"))
            continue
        # "Composition { ..., Compressed = true } { <zlib stream> }": the tools are in the inner stream
        for magic in (b"x\xda", b"x\x9c", ZSTD_MAGIC):
            start = 0
            while True:
                i = d.find(magic, start)
                if i < 0:
                    break
                start = i + 1
                if magic == ZSTD_MAGIC:
                    inner = _zstd(d[i:])
                else:
                    try:
                        inner = zlib.decompressobj().decompress(d[i:])
                    except Exception:
                        inner = None
                if inner and _has_tools(inner):
                    todo.append(inner)
                    break
            if todo:
                break
    return found


def _unquote(s):
    return (s.replace("\\n", "\n").replace('\\"', '"').replace("\\\\", "\\"))


STR = r'"((?:[^"\\]|\\.)*)"'


def _block(text, start):
    """The { ... } block that opens at or after start: (body, end index)."""
    i = text.find("{", start)
    if i < 0:
        return "", len(text)
    depth, j, in_str = 0, i, False
    while j < len(text):
        c = text[j]
        if in_str:
            if c == "\\":
                j += 1
            elif c == '"':
                in_str = False
        elif c == '"':
            in_str = True
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return text[i + 1:j], j + 1
        j += 1
    return text[i + 1:], len(text)


def _value(body, key):
    """Plain value of  key = Input { Value = ... }  inside a tool body (string, or number)."""
    m = re.search(r'(?:^|[\s,{])(?:\["?%s"?\]|%s)\s*=\s*Input\s*\{' % (re.escape(key), re.escape(key)), body)
    if not m:
        return None
    inner, _ = _block(body, m.end() - 1)
    s = re.search(r'Value\s*=\s*(?:StyledText\s*\{[^"]*?Value\s*=\s*)?' + STR, inner, re.S)
    if s:
        return _unquote(s.group(1))
    n = re.search(r"Value\s*=\s*(-?[\d.]+(?:e-?\d+)?)", inner)
    if n:
        try:
            return round(float(n.group(1)), 5)
        except ValueError:
            return None
    if re.search(r"SourceOp\s*=", inner):
        s = re.search(r'SourceOp\s*=\s*"([^"]+)"', inner)
        return {"from": s.group(1)} if s else {"from": "?"}
    e = re.search(r"Expression\s*=\s*" + STR, inner)
    if e:
        return {"expression": _unquote(e.group(1))}
    return None


TOOL = re.compile(r'(?:^|[\s,{])([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(TextPlus|MultiText|StyledTextFollower|StyledTextCLS|'
                  r'StyledTextTimeCode|TextScramble|GroupOperator|MacroOperator)\s*\{')


def read_comp(text):
    """Text tools in one composition: name, kind, text, size, font, style. Follower texts are resolved by name."""
    tools, pos = {}, 0
    order = []
    while True:
        m = TOOL.search(text, pos)
        if not m:
            break
        name, kind = m.group(1), m.group(2)
        if kind in ("GroupOperator", "MacroOperator"):
            pos = m.end()          # descend: its Tools are matched on the next rounds
            continue
        body, end = _block(text, m.end() - 1)
        pos = end
        tools[name] = (kind, body)
        order.append(name)

    def source_text(name, depth=0):
        if name not in tools or depth > 4:
            return None
        kind, body = tools[name]
        v = _value(body, "Text") if kind != "TextPlus" else _value(body, "StyledText")
        if isinstance(v, dict) and "from" in v:
            return source_text(v["from"], depth + 1)
        return v if isinstance(v, str) else None

    out = []
    for name in order:
        kind, body = tools[name]
        if kind == "TextPlus":
            t = _value(body, "StyledText")
            row = {"tool": name, "kind": "textplus"}
            if isinstance(t, dict) and "from" in t:
                row["text"] = source_text(t["from"])
                row["via"] = t["from"]
            elif isinstance(t, dict):
                row["expression"] = t.get("expression")
            else:
                row["text"] = t
            for k, key in (("size", "Size"), ("font", "Font"), ("style", "Style"), ("lineSpacing", "LineSpacing")):
                v = _value(body, key)
                if v is not None and not isinstance(v, dict):
                    row[k] = v
            out.append(row)
        elif kind == "MultiText":
            layers = sorted(set(int(n) for n in re.findall(r'\["?Text(\d+)\.[A-Za-z]+"?\]', body) +
                                re.findall(r"(?:^|[\s,{])Text(\d+)\.[A-Za-z]+\s*=", body)))
            for n in layers:
                row = {"tool": name, "kind": "multitext", "layer": n}
                t = _value(body, "Text%d.StyledText" % n)
                if isinstance(t, dict) and "from" in t:
                    row["text"] = source_text(t["from"])
                    row["via"] = t["from"]
                elif isinstance(t, str):
                    row["text"] = t
                for k, key in (("name", "TextName%d" % n), ("size", "Text%d.Size" % n), ("font", "Text%d.Font" % n),
                               ("style", "Text%d.Style" % n)):
                    v = _value(body, key)
                    if v is not None and not isinstance(v, dict):
                        row[k] = v
                if len(row) > 3:
                    out.append(row)
    return out


def read_drt(path):
    """[{track, start, end, name, enabled, tools:[...]}] for every video-track clip that holds a composition,
    plus the subtitle clips ({track:'ST1', text})."""
    z = zipfile.ZipFile(path)
    seqs = [n for n in z.infolist() if n.filename.startswith("SeqContainer/") and n.filename.endswith(".xml")]
    if not seqs:
        raise RuntimeError("No SeqContainer in that DRT")
    big = max(seqs, key=lambda n: n.file_size)       # compound clips export their own, smaller, containers
    xml = re.sub(rb"(</?[A-Za-z0-9_]+)::", rb"\1__", z.read(big))
    root = ET.fromstring(xml)
    clips = []

    def tracks(vec):
        v = root.find(vec)
        return [] if v is None else [t for t in v.iter("Sm2TiTrack")]

    def num(el, tag):
        try:
            return int(float(el.findtext(tag) or 0))
        except ValueError:
            return 0

    for ti, tr in enumerate(tracks("VideoTrackVec"), 1):
        for el in tr.iter():
            if el.tag not in ("Sm2TiVideoClip", "Sm2TiGenerator"):
                continue
            tools = []
            for ba in el.iter("CompositionBA"):
                if ba.text:
                    for txt in comp_texts(ba.text):
                        tools.extend(read_comp(txt))
            if not tools:
                continue
            start = num(el, "Start")
            clips.append({"track": "V%d" % ti, "start": start, "end": start + num(el, "Duration"),
                          "name": el.findtext("Name") or "", "enabled": not (num(el, "Flags") & 4), "tools": tools})
    for ti, tr in enumerate(tracks("SubtitleTrackVec"), 1):
        for el in tr.iter("Sm2TiGenerator"):
            start = num(el, "Start")
            clips.append({"track": "ST%d" % ti, "start": start, "end": start + num(el, "Duration"),
                          "text": el.findtext("Name") or "", "enabled": not (num(el, "Flags") & 4)})
    clips.sort(key=lambda c: (c["start"], c["track"]))
    return clips


def export_drt(timeline_name=None):
    sys.path.append(os.environ.get("RESOLVE_SCRIPT_API", "") + "/Modules")
    sys.path.append(MODULES)
    import DaVinciResolveScript as dvr
    resolve = dvr.scriptapp("Resolve")
    if not resolve:
        raise RuntimeError("DaVinci Resolve is not running (or external scripting is off)")
    project = resolve.GetProjectManager().GetCurrentProject()
    tl = project.GetCurrentTimeline()
    if timeline_name and (not tl or tl.GetName() != timeline_name):
        tl = None
        for i in range(1, (project.GetTimelineCount() or 0) + 1):
            t = project.GetTimelineByIndex(i)
            if t and t.GetName() == timeline_name:
                tl = t                                  # exported by handle: the current timeline is not switched
                break
    if not tl:
        raise RuntimeError("Timeline not found")
    folder = tempfile.mkdtemp(prefix="elsa-drt-")
    path = os.path.join(folder, "timeline.drt")
    if not tl.Export(path, resolve.EXPORT_DRT) or not os.path.exists(path):
        raise RuntimeError("Resolve could not export the timeline")
    return path, tl.GetName()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("drt", nargs="?", help="a .drt file (omit with --export)")
    ap.add_argument("--export", action="store_true", help="export the current (or --timeline) timeline first")
    ap.add_argument("--timeline", help="timeline name for --export")
    ap.add_argument("--track", help="only these tracks, e.g. V9,V10 or ST1")
    ap.add_argument("--from", dest="start", type=int, help="first timeline frame")
    ap.add_argument("--to", dest="end", type=int, help="last timeline frame")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    name = None
    if a.export:
        path, name = export_drt(a.timeline)
    elif a.drt:
        path = a.drt
    else:
        ap.error("give a .drt file or --export")
    clips = read_drt(path)
    if a.export:
        try:
            os.remove(path)
            os.rmdir(os.path.dirname(path))
        except OSError:
            pass
    if a.track:
        want = set(t.strip().upper() for t in a.track.split(","))
        clips = [c for c in clips if c["track"] in want]
    elif not a.json:
        clips = [c for c in clips if not c["track"].startswith("ST")]
    if a.start is not None:
        clips = [c for c in clips if c["end"] > a.start]
    if a.end is not None:
        clips = [c for c in clips if c["start"] <= a.end]
    if a.json:
        print(json.dumps({"timeline": name, "clips": clips}, ensure_ascii=False, indent=1))
        return
    if name:
        print("Timeline:", name)
    for c in clips:
        head = "%-4s %6d-%-6d %s%s" % (c["track"], c["start"], c["end"], "" if c["enabled"] else "(disabled) ",
                                        c.get("name") or "")
        if "text" in c:
            print(head + json.dumps(c["text"], ensure_ascii=False))
            continue
        print(head)
        for t in c["tools"]:
            bits = [t["tool"] + ("#%d" % t["layer"] if "layer" in t else "")]
            if t.get("name"):
                bits.append("(%s)" % t["name"])
            if "text" in t and t["text"] is not None:
                bits.append(json.dumps(t["text"], ensure_ascii=False))
            elif t.get("expression"):
                bits.append("= " + t["expression"])
            for k in ("size", "font", "style"):
                if k in t:
                    bits.append("%s %s" % (k, t[k]))
            print("       " + "  ".join(bits))


if __name__ == "__main__":
    main()
