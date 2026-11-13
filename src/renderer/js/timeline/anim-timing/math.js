// Animation timing bar (js/timeline/anim-timing.js), the pure part: editing a range and snapping a pointer to the
// nearest magnet. No DOM: the lane's width and the pointer's x in it are passed in. Tested in test/renderer/anim-timing.test.js.
//
// A range r: { start, end, defStart, defEnd, hasStart } in frames of the clip (0..len).

// Puts one range's part ('s' start, 'e' end, 'm' move with the start at v) at frame v, within the clip (changes r).
function tmApply(r, part, v, len) {
    v = Math.round(v);
    if (part === 'm') {
        const d = r.end - r.start;
        r.start = Math.max(0, Math.min(len - d, v));
        r.end = r.start + d;
    } else if (part === 's') {
        r.start = Math.max(0, Math.min(r.end - 1, v));
    } else {
        r.end = Math.max(r.start + 1, Math.min(len, v));
    }
}

// The frame for pointer x (px of a lane `width` px wide), pulled to the nearest magnet within snapPx: the playhead, the
// preset's own start / end on this lane, and the heads of the other lanes. For a move ('m', grabbed `grab` frames
// after its start), the range's start or end may snap. info: { length, playhead, ranges }. Returns { frame, snap }.
function tmSnapFrame(px, width, info, laneIdx, part, grab, snapPx) {
    const i = info;
    const toPx = (f) => f / i.length * width;
    const r = i.ranges[laneIdx];
    let frame = Math.round(px / width * i.length) - (part === 'm' ? grab : 0);
    const marks = [];
    if (i.playhead != null) marks.push(['playhead', i.playhead]);
    marks.push(['default', part === 's' || part === 'm' ? r.defStart : r.defEnd]);
    if (part === 'm') marks.push(['default', r.defEnd]);
    i.ranges.forEach((o, n) => { if (n !== laneIdx) { if (o.hasStart) marks.push(['lane', o.start]); marks.push(['lane', o.end]); } });
    let snap = null, best = snapPx + 1;
    // a move snaps by its start or its end
    const edges = part === 'm' ? [[0, frame], [r.end - r.start, frame + (r.end - r.start)]] : [[0, frame]];
    for (const [off, at] of edges) {
        for (const [name, f] of marks) {
            const d = Math.abs(toPx(at) - toPx(f));
            if (d <= snapPx && d < best) { best = d; snap = name; frame = f - off; }
        }
    }
    return { frame, snap };
}
