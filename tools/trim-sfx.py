#!/usr/bin/env python3
"""Cuts the downloaded Pixabay sounds so each one hits on the frame it is placed at (2026-11-11 SFX pass).

    python3 tools/trim-sfx.py [download folder]      (default /Volumes/work1, then ~/Downloads)

Every pick is cut by hand-measured times (ms, from tools' 10 ms RMS envelope of the downloaded file):
  start = just before the first audible energy (transients: the hit itself is the first frame; whooshes: where the
          rise starts, so the peak falls inside the text's motion), end = where the one event we want has died away.
Files that hold several events keep only the one that matches the animation (Soft UI Pop: the first of six pops;
Highlighter on Paper: one stroke, about the length of the box sweep; Glitch: the main burst, not the blip before it).
Output: sounds/original/<download name>.wav, 24-bit PCM at the source rate (lossless after the MP3 decode), with a
3 ms fade-in (no click) and a short fade-out. Re-run after re-downloading; library.json names stay the same.
"""
import glob
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ORIG = os.path.normpath(os.path.join(HERE, "..", "..", "El Subtitle Animator", "sounds", "original"))

# pixabay id: (start ms, end ms, fade-out ms, what / why)
CUTS = {
    "376896": (65, 800, 120, "cha-ching: register hit + coin tail"),
    "447487": (15, 1000, 250, "bass hit: transient on frame 0, natural decay"),
    "467466": (150, 400, 80, "clean pop: hit on frame 0"),
    "323580": (125, 300, 60, "bubble pop: hit on frame 0"),
    "383769": (185, 720, 120, "swoosh 015: rise from frame 0, peak ~9 frames in (mid slide)"),
    "631457": (285, 750, 120, "simple whoosh: rise from frame 0, peak ~7 frames in"),
    "115095": (205, 1000, 200, "twinkle: first shimmer on frame 0"),
    "561933": (125, 380, 80, "short swoosh: peak ~2 frames in"),
    "561929": (145, 260, 50, "quick whoosh: peak ~1 frame in"),
    "379079": (265, 1300, 200, "realistic whoosh: swell peaks ~17 frames in, as the letters settle"),
    "393908": (35, 185, 40, "single key: the key-down click only (key-up dropped)"),
    "147352": (145, 450, 80, "soft UI click: hit on frame 0"),
    "385295": (165, 470, 60, "highlighter: ONE stroke (~9 frames) out of seven, for the box sweep"),
    "483867": (150, 500, 80, "highlighter stroke for the underline draw"),
    "483868": (65, 300, 60, "short highlighter stroke for the soft marker"),
    "451414": (15, 950, 200, "fairy sparkle: glint on frame 0"),
    "451232": (25, 330, 60, "soft UI pop: the FIRST of six pops only"),
    "126517": (35, 450, 80, "soft interface click: hit on frame 0"),
    "316482": (45, 300, 60, "UI pop: hit on frame 0"),
    "379990": (85, 600, 150, "thud: impact on frame 0"),
    "547872": (15, 150, 40, "soft tap: hit on frame 0 (per row)"),
    "454861": (155, 480, 80, "swoosh 026: peak ~4 frames in (per row slide)"),
    "312910": (685, 1150, 100, "glitch: the main burst (skips the blip 0.4 s before it), lands with Blink at Start"),
}


def find(pid, dirs):
    for d in dirs:
        for p in sorted(glob.glob(os.path.join(d, "*-" + pid + ".mp3"))):
            return p
    return None


def main():
    dirs = [sys.argv[1]] if len(sys.argv) > 1 else ["/Volumes/work1", os.path.expanduser("~/Downloads")]
    for pid, (a, b, fo, why) in CUTS.items():
        src = find(pid, dirs)
        if not src:
            print("MISS %s  %s" % (pid, why))
            continue
        dur = (b - a) / 1000.0
        fo = min(fo, b - a) / 1000.0
        out = os.path.join(ORIG, os.path.splitext(os.path.basename(src))[0] + ".wav")
        af = "atrim=start=%.3f:end=%.3f,asetpts=PTS-STARTPTS,afade=t=in:d=0.003,afade=t=out:st=%.3f:d=%.3f" % (
            a / 1000.0, b / 1000.0, dur - fo, fo)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-af", af, "-c:a", "pcm_s24le", out], check=True)
        print("OK   %-58s %4d-%4d ms  %s" % (os.path.basename(out), a, b, why))
    glitch_bed(dirs)


# The Glitch effect runs for the whole clip, so its sound does too: a 20 s glitch texture made from the main burst
# (685-1450 ms) - the first piece is the burst as it is (the hit stays on frame 0), then pitch-shifted (+-3..8 %) and
# reversed copies in a fixed shuffled order, 25 ms crossfades, so it never sounds like a loop. The plugin cuts it to
# the glitched clip's length (library effectSfx.Glitch len 'clip'). Named so "*-312910.*" does not match it.
BED_SECONDS = 20.0


def glitch_bed(dirs):
    src = find("312910", dirs)
    if not src:
        print("MISS glitch bed (312910 not downloaded)")
        return
    out = os.path.join(ORIG, "kave_msri-glitch-bed-312910b.wav")
    sr = 48000
    # (pitch factor, reversed) per piece; the first is the untouched burst
    looks = [(1.0, False), (1.05, False), (0.95, True), (1.08, False), (0.97, False), (1.03, True), (0.92, False),
             (1.06, True), (1.0, True), (0.94, False), (1.04, False), (0.98, True)]
    piece = 0.765
    n = int(BED_SECONDS / (piece - 0.025)) + 2
    parts, labels = [], []
    for i in range(n):
        f, rev = looks[i % len(looks)] if i < len(looks) else looks[(i * 7) % len(looks)]
        chain = "[0:a]atrim=start=0.685:end=1.450,asetpts=PTS-STARTPTS,aresample=%d" % sr
        if f != 1.0:
            chain += ",asetrate=%d,aresample=%d" % (int(sr * f), sr)
        if rev:
            chain += ",areverse"
        chain += "[p%d]" % i
        parts.append(chain)
        labels.append("p%d" % i)
    cur = labels[0]
    for i, lab in enumerate(labels[1:], 1):
        nxt = "x%d" % i
        parts.append("[%s][%s]acrossfade=d=0.025:c1=tri:c2=tri[%s]" % (cur, lab, nxt))
        cur = nxt
    parts.append("[%s]atrim=end=%.3f,afade=t=in:d=0.003,afade=t=out:st=%.3f:d=0.3[out]" % (cur, BED_SECONDS, BED_SECONDS - 0.3))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-filter_complex", ";".join(parts), "-map", "[out]",
                    "-c:a", "pcm_s24le", out], check=True)
    print("OK   %-58s %.0f s glitch texture for clip-length Glitch sounds" % (os.path.basename(out), BED_SECONDS))


if __name__ == "__main__":
    main()
