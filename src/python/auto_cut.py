#!/usr/bin/env python3
"""Cut tab analysis: where to cut a talking-head recording.

For each source range (a clip on the timeline's source track, in its media file's seconds) it finds the speech, shortens
every pause longer than `maxPause` to `pauseKeep`, trims silence at the clip's head and tail, and drops retakes,
stutters and (optionally) filler words found in the words the panel passes (Resolve's own transcription, or the
subtitle track). It also measures the clip's integrated loudness, in the same ffmpeg pass.

In the app: the Cut tab (src/main/auto-cut.js) and the MCP tool auto_cut. The app writes a JSON request to stdin and
reads one line "RESULT {json}"; progress lines start with "PROGRESS ".

The pause rules are adapted from ghost-editor's scripts/plan_cut.py and vad_pauses.py (MIT, (c) kurbaitaev,
https://github.com/kurbaitaev/ghost-editor):
  - a 10 ms energy envelope; the noise floor is its 8th percentile; speech = 14 dB over the floor for >= 30 ms;
    a pause = energy under floor + 20 dB (breath and room tone count as pause)
  - clicks and lip smacks of <= 50 ms inside a pause are bridged so they do not split it
  - a shortened pause keeps a tail after the speech and a lead before it (0.11 + 0.07 s) and stops short of any click
  - never a cut inside a word: a word with >= 0.10 s of itself on both sides of the gap keeps the gap
  - clip head keeps 0.10 s before the first word, the tail 0.18 s after the last
  - every edge snaps to the media's frame grid (picture and voice cut on the same frame)

Request: {"ffmpeg": path, "cacheDir": dir, "params": {...}, "sources": [{"id", "path", "a", "b", "fps"}],
          "words": {source id: [{"a", "b", "w"}]}, "ignore": [drop ids the user kept]}
Result:  {"sources": [{"id", "keeps": [[a, b]], "cuts": [...], "floor_db", "lufs", "speech_s", "dur", "warn"}],
          "drops": [{"id", "kind", "src", "a", "b", "text", "of"}], "params"}
"""
import base64
import difflib
import hashlib
import json
import os
import re
import subprocess
import sys

try:
    import numpy as np
except ImportError:  # the app checks for numpy before it runs this
    np = None

SR = 16000
HOP = SR // 100            # 10 ms envelope frames
WIN = HOP * 2              # 20 ms RMS window

DEFAULTS = {
    "maxPause": 0.26,      # a pause longer than this is shortened (s)
    "pauseKeep": 0.18,     # what is left of a shortened pause (s); 60 % after the speech, 40 % before
    "sentenceKeep": 0.25,  # left of a pause after a sentence end, when words are known (s)
    "headLead": 0.10,      # kept before the first word of a clip (s)
    "tailKeep": 0.18,      # kept after the last word of a clip (s)
    "speechDb": 14.0,      # speech threshold over the noise floor (dB)
    "pauseDb": 20.0,       # pause line over the noise floor (dB)
    "minSpeech": 0.12,     # shorter sounds between pauses are noise, not speech (s)
    "voiceDb": 18.0,       # a sound this far under the voice's own level is not speech (off-mic murmur, movement) (dB)
    "wordless": False,     # drop kept pieces the transcription heard no words in (the app turns it on with Resolve's words)
    "minPiece": 0.20,      # shorter kept pieces are dropped (s)
    "retakes": True,       # drop earlier attempts of a line that is said again
    "retakeSim": 0.72,     # how alike two attempts must be (0..1)
    "retakeLook": 8,       # how many following phrases to compare with (chatter between takes counts as phrases)
    "retakeSpan": 45.0,    # a retake takes out everything up to the kept attempt when it starts within this (s)
    "outtakes": True,      # drop between-take talk ("Wait, sorry.", "Okay, I go again.", "Let's go again.")
    "script": "",          # the script: keep only the last complete take of each line, drop everything else
    "phraseGap": 0.45,     # a pause this long ends a phrase (s)
    "stutters": True,      # "I think I think" -> "I think" (repeats of 2-4 words)
    "fillers": False,      # drop um / uh / erm (only when the transcription has them)
    "loudness": True,      # measure integrated loudness (LUFS)
}
FILLERS = {"um", "umm", "uh", "uhh", "uhm", "erm", "er", "ah", "ahh", "hmm", "mm", "mhm", "eh"}


def progress(**k):
    print("PROGRESS " + json.dumps(k), flush=True)


# ------------------------------------------------------------------ audio

def cache_key(src):
    try:
        st = os.stat(src["path"])
        sig = "%s|%s|%s|%.3f|%.3f" % (src["path"], st.st_size, int(st.st_mtime), float(src["a"]), float(src["b"]))
    except OSError:
        sig = "%s|%.3f|%.3f" % (src["path"], float(src["a"]), float(src["b"]))
    return hashlib.sha1(sig.encode("utf-8")).hexdigest()[:20]


def decode(ffmpeg, path, a, dur, loudness):
    """16 kHz mono float samples of [a, a + dur] and the range's integrated loudness (LUFS, or None)."""
    af = ("ebur128=framelog=quiet," if loudness else "") + "aresample=%d,pan=mono|c0=0.5*c0+0.5*c1" % SR
    cmd = [ffmpeg, "-nostdin", "-hide_banner", "-nostats", "-v", "info", "-ss", "%.4f" % a, "-t", "%.4f" % dur,
           "-i", path, "-vn", "-sn", "-dn", "-af", af, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0 or not r.stdout:
        # mono sources have no c1: retry with a plain downmix
        cmd[cmd.index("-af") + 1] = ("ebur128=framelog=quiet," if loudness else "") + "aresample=%d" % SR
        r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0 or not r.stdout:
        tail = r.stderr.decode("utf-8", "replace").strip().splitlines()[-1:] or ["no audio"]
        raise RuntimeError("%s: %s" % (os.path.basename(path), tail[0]))
    lufs = None
    m = re.findall(r"I:\s*(-?[\d.]+|-inf)\s*LUFS", r.stderr.decode("utf-8", "replace"))
    if m and m[-1] != "-inf":
        lufs = float(m[-1])
    return np.frombuffer(r.stdout, np.float32), lufs


def envelope(x):
    """dB of a 20 ms RMS window every 10 ms (cumulative sums: linear time on hour-long files)."""
    if len(x) < WIN:
        return np.full(1, -120.0, np.float32)
    c = np.concatenate(([0.0], np.cumsum(x.astype(np.float64) ** 2)))
    n = len(x) // HOP
    centres = np.arange(n) * HOP + HOP // 2
    lo = np.clip(centres - WIN // 2, 0, len(x))
    hi = np.clip(centres + WIN // 2, 0, len(x))
    ms = (c[hi] - c[lo]) / np.maximum(hi - lo, 1)
    return (10 * np.log10(ms + 1e-12)).astype(np.float32)


def load_env(src, req, p):
    """Envelope + loudness, cached per file range (re-analysing with new settings does not decode again)."""
    cdir = req.get("cacheDir")
    key = cache_key(src)
    fe = os.path.join(cdir, key + ".npy") if cdir else None
    fm = os.path.join(cdir, key + ".json") if cdir else None
    if fe and os.path.exists(fe) and os.path.exists(fm):
        try:
            meta = json.load(open(fm))
            if meta.get("loudness") or not p["loudness"]:
                return np.load(fe), meta.get("lufs")
        except Exception:
            pass
    x, lufs = decode(req.get("ffmpeg") or "ffmpeg", src["path"], float(src["a"]), float(src["b"]) - float(src["a"]), p["loudness"])
    db = envelope(x)
    if fe:
        try:
            os.makedirs(cdir, exist_ok=True)
            np.save(fe, db)
            json.dump({"lufs": lufs, "loudness": bool(p["loudness"]), "path": src["path"]}, open(fm, "w"))
        except OSError:
            pass
    return db, lufs


# ------------------------------------------------------------------ pauses

def runs(mask):
    """[(start, end)] index runs where mask is True (end exclusive)."""
    m = np.concatenate(([False], np.asarray(mask, bool), [False]))
    d = np.diff(m.astype(np.int8))
    return list(zip(np.where(d == 1)[0].tolist(), np.where(d == -1)[0].tolist()))


def longest_run(mask):
    r = runs(mask)
    return max((e - s for s, e in r), default=0)


def in_word(words, p0, p1):
    """A gap inside one word (the unvoiced 'st' in "desyat"): the word has >= 0.10 s of itself on both sides.
    Whisper-style timings stretch a short word over the pause beside it, so a plain overlap is not enough."""
    return any(w["a"] <= p0 - 0.10 and w["b"] >= p1 + 0.10 for w in words)


def sentence_end_before(words, t):
    prev = [w for w in words if w["b"] <= t + 0.05]
    return bool(prev) and bool(re.search(r"[.?!…]['\")\]]*$", prev[-1]["w"].strip()))


def plan_keeps(db, p, words=(), dur=None):
    """Kept ranges (s, relative to the range start) and the cuts, from a 10 ms dB envelope."""
    n = len(db)
    dur = float(dur if dur is not None else n / 100.0)
    floor = float(np.percentile(db, 8)) if n else -120.0
    TH, THP = floor + p["speechDb"], floor + p["pauseDb"]
    warn = []
    if n and float(np.percentile(db, 95)) - floor < p["speechDb"] + 4:
        warn.append("low contrast between voice and background: check the cuts (noisy room or music under the voice)")

    low = db <= THP
    for s, e in runs(~low):                      # clicks / lip smacks <= 50 ms inside a pause
        if s > 0 and e < n and e - s <= 5:
            low[s:e] = True
    noise = []
    # On a clean recording (gated mic, floor near -80 dB) "14 dB over the floor" lets every murmur and rustle through:
    # real voice also has to come within voiceDb of the voice's own level (the envelope's 95th percentile).
    TV = max(TH, float(np.percentile(db, 95)) - p["voiceDb"]) if n else TH
    for s, e in runs(~low):                      # a stretch without 30 ms of real voice is a breath / bump
        if longest_run(db[s:e] > TV) < 3 or (e - s) / 100.0 < p["minSpeech"]:
            low[s:e] = True
            noise.append((s / 100.0, e / 100.0))
    speech = [(s / 100.0, min(e / 100.0, dur)) for s, e in runs(~low)]
    if not speech:
        return {"keeps": [], "cuts": [{"a": 0.0, "b": dur, "kind": "silence", "dur": round(dur, 3)}],
                "floor_db": round(floor, 1), "speech_s": 0.0, "warn": warn + ["no speech found"], "speech": [], "gapf": []}

    def blips_in(a, b):
        """10 ms frames over the pause line inside a pause, more than 50 ms from its edges (clicks, smacks)"""
        k0, k1 = int(round(a * 100)), int(round(b * 100))
        seg = db[k0:k1]
        idx = np.where(seg > THP)[0]
        idx = idx[(idx >= 5) & (idx <= len(seg) - 6)]
        return [(k0 + i) / 100.0 for i in idx]

    keeps, cuts, gapf = [], [], []
    cur_a = max(0.0, speech[0][0] - p["headLead"])
    if cur_a > 0.05:
        cuts.append({"a": 0.0, "b": round(cur_a, 3), "kind": "head", "dur": round(speech[0][0], 3)})
    for (a0, b0), (a1, b1) in zip(speech, speech[1:]):
        gap = a1 - b0
        # what the panel needs to cut this gap again with other pause settings (src/renderer/js/library/cut-plan.js):
        # [inside a word, after a sentence end, first click, last click (-1 = none)]
        inw = in_word(words, b0, a1)
        sent = bool(words) and sentence_end_before(words, b0)
        bl = blips_in(b0, a1) if gap > 0.08 and not inw else []
        gapf.append([int(inw), int(sent), round(bl[0], 3) if bl else -1, round(bl[-1], 3) if bl else -1])
        if gap <= p["maxPause"] or inw:
            continue
        keep = p["sentenceKeep"] if sent else p["pauseKeep"]
        if gap <= keep + 0.04:
            continue
        t_end, t_start = b0 + keep * 0.6, a1 - keep * 0.4
        if bl:                                   # stop short of a click; a sentence break keeps a little breath
            t_end = min(t_end, max(bl[0] - 0.01, b0 + 0.04))
            t_start = max(t_start, min(bl[-1] + 0.02, a1 - 0.04), a1 - 0.12)
        if t_start - t_end < 0.02:
            continue
        keeps.append([cur_a, t_end])
        cuts.append({"a": round(t_end, 3), "b": round(t_start, 3), "kind": "pause", "dur": round(gap, 3)})
        cur_a = t_start
    end = min(dur, speech[-1][1] + p["tailKeep"])
    keeps.append([cur_a, end])
    if dur - end > 0.05:
        cuts.append({"a": round(end, 3), "b": round(dur, 3), "kind": "tail", "dur": round(dur - speech[-1][1], 3)})
    return {"keeps": keeps, "cuts": cuts, "floor_db": round(floor, 1),
            "speech_s": round(sum(b - a for a, b in speech), 2), "warn": warn,
            "speech": [[round(a, 3), round(b, 3)] for a, b in speech], "gapf": gapf}


WAVE_MAX = 20000           # most buckets of the panel's waveform per clip


def wave_of(db, floor):
    """The envelope for the panel's waveform: the loudest 10 ms of each bucket, 0..255 from the noise floor to the
    peaks, base64. Returns (text, seconds per bucket)."""
    n = len(db)
    if not n:
        return "", 0.01
    k = max(1, int(np.ceil(n / float(WAVE_MAX))))
    pad = (-n) % k
    x = np.concatenate((db, np.full(pad, -120.0, np.float32))) if pad else db
    x = x.reshape(-1, k).max(axis=1)
    hi = max(float(np.percentile(db, 99.5)), floor + 12.0)
    v = np.clip((x - floor) / (hi - floor), 0.0, 1.0) ** 1.4
    return base64.b64encode((v * 255).astype(np.uint8).tobytes()).decode("ascii"), k / 100.0


# ------------------------------------------------------------------ retakes, stutters, fillers

def norm(w):
    return re.sub(r"[^\w']+", "", str(w).lower()).strip("'")


def phrases_of(words_by_src, order, gap):
    """Phrases in timeline order: words split at a pause >= gap or after a sentence end."""
    out = []
    for sid in order:
        cur = None
        for w in words_by_src.get(sid) or []:
            t = norm(w["w"])
            if not t or t == "...":
                continue
            if cur and (w["a"] - cur["b"] >= gap or cur["end"]):
                out.append(cur)
                cur = None
            if not cur:
                cur = {"src": sid, "a": w["a"], "b": w["b"], "tok": [], "text": [], "end": False}
            cur["tok"].append(t)
            cur["text"].append(str(w["w"]).strip())
            cur["b"] = w["b"]
            cur["end"] = bool(re.search(r"[.?!…]['\")\]]*$", str(w["w"]).strip()))
        if cur:
            out.append(cur)
    return out


def clip_text(t, n=160):
    t = " ".join(str(t).split())
    return t if len(t) <= n else t[:n - 1] + "…"


def retake_of(P, i, p):
    """Index of the later phrase that phrase i is an earlier attempt of, or None."""
    A = P[i]
    if len(A["tok"]) < 2:
        return None
    for j in range(i + 1, min(len(P), i + 1 + int(p["retakeLook"]))):
        B = P[j]
        head = B["tok"][:len(A["tok"]) + 1]
        r = difflib.SequenceMatcher(None, A["tok"], head, autojunk=False).ratio()
        cut_off = A["text"][-1].endswith(("...", "…")) and A["tok"][:2] == B["tok"][:2] and len(B["tok"]) >= 2
        if cut_off or (r >= p["retakeSim"] and len(B["tok"]) >= max(2, int(len(A["tok"]) * 0.6))):
            return j
    return None


def find_retakes(P, p):
    """An earlier phrase that a later one (within retakeLook phrases) starts the same way is an abandoned or repeated
    attempt. Everything from it up to the start of the later attempt goes (the talk between takes too: "Oh wait, no,
    okay. Okay, I go again."), when the later attempt starts within retakeSpan s in the same clip and every phrase in
    between is talk between takes or itself a retake; otherwise only the failed line goes. The last take wins."""
    later = [retake_of(P, i, p) for i in range(len(P))]
    chat = [is_outtake(x["tok"]) for x in P]
    drops = []
    for i, A in enumerate(P):
        j = later[i]
        if j is None:
            continue
        B = P[j]
        between_ok = all(chat[k] or later[k] is not None or len(P[k]["tok"]) <= 2 for k in range(i + 1, j))
        if B["src"] == A["src"] and B["a"] - A["a"] <= p["retakeSpan"] and between_ok:
            b, text = B["a"] - 0.07, " / ".join(" ".join(x["text"]) for x in P[i:j])
        else:
            nxt = P[i + 1] if i + 1 < len(P) and P[i + 1]["src"] == A["src"] else None
            b, text = (nxt["a"] - 0.07) if nxt else A["b"] + 0.10, " ".join(A["text"])
        r = difflib.SequenceMatcher(None, A["tok"], B["tok"][:len(A["tok"]) + 1], autojunk=False).ratio()
        drops.append({"kind": "retake", "src": A["src"], "a": A["a"] - 0.03, "b": b,
                      "text": clip_text(text), "of": clip_text(" ".join(B["text"])), "score": round(r, 2)})
    return drops


# Words people say between takes. A phrase of up to 12 words scoring >= 2 (a strong cue counts 2, a weak one 1) that has
# a strong cue or is all weak words is talk between takes, not the script.
STRONG_CUES = {"wait", "sorry", "again", "oops", "whoops", "nah", "retake", "redo", "mistake", "cut", "sec"}
STRONG_PAIRS = {("hold", "on"), ("start", "over"), ("the", "top"), ("one", "more"), ("my", "bad"), ("go", "again"),
                ("don't", "know"), ("let", "me"), ("lets", "go"), ("let's", "go"), ("take", "two"), ("one", "sec")}
WEAK_CUES = {"okay", "ok", "yeah", "yes", "yep", "no", "right", "alright", "hmm", "um", "uh", "so", "oh", "ah", "mm",
             "sure", "cool", "good", "fine", "please", "and", "go"}


def is_outtake(t):
    if not t or len(t) > 12:
        return False
    strong = sum(1 for w in t if w in STRONG_CUES) + sum(1 for x in zip(t, t[1:]) if x in STRONG_PAIRS)
    weak = sum(1 for w in t if w in WEAK_CUES)
    return bool(strong * 2 + weak >= 2 and (strong or weak == len(t)) or (len(t) <= 2 and weak == len(t)))


def find_outtakes(P, p, taken):
    drops = []
    for A in P:
        t = A["tok"]
        if not t or len(t) > 12:
            continue
        if any(d["src"] == A["src"] and d["a"] <= A["a"] and d["b"] >= A["b"] - 0.05 for d in taken):
            continue                                   # already inside a retake span
        if is_outtake(t):
            drops.append({"kind": "outtake", "src": A["src"], "a": A["a"] - 0.05, "b": A["b"] + 0.08,
                          "text": clip_text(" ".join(A["text"])), "of": ""})
    return drops


# ------------------------------------------------------------------ script: the last complete take of every line

def script_lines(text):
    lines = []
    for part in re.split(r"(?<=[.?!…])\s+|\n+", str(text or "")):
        tok = [norm(w) for w in part.split()]
        tok = [w for w in tok if w]
        if tok:
            lines.append({"tok": tok, "text": " ".join(part.split())})
    return lines


def script_takes(words_by_src, order, lines, p):
    """Each script line is looked for everywhere in the words (same clip, in order); its last attempt that holds >= 80 %
    of the line is kept (else the best one >= 50 %, with a warning). Everything outside the kept takes is dropped as an
    outtake, so chatter, false starts and pickups go without a list of cue words."""
    T = []
    for sid in order:
        for w in words_by_src.get(sid) or []:
            t = norm(w["w"])
            if t:
                T.append({"src": sid, "a": w["a"], "b": w["b"], "t": t, "w": str(w["w"]).strip()})
    warn, chosen, prev_end = [], [], -1
    for k, L in enumerate(lines):
        S = L["tok"]

        def find(head):
            out = []
            for i in range(prev_end + 1, len(T)):
                if T[i]["t"] != head:
                    continue
                j = i
                while j < len(T) and j < i + len(S) + 4 and T[j]["src"] == T[i]["src"]:
                    j += 1
                win = [x["t"] for x in T[i:j]]
                blocks = [b for b in difflib.SequenceMatcher(None, S, win, autojunk=False).get_matching_blocks() if b.size]
                if blocks:
                    out.append((i, i + blocks[-1].b + blocks[-1].size - 1, sum(b.size for b in blocks) / len(S)))
            return out
        # a take starts on the line's first word; its second word only when the first was swallowed or misheard
        cands = find(S[0]) or (find(S[1]) if len(S) > 1 else [])
        good = [c for c in cands if c[2] >= 0.8]
        pickc = max(good, key=lambda c: (c[0], c[2])) if good else (max(cands, key=lambda c: c[2]) if cands else None)
        if not pickc or pickc[2] < 0.5:
            warn.append("script line %d not found: %s" % (k + 1, clip_text(L["text"], 60)))
            continue
        if pickc[2] < 0.8:
            warn.append("script line %d: no complete take (best %d %%): %s" % (k + 1, round(pickc[2] * 100), clip_text(L["text"], 60)))
        chosen.append(pickc)
        prev_end = pickc[1]
    spans = []                                         # [src, first word index, last word index]
    for a, b, _ in chosen:
        if spans and spans[-1][0] == T[a]["src"] and a <= spans[-1][2] + 1:
            spans[-1][2] = max(spans[-1][2], b)
        else:
            spans.append([T[a]["src"], a, b])
    drops = []
    for sid in order:
        mine = [sp for sp in spans if sp[0] == sid]
        idx = [i for i, x in enumerate(T) if x["src"] == sid]
        if not idx:
            continue
        edges = [(-1, None)] + [(sp[1], sp[2]) for sp in mine] + [(None, len(T))]
        for (_, e0), (s1, _) in zip(edges, edges[1:]):
            lo = (e0 + 1) if e0 is not None else idx[0]
            hi = (s1 - 1) if s1 is not None else idx[-1]
            gap = [T[i] for i in range(lo, hi + 1) if T[i]["src"] == sid]
            if not gap:
                continue
            a = (T[e0]["b"] + 0.12) if e0 is not None and e0 >= 0 else gap[0]["a"] - 0.10
            b = (T[s1]["a"] - 0.08) if s1 is not None and s1 < len(T) else gap[-1]["b"] + 0.30
            if b > a:
                drops.append({"kind": "outtake", "src": sid, "a": a, "b": b,
                              "text": clip_text(" ".join(x["w"] for x in gap)), "of": ""})
    return drops, warn


def find_stutters(words, sid):
    """'I think I think we' -> drop the first 'I think' (2-4 word repeats; single words are left: 'very very')."""
    ws = [w for w in words if norm(w["w"])]
    tok = [norm(w["w"]) for w in ws]
    drops, k = [], 0
    while k < len(tok):
        hit = 0
        for n in (4, 3, 2):
            if k + 2 * n <= len(tok) and tok[k:k + n] == tok[k + n:k + 2 * n] and ws[k + n]["a"] - ws[k + n - 1]["b"] < 1.0:
                hit = n
                break
        if hit:
            drops.append({"kind": "stutter", "src": sid, "a": ws[k]["a"] - 0.02, "b": ws[k + hit]["a"] - 0.04,
                          "text": " ".join(str(w["w"]) for w in ws[k:k + hit]), "of": " ".join(str(w["w"]) for w in ws[k + hit:k + 2 * hit])})
            k += hit
        else:
            k += 1
    return drops


def find_fillers(words, sid):
    ws = [w for w in words if norm(w["w"])]
    drops = []
    for i, w in enumerate(ws):
        if norm(w["w"]) in FILLERS:
            a = max(w["a"] - 0.03, ws[i - 1]["b"] if i else 0.0)
            b = min(w["b"] + 0.03, ws[i + 1]["a"] if i + 1 < len(ws) else w["b"] + 0.03)
            drops.append({"kind": "filler", "src": sid, "a": a, "b": b, "text": str(w["w"]), "of": ""})
    return drops


def subtract(keeps, drops):
    out = []
    for a, b in keeps:
        segs = [[a, b]]
        for d in drops:
            nxt = []
            for s, e in segs:
                if d["b"] <= s or d["a"] >= e:
                    nxt.append([s, e])
                    continue
                if d["a"] > s:
                    nxt.append([s, d["a"]])
                if d["b"] < e:
                    nxt.append([d["b"], e])
            segs = nxt
        out.extend(segs)
    return out


def drop_wordless(keeps, words, drops):
    """Kept pieces with no word left in them (the words of taken-out lines do not count): murmurs, breaths, off-mic
    talk and the slivers beside a taken-out line. Returns (pieces that stay, pieces that go). Same rule as
    cutPlanWordless in src/renderer/js/library/cut-plan.js."""
    live = [w for w in words if norm(w["w"]) and not any(d["a"] <= (w["a"] + w["b"]) / 2 <= d["b"] for d in drops)]
    stay, gone = [], []
    for a, b in keeps:
        has = any(min(b, w["b"]) - max(a, w["a"]) >= min(0.05, (w["b"] - w["a"]) / 2) for w in live)
        (stay if has else gone).append([a, b])
    return stay, gone


def snap(keeps, fps, dur, min_piece):
    """Edges on the media's frame grid (frames, end exclusive); tiny pieces dropped, touching pieces joined."""
    out = []
    for a, b in keeps:
        fa = int(np.ceil(max(0.0, a) * fps - 1e-6))
        fb = int(np.floor(min(dur, b) * fps + 1e-6))
        if fb - fa < max(2, int(round(min_piece * fps))):
            continue
        if out and fa - out[-1][1] <= 1:
            out[-1][1] = max(out[-1][1], fb)
        else:
            out.append([fa, fb])
    return out


# ------------------------------------------------------------------ main

def analyse(req):
    p = dict(DEFAULTS)
    p.update({k: v for k, v in (req.get("params") or {}).items() if k in DEFAULTS and v is not None})
    srcs = req.get("sources") or []
    words = {str(k): sorted(v, key=lambda w: w["a"]) for k, v in (req.get("words") or {}).items()}
    ignore = set(req.get("ignore") or [])
    res, plans = [], {}
    for i, s in enumerate(srcs):
        progress(phase="audio", done=i, total=len(srcs), text="Listening to %s (%d of %d)" % (os.path.basename(s["path"]), i + 1, len(srcs)))
        sid = str(s["id"])
        dur = float(s["b"]) - float(s["a"])
        try:
            db, lufs = load_env(s, req, p)
        except Exception as e:
            res.append({"id": sid, "error": str(e), "keeps": [], "cuts": [], "dur": dur})
            continue
        # words arrive in media seconds; the envelope starts at the range start
        w_rel = [{"a": w["a"] - float(s["a"]), "b": w["b"] - float(s["a"]), "w": w["w"]}
                 for w in words.get(sid, []) if w["b"] > float(s["a"]) and w["a"] < float(s["b"])]
        pl = plan_keeps(db, p, w_rel, dur)
        pl["lufs"] = lufs
        pl["wave"], pl["wave_dt"] = wave_of(db, pl["floor_db"]) if req.get("wave") else ("", 0.01)
        plans[sid] = (s, pl, w_rel)

    progress(phase="text", text="Looking for retakes")
    order = [str(s["id"]) for s in srcs if str(s["id"]) in plans]
    rel_words = {sid: plans[sid][2] for sid in order}
    drops, text_warn = [], []
    lines = script_lines(p["script"]) if str(p.get("script") or "").strip() else []
    if lines and any(rel_words.values()):
        progress(phase="text", text="Matching %d script lines" % len(lines))
        d, text_warn = script_takes(rel_words, order, lines, p)
        drops += d
    else:
        if lines:
            text_warn.append("a script was given but there are no words to match it with (transcription off?)")
        P = phrases_of(rel_words, order, p["phraseGap"])
        if p["retakes"]:
            drops += find_retakes(P, p)
        if p["outtakes"]:
            drops += find_outtakes(P, p, drops)
    for sid in order:
        if p["stutters"]:
            drops += find_stutters(rel_words[sid], sid)
        if p["fillers"]:
            drops += find_fillers(rel_words[sid], sid)
    for k, d in enumerate(sorted(drops, key=lambda d: (order.index(d["src"]), d["a"]))):
        d["id"] = "%s:%s:%.2f" % (d["kind"][0], d["src"], d["a"])
    drops.sort(key=lambda d: (order.index(d["src"]), d["a"]))

    for sid in order:
        s, pl, _ = plans[sid]
        fps = float(s.get("fps") or 25)
        dur = float(s["b"]) - float(s["a"])
        active = [d for d in drops if d["src"] == sid and d["id"] not in ignore]
        keeps = subtract(pl["keeps"], active)
        if p["wordless"] and rel_words[sid]:
            keeps, gone = drop_wordless(keeps, rel_words[sid], active)
            pl["cuts"] += [{"a": round(a, 3), "b": round(b, 3), "kind": "noword", "dur": round(b - a, 3)} for a, b in gone]
        frames = snap(keeps, fps, dur, p["minPiece"])
        res.append({"id": sid, "keeps": frames, "cuts": pl["cuts"], "floor_db": pl["floor_db"], "lufs": pl.get("lufs"),
                    "speech_s": pl["speech_s"], "dur": round(dur, 3), "warn": pl["warn"],
                    "kept_s": round(sum(b - a for a, b in frames) / fps, 3),
                    "speech": pl["speech"], "gapf": pl["gapf"], "wave": pl["wave"], "wave_dt": pl["wave_dt"]})
    for d in drops:                              # back to media seconds for the panel and the markers
        a0 = float(next(s["a"] for s in srcs if str(s["id"]) == d["src"]))
        d["a"] = round(d["a"] + a0, 3)
        d["b"] = round(d["b"] + a0, 3)
        d["ignored"] = d["id"] in ignore
    by_id = {r["id"]: r for r in res}
    return {"sources": [by_id[str(s["id"])] for s in srcs if str(s["id"]) in by_id], "drops": drops, "params": p,
            "warn": text_warn}


def main():
    if np is None:
        print("RESULT " + json.dumps({"error": "numpy is missing"}), flush=True)
        sys.exit(2)
    req = json.loads(sys.stdin.read() or "{}")
    try:
        out = analyse(req)
    except Exception as e:
        print("RESULT " + json.dumps({"error": str(e)}), flush=True)
        sys.exit(1)
    print("RESULT " + json.dumps(out), flush=True)


if __name__ == "__main__":
    main()
