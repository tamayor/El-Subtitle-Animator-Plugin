#!/usr/bin/env python3
"""Assigns the picked Pixabay sounds to the text presets (2026-11-11 SFX pass).

Download the tracks from Pixabay (any of the pages in PICKS), then run:
    python3 tools/assign-pixabay-sfx.py            # dry run: shows what it found and would change
    python3 tools/assign-pixabay-sfx.py --apply    # copies the files into sounds/original and updates library.json

A downloaded file is recognised by the Pixabay track id in its name (Pixabay names downloads
"<uploader>-<title>-<id>.mp3"), looked for in ~/Downloads and sounds/original. Presets whose sound was not found keep
what they have. library.json is backed up first. Volumes are left alone: the plugin now pulls every placed sound's
peak into -20..-15 dBFS (src/main/sfx-level.js).
"""
import glob
import json
import os
import shutil
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.normpath(os.path.join(HERE, "..", "..", "El Subtitle Animator"))
LIB = os.path.join(DATA, "library.json")
ORIG = os.path.join(DATA, "sounds", "original")
SEARCH = [ORIG, "/Volumes/work1", os.path.expanduser("~/Downloads")]      # sounds/original first: its trimmed .wav copies win

# pixabay id -> (page, what it is)
PICKS = {
    "376896": ("https://pixabay.com/sound-effects/film-special-effects-register-cha-ching-376896/", "Register Cha-ching!"),
    "447487": ("https://pixabay.com/sound-effects/technology-punchy-bass-hit-447487/", "Punchy Bass Hit"),
    "467466": ("https://pixabay.com/sound-effects/clean-minimal-pop-467466/", "Clean Minimal Pop"),
    "323580": ("https://pixabay.com/sound-effects/people-bubble-pop-04-323580/", "Bubble Pop 04"),
    "383769": ("https://pixabay.com/sound-effects/film-special-effects-swoosh-015-383769/", "Swoosh 015"),
    "631457": ("https://pixabay.com/sound-effects/film-special-effects-simple-whoosh-copyright-free-631457/", "Simple Whoosh"),
    "115095": ("https://pixabay.com/sound-effects/film-special-effects-sound-effect-twinklesparkle-115095/", "Twinkle/Sparkle"),
    "561933": ("https://pixabay.com/sound-effects/film-special-effects-short-swoosh-whoosh-sound-561933/", "Short Swoosh Whoosh"),
    "561929": ("https://pixabay.com/sound-effects/film-special-effects-quick-whoosh-transition-sound-561929/", "Quick Whoosh Transition"),
    "379079": ("https://pixabay.com/sound-effects/film-special-effects-whoosh-short-realistic-379079/", "Whoosh Short Realistic"),
    "393908": ("https://pixabay.com/sound-effects/film-special-effects-single-key-press-393908/", "Single Key Press"),
    "147352": ("https://pixabay.com/sound-effects/film-special-effects-soft-ui-click-147352/", "Soft UI Click"),
    "385295": ("https://pixabay.com/sound-effects/film-special-effects-highlighter-on-paper-highlighting-385295/", "Highlighter on Paper"),
    "483867": ("https://pixabay.com/sound-effects/film-special-effects-highlighter-on-paper-sfx-483867/", "Highlighter on paper SFX"),
    "483868": ("https://pixabay.com/sound-effects/film-special-effects-highlighter-on-paper-sfx-2-483868/", "Highlighter on paper SFX 2"),
    "451414": ("https://pixabay.com/sound-effects/fairy-sparkle-451414/", "Fairy Sparkle"),
    "451232": ("https://pixabay.com/sound-effects/technology-soft-ui-pop-light-minimal-click-451232/", "Soft UI Pop"),
    "126517": ("https://pixabay.com/sound-effects/film-special-effects-soft-interface-click-126517/", "Soft Interface Click"),
    "316482": ("https://pixabay.com/sound-effects/film-special-effects-ui-pop-sound-316482/", "UI Pop sound"),
    "379990": ("https://pixabay.com/sound-effects/film-special-effects-thud-impact-sound-sfx-379990/", "Thud Impact Sound"),
    "547872": ("https://pixabay.com/sound-effects/technology-soft-app-button-tap-sound-2-547872/", "Soft App Button Tap #2"),
    "454861": ("https://pixabay.com/sound-effects/swoosh-026-454861/", "Swoosh 026"),
    "312910": ("https://pixabay.com/sound-effects/film-special-effects-glitch-sfx-312910/", "Glitch sfx"),
}

# preset -> main sound id (None = no main sound)
MAIN = {
    "$123,456": "376896",                 # (Money Pop Up was a duplicate and was deleted 2026-11-11)
    "Drop Pump": "447487",
    "Pop Up": "467466", "Pop Down": "323580",
    "Justified Pop": None,                # its wooden tap per word only (user's choice), no main sound
    "Blur In Fade": "631457",
    "Letter Cascade": "115095",
    "Word Cascade Pop": None,                 # one short swoosh per word instead (ROW_LAYER)
    "Word Cascade Expo": None,            # one quick whoosh per word instead (ROW_LAYER)
    "Tracking Settle": "379079",
    "Word by Word Typing": None,          # one keystroke per word instead (ROW_LAYER)
    "Kinetic Statements": None,           # one thud per word instead (ROW_LAYER), landing on the word's size peak
}
# MultiText presets: one sound per row as that row animates (align 'seg': 1 = Upper, 2 = Emphasis, 3 = Lower) and no
# main sound (it doubled the Upper row's sound on the same frame). preset -> (Upper / Lower sound, Emphasis sound)
SEG = {
    "Group Slide Emphasize": ("454861", "383769"),     # rows slide in: small swoosh, bigger swoosh on the emphasis
    "Highlight Select": ("547872", "147352"), "Underline Draw": ("547872", "147352"), "Soft Marker": ("547872", "147352"),
    "Glass Pill": ("547872", "451414"), "Glass Blur (ML)": ("547872", "451414"),
    "Pill Soft": ("547872", "451232"), "Pill Outline": ("547872", "126517"), "Pill Solid": ("547872", "316482"),
}
# preset -> marker / pencil layer (the 'Pencil Writing' layer is swapped, its trim reset)
PENCIL = {"Highlight Select": "385295", "Underline Draw": "483867", "Soft Marker": "483868"}
# preset -> the per-row / per-word repeated sound ('rows' layer)
ROW_LAYER = {"Kinetic Statements": "379990", "Word Cascade Pop": "561933", "Word Cascade Expo": "561929", "Word by Word Typing": "393908", "Kinetic Cloud": "547872", "Kinetic Lines": "454861"}
# frames after the word / row start that its sound starts (Kinetic Statements: each word grows to its 118 % peak at
# frame 8 after it starts; the thud peaks ~2 frames into the cut, so +4 puts the impact on the word's slam)
ROW_OFFSET = {"Kinetic Statements": 4}
GLITCH = "312910"


def find(pid):
    for d in SEARCH:
        for p in sorted(glob.glob(os.path.join(d, "*-" + pid + ".*")), key=lambda x: not x.endswith(".wav")):
            if os.path.splitext(p)[1].lower() in (".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aif", ".aiff"):
                return p
    return None


def main():
    apply = "--apply" in sys.argv
    found = {pid: find(pid) for pid in PICKS}
    for pid, (page, title) in PICKS.items():
        print(("OK   " if found[pid] else "MISS ") + title.ljust(28) + (os.path.basename(found[pid]) if found[pid] else page))
    name = {pid: os.path.basename(p) for pid, p in found.items() if p}
    lib = json.load(open(LIB))
    changes = []
    for a in lib.get("animations", []):
        n = a.get("name")
        if n in MAIN:
            pid = MAIN[n]
            if pid is None and a.get("sfx") is not None and (n not in ROW_LAYER or ROW_LAYER[n] in name):
                changes.append((n, "main sound", a.get("sfx"), None))
                a["sfx"] = None
                a["sfxOrig"] = None
            elif pid in name and a.get("sfx") != name[pid]:
                changes.append((n, "main sound", a.get("sfx"), name[pid]))
                a["sfx"] = name[pid]
                a["sfxOrig"] = name[pid]
                a["sfxTrimIn"] = 0
                a["sfxLen"] = None
                a["sfxLenMode"] = "estimate"
        if n in SEG and SEG[n][0] in name and SEG[n][1] in name:
            if a.get("sfx") is not None:
                changes.append((n, "main sound", a.get("sfx"), None))
                a["sfx"] = None
                a["sfxOrig"] = None
            for l in a.get("sfxLayers") or []:
                if l.get("align") != "seg" or "Pencil" in str(l.get("file")) or "highlighter" in str(l.get("file")).lower():
                    continue      # the marker stroke layer is not a row sound (PENCIL below)
                want = name[SEG[n][1]] if int(l.get("seg") or 0) == 2 else name[SEG[n][0]]
                if l.get("file") != want:
                    changes.append((n, "row %s sound" % l.get("seg"), l.get("file"), want))
                    l["file"] = l["orig"] = want
                    l["trimIn"] = 0
        if n in PENCIL and PENCIL[n] in name:
            for l in a.get("sfxLayers") or []:
                if "Pencil" in str(l.get("file")):
                    changes.append((n, "marker layer", l["file"], name[PENCIL[n]]))
                    l["file"] = l["orig"] = name[PENCIL[n]]
                    l["trimIn"] = 0
        if n in ROW_LAYER and ROW_LAYER[n] in name:
            layers = a.setdefault("sfxLayers", [])
            rows = [l for l in layers if l.get("align") == "rows"]
            if rows:
                for l in rows:
                    if l.get("file") != name[ROW_LAYER[n]]:
                        changes.append((n, "per-row sound", l.get("file"), name[ROW_LAYER[n]]))
                        l["file"] = l["orig"] = name[ROW_LAYER[n]]
                        l["trimIn"] = 0
            else:
                changes.append((n, "per-word sound", None, name[ROW_LAYER[n]]))
                layers.append({"id": "lrow" + str(int(time.time())), "file": name[ROW_LAYER[n]], "orig": name[ROW_LAYER[n]],
                               "enabled": True, "volume": -12, "offset": ROW_OFFSET.get(n, 0), "align": "rows", "trimIn": 0, "len": 0,
                               "lenMode": "clip", "fade": 2, "link": True, "track": 0})
    bed = "kave_msri-glitch-bed-312910b.wav"      # tools/trim-sfx.py glitch_bed: the sound lasts as long as the glitch (the clip)
    if os.path.exists(os.path.join(ORIG, bed)):
        cur = (lib.get("effectSfx") or {}).get("Glitch") or {}
        if cur.get("file") != bed or cur.get("follow") != "bursts":
            changes.append(("Glitch effect", "auto sound", cur.get("file"), bed + " (one cut per glitch burst)"))
            lib.setdefault("effectSfx", {})["Glitch"] = {"file": bed, "follow": "bursts"}
    print()
    for c in changes:
        print("%-24s %-15s %s -> %s" % c)
    if not changes:
        print("Nothing to change.")
    if not apply:
        print("\nDry run. Run again with --apply to copy the files and save library.json.")
        return
    os.makedirs(ORIG, exist_ok=True)
    for pid, p in found.items():
        if p and os.path.dirname(p) != ORIG:
            shutil.copy2(p, os.path.join(ORIG, os.path.basename(p)))
    if changes:
        shutil.copy2(LIB, LIB + ".before-pixabay-sfx-" + time.strftime("%Y%m%d-%H%M%S"))
        tmp = LIB + ".tmp"
        with open(tmp, "w") as f:
            json.dump(lib, f, indent=2, ensure_ascii=False)
        os.replace(tmp, LIB)
    print("\nApplied %d change(s)." % len(changes))


if __name__ == "__main__":
    main()
