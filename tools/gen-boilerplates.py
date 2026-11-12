#!/usr/bin/env python3
"""Builds the two boilerplate presets the Create tab hands out ("Create using this"): src/boilerplates/.

  Text+ Boilerplate.comp       one Text+ (Template) + the Animation Frames retiming + one follower (Follower1) with a
                               plain fade-in on its Opacity (the spot to animate) + the output. Taken from Word Cascade.
  MultiText Boilerplate.comp   Upper / Emphasis / Lower rows with their own timing ranges (Seg1..3), the highlight box and
                               its colour / size / row controls, a gentle fade-and-rise per row. Taken from Pill Soft.

They are made from presets the plugin already ships, so they carry the same structure (Template tool, retiming, Inspector
controls, row and box controls) and the same fonts / palette. Run it again after those presets change:

    python3 tools/gen-boilerplates.py [folder with presets/original]

The default folder is the data folder next to the code (../El Subtitle Animator/presets/original).
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'src', 'boilerplates')
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', '..', 'El Subtitle Animator', 'presets', 'original')


def read(name):
    with open(os.path.join(SRC, name), encoding='utf8') as f:
        return f.read()


def block_end(s, open_at):
    d = 0
    for i in range(open_at, len(s)):
        if s[i] == '{':
            d += 1
        elif s[i] == '}':
            d -= 1
            if d == 0:
                return i
    raise ValueError('unbalanced braces')


def drop_tool(s, name):
    """Removes a top-level tool block `Name = Type { ... },` from a tool list."""
    m = re.search(r'\n\t\t' + re.escape(name) + r' = \w+ \{', s)
    if not m:
        raise ValueError('tool not found: ' + name)
    end = block_end(s, m.end() - 1)
    tail = end + 1
    if s[tail] == ',':
        tail += 1
    return s[:m.start()] + s[tail:]


def text_plus():
    s = read('Word Cascade (ML).comp')
    # the follower animated the word size; a plain fade-in on Opacity takes its place: the one thing to change
    s, n = re.subn(
        r'\t\t\t\tWordSizeX = Input \{\s*SourceOp = "Follower1WordSizeX",\s*Source = "Value",\s*\},\n'
        r'\t\t\t\tWordSizeY = Input \{\s*SourceOp = "Follower1WordSizeY",\s*Source = "Value",\s*\},\n',
        '\t\t\t\tOpacity1 = Input {\n\t\t\t\t\tSourceOp = "Follower1Opacity1",\n\t\t\t\t\tSource = "Value",\n\t\t\t\t},\n', s)
    assert n == 1, 'follower word size inputs not found'
    s = drop_tool(s, 'Follower1WordSizeX')
    s = drop_tool(s, 'Follower1WordSizeY')
    spline = ('\t\tFollower1Opacity1 = BezierSpline { CtrlWZoom = false,\n'
              '\t\t\tSplineColor = { Red = 180, Green = 120, Blue = 240 },\n'
              '\t\t\tKeyFrames = {\n'
              '\t\t\t\t[0] = { 0, RH = { 4, 0.6 } },\n'
              '\t\t\t\t[12] = { 1, LH = { 8, 1 } }\n'
              '\t\t\t}\n'
              '\t\t},\n')
    at = s.index('\t\tMediaOut1 = Saver')
    s = s[:at] + spline + s[at:]
    assert 'Word Cascade\\nWord Cascade' in s
    s = s.replace('Word Cascade\\nWord Cascade', 'Boilerplate text')
    return s


def multi_text():
    s = read('Pill Soft.setting')
    assert 'Template = MultiText' in s
    return s


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, body in (('Text+ Boilerplate.comp', text_plus()), ('MultiText Boilerplate.comp', multi_text())):
        path = os.path.join(OUT, name)
        with open(path, 'w', encoding='utf8') as f:
            f.write(body)
        print('wrote', os.path.relpath(path), len(body), 'bytes')


if __name__ == '__main__':
    main()
