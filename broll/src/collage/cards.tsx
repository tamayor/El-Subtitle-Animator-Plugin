// Collage b-roll templates: Background, PhotoCard, CardStack, DocumentCard, Medallion, DateTag, NameLabel, Callout,
// TitleCard. Drawn on a 1080-px-wide design canvas (CollageTrack scales it to the timeline). Everything handmade-looking
// is a parameter: seeded tilt, a shadow that deepens as a card lands, scale drift over the beat, ease-out entrances.
import React from 'react';
import { Easing, Img, OffthreadVideo, Sequence, interpolate } from 'remotion';
import { fontOf, type Brand } from './brand';
import { ILLUSTRATIONS } from './illustrations';
import { FONT, rand } from '../lib/common';
import { Grain } from '../lib/paper';

export const eo = Easing.out(Easing.cubic);
export const k01 = (t: number, a: number, b: number, e = eo) =>
    interpolate(t, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: e });

// 'hand' motion (brand.motion): see brand.ts.
export const isHand = (b: Brand) => b.motion === 'hand';
export const settleScale = (t: number, b: Brand) => {
    const S = b.settle ?? 1.1;
    return S - (S - 1) * k01(t, 0, b.settleFrames ?? 10, Easing.out(Easing.quad));
};
// Hold each drawing for `step` frames from the beat start (stop motion on twos). Cuts still land on exact frames:
// only the time inside a beat is stepped.
export const stepT = (t: number, b: Brand) => {
    const s = isHand(b) ? Math.max(1, Math.round(b.step ?? 2)) : 1;
    return s > 1 ? Math.floor(t / s) * s : t;
};
// Wiggle (hand-drawn line boil): an SVG displacement filter whose noise changes every `every` frames, so a pen line
// keeps redrawing itself slightly differently. `amp` = displacement in screen px (divided by the zoom).
export const Wiggle: React.FC<{ id: string; t: number; zk?: number; amp?: number; every?: number }> = ({ id, t, zk = 1, amp = 7, every = 4 }) => (
    <defs>
        <filter id={id} filterUnits="userSpaceOnUse" x={-4000} y={-4000} width={8000} height={8000}>
            <feTurbulence type="fractalNoise" baseFrequency={0.022 * zk} numOctaves={2} seed={1 + (Math.floor(t / every) % 7)} result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale={amp / zk} xChannelSelector="R" yChannelSelector="G" />
        </filter>
    </defs>
);
export const wiggleId = (kind: string, seed: number) => `wig-${kind}-${String(seed).replace(/\W/g, '_')}`;

// A sketchy box around [x, y, w, h] (px), like a quick pen box: style 0 = four lines crossing past the corners,
// 1 = a loop drawn round twice, 2 = one pass with soft corners and the ends overlapping. One path; draw it on with
// pathLength 1.
export function roughBox(x: number, y: number, w: number, h: number, seed: number, style: number) {
    const r = (n: number) => rand(seed * 4.7 + n) - 0.5;
    const j = Math.min(w, h) * 0.14 + 8;   // how far each corner strays
    const P = (px: number, py: number, n: number) => [px + r(n) * j, py + r(n + 0.5) * j];
    const f = (v: number[]) => `${v[0].toFixed(1)} ${v[1].toFixed(1)}`;
    if (style === 0) {
        const o = Math.max(w, h) * 0.05 + 10;   // overshoot past the corners
        const seg = (a: number[], c: number[], n: number) => { const bend = P((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, n); return `M ${f(a)} Q ${f(bend)} ${f(c)}`; };
        return [
            seg(P(x - o, y, 1), P(x + w + o * 0.6, y, 2), 3),
            seg(P(x + w, y - o * 0.7, 4), P(x + w, y + h + o, 5), 6),
            seg(P(x + w + o * 0.5, y + h, 7), P(x - o, y + h, 8), 9),
            seg(P(x, y + h + o * 0.8, 10), P(x, y - o, 11), 12)
        ].join(' ');
    }
    const loop = (n: number) => {
        const c = [P(x, y, n), P(x + w, y, n + 1), P(x + w, y + h, n + 2), P(x, y + h, n + 3)];
        const rr = Math.min(w, h) * 0.05;      // soft corners
        const mid = (a: number[], b: number[], k: number) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
        let d = '';
        for (let i = 0; i < 4; i++) {
            const a = c[i], b = c[(i + 1) % 4], nx = c[(i + 2) % 4];
            const lb = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ln = Math.hypot(nx[0] - b[0], nx[1] - b[1]) || 1;
            const m0 = mid(a, b, 0.5), bw = r(n + 9 + i) * j * 1.4;   // each side bows a little
            const bend = [m0[0] + (b[1] - a[1]) / lb * bw, m0[1] - (b[0] - a[0]) / lb * bw];
            d += `${i === 0 ? `M ${f(mid(a, b, rr / lb))}` : ''} Q ${f(bend)} ${f(mid(a, b, 1 - rr / lb))} Q ${f(b)} ${f(mid(b, nx, rr / ln))}`;
        }
        return { d, c };
    };
    if (style === 1) {
        const a = loop(20), b = loop(40);
        return a.d + ' ' + b.d.replace(/^M/, 'L');
    }
    const a = loop(60);
    const over = [a.c[0][0] + w * 0.18, a.c[0][1] + r(70) * j];   // the end runs on past the start
    return a.d + ` L ${f(over)}`;
}

// Uneven lengths per mark, from a seed: base +- spread frames.
export const jitterLen = (base: number, spread: number, seed: number) => Math.max(4, Math.round(base + (rand(seed) - 0.5) * 2 * spread));

export type Overlay = { type: 'date' | 'label' | 'callout' | 'highlight' | 'title' | 'underline' | 'arrow' | 'arrows'; text?: string; sub?: string; at?: number;
    x?: number; y?: number; r?: number; rect?: number[]; rects?: number[][] };
export type Box = { w: number; h: number };

// Dark textured backdrop: warm charcoal, a vignette and grain.
export const Background: React.FC<{ b: Brand; H: number }> = ({ b, H }) => (
    <div style={{ position: 'absolute', left: 0, top: 0, width: 1080, height: H, overflow: 'hidden',
        background: `radial-gradient(ellipse 85% 60% at 50% 42%, #2c2925 0%, ${b.bg} 55%, ${b.bgEdge} 100%)` }}>
        <Grain id="collage-bg-grain" opacity={0.28} seed={4} />
        <svg width={1080} height={H} style={{ position: 'absolute', inset: 0, opacity: 0.08, mixBlendMode: 'screen' }}>
            <filter id="collage-bg-fibre"><feTurbulence type="fractalNoise" baseFrequency="0.012 0.06" numOctaves={3} seed={9} /><feColorMatrix type="saturate" values="0" /></filter>
            <rect width="100%" height="100%" filter="url(#collage-bg-fibre)" />
        </svg>
    </div>
);

// The motion every card shares: an ease-out slide from `from` (right / left / bottom), the seeded tilt, the drift.
export function cardMotion(t: number, D: number, seed: number, b: Brand, from: 'right' | 'left' | 'bottom', drift: string) {
    const sgn = rand(seed * 7.7) > 0.5 ? 1 : -1;
    const tilt = sgn * (b.tilt[0] + rand(seed * 3.1) * (b.tilt[1] - b.tilt[0]));
    if (isHand(b)) {
        // hard cut: the card is there on its first frame, a touch big, and settles to 100 %; then it holds still
        const s = settleScale(t, b);
        return { k: 1, transform: `rotate(${tilt}deg) scale(${s})`, shadow: '0 28px 52px rgba(0,0,0,.52)' };
    }
    const k = k01(t, 0, b.enter);
    const off = from === 'bottom' ? [0, 1400] : from === 'left' ? [-1200, 120] : [1200, 120];
    const d = Math.max(0, Math.min(1, t / Math.max(1, D)));
    const dx = drift === 'drift-left' ? -40 * d : drift === 'drift-right' ? 40 * d : 0;
    const dy = drift === 'drift-up' ? -40 * d : drift === 'drift-down' ? 40 * d : 0;
    const sc = (drift === 'none' ? 1 : 1 + b.drift * d) * (1 + (1 - k) * 0.06);
    return {
        k,
        transform: `translate(${off[0] * (1 - k) + dx}px, ${off[1] * (1 - k) + dy}px) rotate(${tilt + (1 - k) * sgn * 8}deg) scale(${sc})`,
        shadow: `0 ${10 + 18 * k}px ${16 + 36 * k}px rgba(0,0,0,${0.2 + 0.32 * k})`
    };
}

// Film-strip border (brand.border 'film'): dark rails with sprocket holes either side of the picture, a thin frame bar
// above and below, orange edge numbers. FILM_RAIL = the rail width (design px), taken off the picture's max width.
export const FILM_RAIL = 84;
const FILM_INK = '#211a14', FILM_HOLE = '#f1ebdf', FILM_EDGE = '#e39a2d';
export const FilmBorder: React.FC<{ box: Box; seed: number; shadow: string; edgeColor?: string }> = ({ box, seed, shadow, edgeColor }) => {
    const R = FILM_RAIL, bar = 22, ext = 34;                     // rails run a little past the frame bars
    const W = box.w + 2 * R, H = box.h + 2 * bar + 2 * ext;
    const hw = 28, hh = 21, pitch = 48, ho = 13;                 // sprocket hole size, spacing, gap to the outer edge
    const n = Math.floor(H / pitch), off = (H - n * pitch) / 2 + (pitch - hh) / 2;
    const holes = Array.from({ length: n }, (_, i) => off + i * pitch);
    const num = 1 + Math.floor(rand(seed * 1.9) * 30);           // a frame number on the edge, like the stock prints
    const edge: React.CSSProperties = { position: 'absolute', color: edgeColor || FILM_EDGE, fontFamily: FONT.sans, fontWeight: 800, fontSize: 20, letterSpacing: 1 };
    return (
        <div style={{ position: 'absolute', left: -R, top: -bar - ext, width: W, height: H, background: FILM_INK, boxShadow: shadow, borderRadius: 3 }}>
            {holes.map((y, i) => (
                <React.Fragment key={i}>
                    <div style={{ position: 'absolute', left: ho, top: y, width: hw, height: hh, borderRadius: 5, background: FILM_HOLE }} />
                    <div style={{ position: 'absolute', right: ho, top: y, width: hw, height: hh, borderRadius: 5, background: FILM_HOLE }} />
                </React.Fragment>
            ))}
            <div style={{ ...edge, left: W - R + 6, top: ext + bar + 10, transform: 'rotate(90deg) translateY(-100%)', transformOrigin: 'left top' }}>{num}</div>
            <div style={{ ...edge, left: W - R + 6, top: ext + bar + box.h * 0.55, transform: 'rotate(90deg) translateY(-100%)', transformOrigin: 'left top' }}>{num}A ▷</div>
            <div style={{ ...edge, left: R - 30, top: ext + bar + box.h - 34, transform: 'rotate(-90deg)', transformOrigin: 'center' }}>{num}</div>
        </div>
    );
};
// The picture's border, as the brand asks: the film strip, or the plain card colour.
const CardBorder: React.FC<{ b: Brand; box: Box; seed: number; shadow: string }> = ({ b, box, seed, shadow }) => {
    if (b.border === 'film') return <FilmBorder box={box} seed={seed} shadow={shadow} edgeColor={b.filmEdge} />;
    const B = b.cardBorderPx;
    return <div style={{ position: 'absolute', left: -B, top: -B, right: -B, bottom: -B, background: b.cardBorder, borderRadius: 4, boxShadow: shadow }} />;
};

// Picture inside a box, optionally cropped (crop = [x0, y0, x1, y1], 0..1 of the image).
export function fitBox(meta: { w: number; h: number } | undefined, crop: number[] | undefined, maxW: number, maxH: number): Box {
    const c = crop && crop.length === 4 ? crop : [0, 0, 1, 1];
    const a = ((meta?.w || 4) * (c[2] - c[0])) / ((meta?.h || 3) * (c[3] - c[1]));
    return a >= maxW / maxH ? { w: maxW, h: maxW / a } : { w: maxH * a, h: maxH };
}
// A video clip in a card: it plays from `trim` (source frames) once the composition reaches frame `from` (the beat's
// start), muted; the panel's Collage pane picks the start point.
export type CardVideo = { from: number; trim: number };

const Picture: React.FC<{ src: string; box: Box; crop?: number[]; video?: CardVideo }> = ({ src, box, crop, video }) => {
    const c = crop && crop.length === 4 ? crop : [0, 0, 1, 1];
    const W = box.w / (c[2] - c[0]), H = box.h / (c[3] - c[1]);
    const style: React.CSSProperties = { position: 'absolute', width: W, height: H, left: -c[0] * W, top: -c[1] * H, objectFit: 'fill' };
    return (
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#ccc' }}>
            {video
                ? <Sequence from={video.from} layout="none"><OffthreadVideo src={src} muted trimBefore={Math.max(0, video.trim)} style={style} /></Sequence>
                : <Img src={src} style={style} />}
        </div>
    );
};

// Yellow circle drawn around (x, y) of the picture box (0..1), radius r (0..1 of the box width).
export const Callout: React.FC<{ box: Box; x: number; y: number; r: number; t: number; at: number; color: string; hand?: boolean; seed?: number }> = ({ box, x, y, r, t, at, color, hand, seed = 0 }) => {
    const k = hand ? k01(t, at, at + jitterLen(11, 3, seed + 0.4), Easing.out(Easing.quad)) : k01(t, at, at + 12, Easing.inOut(Easing.cubic));
    if (k <= 0) return null;
    const R = r * box.w, cx = x * box.w, cy = y * box.h, L = 2 * Math.PI * R * 1.12;
    const d = `M ${cx + R * 0.95} ${cy - R * 0.3} A ${R} ${R * 0.92} 0 1 1 ${cx + R * 0.9} ${cy - R * 0.42} L ${cx + R * 0.7} ${cy - R * 0.78}`;
    return (
        <svg width={box.w} height={box.h} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
            {hand && <Wiggle id={wiggleId('co', seed)} t={t} />}
            <g filter={hand ? `url(#${wiggleId('co', seed)})` : undefined}>
                <path d={d} fill="none" stroke={color} strokeWidth={10} strokeLinecap="round" strokeDasharray={L} strokeDashoffset={L * (1 - k)}
                    style={{ filter: 'drop-shadow(0 3px 4px rgba(0,0,0,.45))' }} />
            </g>
        </svg>
    );
};

// Small tilted tag ("1760s", "EARLY 1950s"), stamped onto the card's top-left corner.
export const DateTag: React.FC<{ text: string; t: number; at: number; b: Brand }> = ({ text, t, at, b }) => {
    const hand = isHand(b);
    // hand: stamped on (there at once, settling from 110 %); smooth: a springy pop
    const k = hand ? (t >= at ? 1 : 0) : k01(t, at, at + 8, Easing.out(Easing.back(1.6)));
    const sc = hand ? settleScale(t - at, { ...b, settleFrames: 4 }) : 1.25 - 0.25 * k;
    return k <= 0 ? null : (
        <div style={{ position: 'absolute', left: -26, top: -34, transform: `rotate(-4deg) scale(${sc})`, opacity: Math.min(1, k * 1.5),
            transformOrigin: 'left top', background: b.highlight, color: b.navy, fontFamily: fontOf(b, 'sans'), fontWeight: 800, fontSize: 44,
            letterSpacing: 3, padding: '10px 22px', borderRadius: 4, boxShadow: '0 6px 14px rgba(0,0,0,.4)', whiteSpace: 'nowrap' }}>{text}</div>
    );
};

// Black name label on the card's bottom-left ("LOUIS XIV"), revealed left to right.
export const NameLabel: React.FC<{ text: string; t: number; at: number; b: Brand; box: Box }> = ({ text, t, at, b, box }) => {
    const k = isHand(b) ? k01(t, at, at + jitterLen(6, 2, at + text.length)) : k01(t, at, at + 10);
    return k <= 0 ? null : (
        <div style={{ position: 'absolute', left: 28, top: box.h - 40, clipPath: `inset(0 ${(1 - k) * 100}% 0 0)`, background: b.labelBg,
            color: b.labelInk, fontFamily: fontOf(b, 'sans'), fontWeight: 800, fontSize: 40, letterSpacing: 3, padding: '10px 20px',
            boxShadow: '0 6px 14px rgba(0,0,0,.4)', whiteSpace: 'nowrap', transform: 'rotate(-1.5deg)' }}>{text}</div>
    );
};

// Hand-drawn doodle on a picture's words (rect = [x, y, w, h], 0..1 of the box): "underline" = a wobbly double-stroke
// line under them, "arrow" = a curved arrow coming in from the lower right and pointing at them. Drawn on like a pen
// over 12 frames from `at`; `zk` (the card's zoom right now) keeps the stroke the same thickness on screen.
export const Doodle: React.FC<{ kind: 'underline' | 'arrow'; rect: number[]; box: Box; t: number; at: number; color: string; zk?: number; hand?: boolean; seed?: number }> = ({ kind, rect, box, t, at, color, zk = 1, hand, seed = 0 }) => {
    // hand: a pen stroke, fast off the mark and slowing, its length uneven per doodle
    const k = hand ? k01(t, at, at + jitterLen(10, 3, seed + 1.7), Easing.out(Easing.quad)) : k01(t, at, at + 12, Easing.inOut(Easing.cubic));
    if (k <= 0 || !rect || rect.length !== 4) return null;
    const [x, y, w, h] = [rect[0] * box.w, rect[1] * box.h, rect[2] * box.w, rect[3] * box.h];
    const sw = (13 / zk) * (hand ? 0.85 + rand(seed * 5.3) * 0.3 : 1);
    let d: string, head = '';
    if (kind === 'underline') {
        const y0 = y + h + h * 0.18, x0 = x - w * 0.03, x1 = x + w * 1.03;
        d = `M ${x0} ${y0 + h * 0.06} C ${x0 + w * 0.3} ${y0 - h * 0.08}, ${x0 + w * 0.65} ${y0 + h * 0.12}, ${x1} ${y0 - h * 0.04}`
          + ` M ${x0 + w * 0.08} ${y0 + h * 0.26} C ${x0 + w * 0.4} ${y0 + h * 0.16}, ${x0 + w * 0.7} ${y0 + h * 0.3}, ${x1 - w * 0.06} ${y0 + h * 0.18}`;
    } else {
        const tx = x + w * 0.92, ty = y + h * 1.12;                    // the tip, just under the words' right end
        const sx = tx + 150 / zk, sy = ty + 230 / zk;                  // a fixed length on screen, whatever the zoom
        d = `M ${sx} ${sy} C ${sx + (30 / zk)} ${sy - (60 / zk)}, ${tx + (60 / zk)} ${ty + (40 / zk)}, ${tx} ${ty}`;
        const a = 36 / zk;
        head = `M ${tx + a * 0.15} ${ty + a * 1.05} L ${tx} ${ty} L ${tx + a * 1.05} ${ty + a * 0.2}`;
    }
    const L = 4000;
    return (
        <svg width={box.w} height={box.h} style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
            {hand && <Wiggle id={wiggleId('dd', seed)} t={t} zk={zk} />}
            <g filter={hand ? `url(#${wiggleId('dd', seed)})` : undefined}>
            {/* a white halo under the pen line keeps it readable on busy pictures */}
            <path d={d} fill="none" stroke="#fff" strokeOpacity={0.92} strokeWidth={sw * 2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={L} strokeDashoffset={L * (1 - k)} />
            {head && k > 0.85 && <path d={head} fill="none" stroke="#fff" strokeOpacity={0.92} strokeWidth={sw * 2} strokeLinecap="round" strokeLinejoin="round" opacity={(k - 0.85) / 0.15} />}
            <path d={d} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={L} strokeDashoffset={L * (1 - k)} />
            {head && k > 0.85 && <path d={head} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" opacity={(k - 0.85) / 0.15} />}
            </g>
        </svg>
    );
};

// A hand-written label ("COLORS") at (x, y) of the picture with arrows drawing out to each target [tx, ty] (0..1),
// one after another, each ending in an arrowhead. White halo under the strokes and the letters.
export const LabelArrows: React.FC<{ text: string; x: number; y: number; targets: number[][]; box: Box; t: number; at: number; color: string; zk?: number; hand?: boolean; seed?: number }> =
    ({ text, x, y, targets, box, t, at, color, zk = 1, hand, seed = 0 }) => {
        const kl = hand ? (t >= at ? 1 : 0) : k01(t, at, at + 8);
        if (kl <= 0) return null;
        const lx = x * box.w, ly = y * box.h, sw = 12 / zk, a = 34 / zk, fs = 92 / zk, L = 4000;
        const arrows = targets.map(([tx0, ty0], i) => {
            const tx = tx0 * box.w, ty = ty0 * box.h;
            // hand: arrows start at uneven gaps and draw at uneven speeds
            const a0 = hand ? at + 4 + targets.slice(0, i).reduce((s0, _, j) => s0 + jitterLen(6, 2, seed + j * 3.3), 0) : at + 6 + i * 6;
            const k = hand ? k01(t, a0, a0 + jitterLen(9, 3, seed + i * 2.9), Easing.out(Easing.quad)) : k01(t, at + 6 + i * 6, at + 18 + i * 6, Easing.inOut(Easing.cubic));
            if (k <= 0) return null;
            // start just outside the label, toward the target; a gentle sideways bow
            const dx = tx - lx, dy = ty - ly, len = Math.max(1, Math.hypot(dx, dy));
            const ux = dx / len, uy = dy / len;
            const sx = lx + ux * (fs * 1.6), sy = ly + uy * (fs * 0.75);
            const ex = tx - ux * (16 / zk), ey = ty - uy * (16 / zk);
            const bow = (i % 2 ? 1 : -1) * Math.min(120 / zk, len * 0.18);
            const cx = (sx + ex) / 2 - uy * bow, cy = (sy + ey) / 2 + ux * bow;
            const d = `M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}`;
            // arrowhead along the last segment (control point -> end)
            const hx = ex - cx, hy = ey - cy, hl = Math.max(1, Math.hypot(hx, hy)), vx = hx / hl, vy = hy / hl;
            const head = `M ${ex - vx * a - vy * a * 0.55} ${ey - vy * a + vx * a * 0.55} L ${ex} ${ey} L ${ex - vx * a + vy * a * 0.55} ${ey - vy * a - vx * a * 0.55}`;
            const hk = k > 0.85 ? (k - 0.85) / 0.15 : 0;
            return (
                <g key={i}>
                    <path d={d} fill="none" stroke="#fff" strokeOpacity={0.92} strokeWidth={sw * 2} strokeLinecap="round" strokeDasharray={L} strokeDashoffset={L * (1 - k)} />
                    {hk > 0 && <path d={head} fill="none" stroke="#fff" strokeOpacity={0.92} strokeWidth={sw * 2} strokeLinecap="round" strokeLinejoin="round" opacity={hk} />}
                    <path d={d} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeDasharray={L} strokeDashoffset={L * (1 - k)} />
                    {hk > 0 && <path d={head} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" opacity={hk} />}
                </g>
            );
        });
        return (
            <svg width={box.w} height={box.h} style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
                {hand && <Wiggle id={wiggleId('la', seed)} t={t} zk={zk} />}
                <g filter={hand ? `url(#${wiggleId('la', seed)})` : undefined}>
                {arrows}
                <text x={lx} y={ly + fs * 0.32} textAnchor="middle" fontFamily={FONT.hand} fontWeight={700} fontSize={fs} fill={color}
                    stroke="#fff" strokeWidth={10 / zk} paintOrder="stroke" strokeLinejoin="round" opacity={kl}
                    transform={`rotate(-6 ${lx} ${ly}) scale(${hand ? settleScale(t - at, { settle: 1.1, settleFrames: 4 } as Brand) : 0.8 + 0.2 * kl})`} style={{ transformOrigin: `${lx}px ${ly}px` }}>{text}</text>
                </g>
            </svg>
        );
    };

// The overlays a card carries, in the card's own coordinates (they tilt and drift with it).
const CardOverlays: React.FC<{ overlays: Overlay[]; box: Box; t: number; b: Brand; zk?: number }> = ({ overlays, box, t, b, zk }) => {
    const hand = isHand(b);
    return <>
        {overlays.map((o, i) => o.type === 'callout' ? <Callout key={i} box={box} x={o.x ?? 0.5} y={o.y ?? 0.4} r={o.r ?? 0.22} t={t} at={o.at ?? 16} color={b.highlight} hand={hand} seed={i + 1 + (o.at ?? 0)} />
            : o.type === 'arrows' ? <LabelArrows key={i} text={o.text || ''} x={o.x ?? 0.5} y={o.y ?? 0.8} targets={(o as any).targets || []} box={box} t={t} at={o.at ?? 16} color={b.labelBg} zk={zk} hand={hand} seed={i + 1 + (o.at ?? 0)} />
            : o.type === 'underline' || o.type === 'arrow' ? <Doodle key={i} kind={o.type} rect={o.rect || []} box={box} t={t} at={o.at ?? 16} color={b.labelBg} zk={zk} hand={hand} seed={i + 1 + (o.at ?? 0)} />
            : o.type === 'date' ? <DateTag key={i} text={o.text || ''} t={t} at={o.at ?? 8} b={b} />
            : o.type === 'label' ? <NameLabel key={i} text={o.text || ''} t={t} at={o.at ?? 12} b={b} box={box} />
            : null)}
    </>;
};

// White-bordered photo or painting, sliding in over the previous card.
export const PhotoCard: React.FC<{ src: string; box: Box; crop?: number[]; t: number; D: number; seed: number; b: Brand;
    from: 'right' | 'left' | 'bottom'; drift: string; overlays?: Overlay[]; cx?: number; cy?: number; video?: CardVideo }> =
    ({ src, box, crop, t, D, seed, b, from, drift, overlays = [], cx = 540, cy = 780, video }) => {
        const m = cardMotion(t, D, seed, b, from, drift);
        return (
            <div style={{ position: 'absolute', left: cx - box.w / 2, top: cy - box.h / 2, width: box.w, height: box.h, transform: m.transform }}>
                <CardBorder b={b} box={box} seed={seed} shadow={m.shadow} />
                <Picture src={src} box={box} crop={crop} video={video} />
                <CardOverlays overlays={overlays} box={box} t={t} b={b} />
            </div>
        );
    };

// 2 to 4 cards layered with an offset; the top card enters last.
const STACK_POS: Record<number, number[][]> = {
    1: [[0, 0]],
    2: [[-90, -190], [60, 70]],
    3: [[-70, -150], [80, -10], [-20, 150]],
    4: [[-70, -150], [80, -10], [-20, 150], [60, 260]]
};
export const CardStack: React.FC<{ srcs: string[]; boxes: Box[]; t: number; D: number; seed: number; b: Brand; drift: string;
    overlays?: Overlay[]; cy?: number }> = ({ srcs, boxes, t, D, seed, b, drift, overlays = [], cy = 780 }) => {
        const n = srcs.length, gap = 9;
        return (
            <>
                {srcs.map((s, i) => {
                    const ti = t - i * gap, [ox, oy] = (STACK_POS[n] || STACK_POS[4])[i] || [0, 0];
                    if (ti < 0) return null;
                    const top = i === n - 1;
                    return (
                        <PhotoCard key={i} src={s} box={boxes[i]} t={ti} D={D} seed={seed * 10 + i} b={b} drift={drift}
                            from={i % 2 ? 'left' : 'right'} cx={540 + ox} cy={cy + oy}
                            overlays={top ? overlays.map((o) => ({ ...o, at: (o.at ?? 8) })) : []} />
                    );
                })}
            </>
        );
    };

// A scan, post or tarpaulin with yellow highlighter sweeping over chosen lines (rects = [x, y, w, h], 0..1 of the
// picture), blurred boxes over what identifies someone (blurs: faces, names, logos; there from the first frame) and,
// with zoom, the picture easing in inside its frame onto that rect once the highlights are drawn.
// A highlighter mark. Hand: ragged, slightly crooked ends and a second lighter pass, like a real marker swipe.
const Highlighter: React.FC<{ x: number; y: number; w: number; h: number; k: number; color: string; hand: boolean; seed: number }> = ({ x, y, w, h, k, color, hand, seed }) => {
    if (k <= 0) return null;
    if (!hand) return <div style={{ position: 'absolute', left: x - 6, top: y - 4, width: (w + 12) * k, height: h + 8,
        background: color, opacity: 0.62, mixBlendMode: 'multiply', borderRadius: 3 }} />;
    const r = (n: number) => rand(seed * 9.1 + n);
    const hh = (h + 8) * (0.94 + r(1) * 0.12), W = (w + 12 + (r(2) - 0.5) * 14) * k;
    // ends in px so they stay ragged while the swipe grows
    const e = (n: number, m: number) => `${(r(n) * m).toFixed(1)}px`;
    const clip = `polygon(${e(3, 10)} ${e(4, 4)}, calc(100% - ${e(5, 9)}) 0, 100% ${e(6, 45)}, calc(100% - ${e(7, 7)}) 100%, ${e(8, 6)} calc(100% - ${e(9, 4)}), 0 ${e(10, 50)})`;
    const rot = (r(11) - 0.5) * 1.4;
    return (
        <div style={{ position: 'absolute', left: x - 6 + (r(12) - 0.5) * 6, top: y - 4 + (h + 8 - hh) / 2, width: W, height: hh,
            transform: `rotate(${rot}deg)`, transformOrigin: 'left center', mixBlendMode: 'multiply' }}>
            <div style={{ position: 'absolute', inset: 0, background: color, opacity: 0.62, clipPath: clip }} />
            <div style={{ position: 'absolute', left: 4, right: 10, top: hh * 0.18, height: hh * 0.62, background: color, opacity: 0.22, clipPath: clip }} />
        </div>
    );
};

// Hand highlight: a sketchy pen box drawn round the words (see roughBox), white halo under it, wiggling.
const SketchBox: React.FC<{ rect: number[]; box: Box; t: number; k: number; color: string; zk: number; seed: number }> = ({ rect, box, t, k, color, zk, seed }) => {
    if (k <= 0) return null;
    const pad = 16 / zk;
    const [x, y, w, h] = [rect[0] * box.w - pad, rect[1] * box.h - pad * 0.7, rect[2] * box.w + 2 * pad, rect[3] * box.h + 1.4 * pad];
    // crossed lines half the time (the reference's favourite), a double loop or a single pass otherwise
    const pick = rand(seed * 2.3), d = roughBox(x, y, w, h, seed, pick < 0.5 ? 0 : pick < 0.8 ? 1 : 2);
    const sw = 6 / zk, id = wiggleId('sb', seed);
    return (
        <svg width={box.w} height={box.h} style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
            <Wiggle id={id} t={t} zk={zk} amp={5} />
            <g filter={`url(#${id})`}>
                <path d={d} pathLength={1} fill="none" stroke="#fff" strokeOpacity={0.75} strokeWidth={sw * 1.7} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 1" strokeDashoffset={1 - k} />
                <path d={d} pathLength={1} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 1" strokeDashoffset={1 - k} />
            </g>
        </svg>
    );
};

// Spotlight: the picture darkens around the highlighted words (soft-edged holes), fading in with the first one.
const Spotlight: React.FC<{ box: Box; rects: number[][]; k: number; id: string }> = ({ box, rects, k, id }) => {
    if (k <= 0) return null;
    const pad = Math.max(24, box.w * 0.03), soft = Math.max(18, box.w * 0.025);
    return (
        <svg width={box.w} height={box.h} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <defs>
                <filter id={`${id}-f`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation={soft} /></filter>
                <mask id={`${id}-m`} maskUnits="userSpaceOnUse" x={0} y={0} width={box.w} height={box.h}>
                    <rect width={box.w} height={box.h} fill="#fff" />
                    <g filter={`url(#${id}-f)`}>
                        {rects.map(([x, y, w, h], i) => <rect key={i} x={x * box.w - pad} y={y * box.h - pad} width={w * box.w + 2 * pad} height={h * box.h + 2 * pad} rx={pad} fill="#000" />)}
                    </g>
                </mask>
                <radialGradient id={`${id}-v`} cx="50%" cy="50%" r="75%"><stop offset="55%" stopColor="#000" stopOpacity={0} /><stop offset="100%" stopColor="#000" stopOpacity={0.35} /></radialGradient>
            </defs>
            <g opacity={k}>
                <rect width={box.w} height={box.h} fill="#000" opacity={0.58} mask={`url(#${id}-m)`} />
                <rect width={box.w} height={box.h} fill={`url(#${id}-v)`} />
            </g>
        </svg>
    );
};

// `at`: when the highlights draw. A number = the first one there, the next ones following on; a list = one start per
// highlight (each on its own word's frame).
export const DocumentCard: React.FC<{ src: string; box: Box; crop?: number[]; rects: number[][]; at: number | number[]; t: number; D: number;
    seed: number; b: Brand; drift: string; overlays?: Overlay[]; blurs?: number[][]; zoom?: number[] | null; zoomAt?: number; blurStrength?: number }> =
    ({ src, box, crop, rects, at, t, D, seed, b, drift, overlays = [], blurs = [], zoom, zoomAt, blurStrength = 50 }) => {
        const m = cardMotion(t, D, seed, b, 'bottom', drift);
        const hand = isHand(b);
        // each highlight's start and length: smooth = every 12 frames, 12 long; hand = per word (or uneven gaps), uneven lengths
        const lens = rects.map((_, i) => hand ? jitterLen(9, 3, seed * 3 + i * 1.9) : 12);
        const starts = rects.map((_, i) => Array.isArray(at) ? (at[i] ?? (at[at.length - 1] ?? 16) + lens[i] * (i - at.length + 1))
            : hand ? at + lens.slice(0, i).reduce((s0, l) => s0 + l + 2, 0) : at + i * 12);
        const lastHl = rects.length ? starts[rects.length - 1] + lens[rects.length - 1] : (Array.isArray(at) ? at[0] ?? 16 : at);
        // zoom: a punch-in once the highlights are drawn. The whole card grows (at most 3x) until the rect is ~88% of the
        // frame's width (or 45% of its height) and slides so the rect's centre lands where the card's centre was.
        let zt = '', zo = '', zk = 1;
        if (zoom && zoom.length === 4 && zoom[2] > 0 && zoom[3] > 0) {
            const z0 = zoomAt ?? lastHl + 4;
            // hand: a quick zoom that lands hard (ease out); smooth: a slow eased move
            const k = hand ? k01(t, z0, z0 + (b.zoomFrames ?? 10), Easing.out(Easing.cubic)) : k01(t, z0, z0 + 22, Easing.inOut(Easing.cubic));
            const S = 1 + (Math.min(3, Math.max(1, Math.min((0.88 * 1080) / (zoom[2] * box.w), 760 / (zoom[3] * box.h)))) - 1) * k;
            const cx = (zoom[0] + zoom[2] / 2) * box.w, cy = (zoom[1] + zoom[3] / 2) * box.h;
            zo = `${cx}px ${cy}px`;
            zt = `translate(${(box.w / 2 - cx) * k}px, ${(box.h / 2 - cy) * k}px) scale(${S})`;
            zk = S;
        }
        // blurStrength 50 = a 1/34-of-the-card-width blur (names unreadable, shapes kept); 100 = twice that
        const blurPx = Math.max(2, (box.w / 34) * (blurStrength / 50));
        // an SVG blur kept fully opaque (alpha set back to 1 after it): a CSS blur fades to transparent near the card's
        // edge and lets the sharp picture under it show through
        const fid = `doc-blur-${seed}`;
        return (
            <div style={{ position: 'absolute', left: 540 - box.w / 2, top: 780 - box.h / 2, width: box.w, height: box.h, transform: m.transform }}>
              <div style={{ position: 'absolute', inset: 0, transformOrigin: zo || undefined, transform: zt || undefined }}>
                <CardBorder b={b} box={box} seed={seed} shadow={m.shadow} />
                <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', inset: 0 }}>
                        <Picture src={src} box={box} crop={crop} />
                        {blurs.length > 0 && (
                            <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
                                <filter id={fid} x="0" y="0" width="1" height="1" colorInterpolationFilters="sRGB">
                                    <feGaussianBlur stdDeviation={blurPx} />
                                    <feComponentTransfer><feFuncA type="table" tableValues="1 1" /></feComponentTransfer>
                                </filter>
                            </svg>
                        )}
                        {blurs.map(([x, y, w, h], i) => (
                            <div key={'b' + i} style={{ position: 'absolute', left: x * box.w, top: y * box.h, width: w * box.w, height: h * box.h, overflow: 'hidden', borderRadius: 6 }}>
                                <div style={{ position: 'absolute', left: -x * box.w, top: -y * box.h, width: box.w, height: box.h, filter: `url(#${fid}) saturate(0.9)` }}>
                                    <Picture src={src} box={box} crop={crop} />
                                </div>
                            </div>
                        ))}
                        {!hand && rects.map(([x, y, w, h], i) => {
                            const k = k01(t, starts[i], starts[i] + lens[i], Easing.inOut(Easing.quad));
                            return <Highlighter key={i} x={x * box.w} y={y * box.h} w={w * box.w} h={h * box.h} k={k} color={b.highlight} hand={false} seed={seed + i * 1.31} />;
                        })}
                        {hand && rects.length > 0 && <Spotlight box={box} rects={rects} k={k01(t, starts[0], starts[0] + 8, Easing.out(Easing.quad))} id={`spot-${seed}`} />}
                    </div>
                </div>
                {hand && rects.map((r0, i) => (
                    <SketchBox key={'sb' + i} rect={r0} box={box} t={t} k={k01(t, starts[i], starts[i] + lens[i] + 4, Easing.out(Easing.quad))}
                        color={b.labelBg} zk={zk} seed={seed + i * 1.31} />
                ))}
                <CardOverlays overlays={overlays} box={box} t={t} b={b} zk={zk} />
              </div>
            </div>
        );
    };

// Cream (or teal) disc with paper texture; the illustration pops in inside it.
export const Medallion: React.FC<{ name: string; t: number; D: number; at: number[]; b: Brand; seed: number; drift: string; uid: string; size?: number;
    img?: string; imgAspect?: number; anchors?: Record<string, any> }> =
    ({ name, t, D, at, b, seed, drift, uid, size = 860, img, imgAspect, anchors }) => {
        const ill = ILLUSTRATIONS[name];
        const hand = isHand(b);
        // hand: cut in with the settle and hold still; smooth: a springy pop and a slow push-in
        const pop = hand ? 1 : k01(t, 0, b.enter, Easing.out(Easing.back(1.5)));
        const d = Math.max(0, Math.min(1, t / Math.max(1, D)));
        const sc = hand ? settleScale(t, b) : (0.55 + 0.45 * pop) * (drift === 'none' ? 1 : 1 + b.drift * 0.6 * d);
        const disc = ill?.tone === 'teal' ? b.teal : b.paper;
        const C = ill?.C;
        return (
            <div style={{ position: 'absolute', left: 540 - size / 2, top: 780 - size / 2, width: size, height: size,
                transform: `scale(${sc}) rotate(${(rand(seed) - 0.5) * 3}deg)`, opacity: Math.min(1, pop * 2) }}>
                <div style={{ position: 'absolute', inset: -12, borderRadius: '50%', background: '#f7f2e6', boxShadow: `0 ${16 + 20 * pop}px ${34 + 30 * pop}px rgba(0,0,0,.5)` }} />
                <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', overflow: 'hidden', background: disc }}>
                    <svg viewBox="0 0 1000 1000" width={size} height={size} style={{ position: 'absolute', inset: 0 }}>
                        {C ? <C t={t} D={D} at={at} brand={b} uid={uid} img={img} imgAspect={imgAspect} anchors={anchors} /> : null}
                    </svg>
                    <Grain id={`${uid}-grain`} opacity={0.22} seed={seed % 9 + 1} />
                    <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', boxShadow: 'inset 0 0 60px rgba(70,50,20,.28)' }} />
                </div>
            </div>
        );
    };

// Episode / chapter card over the talking head (no backdrop): a cream paper strip with the show and episode.
export const TitleCard: React.FC<{ text: string; sub?: string; t: number; at: number; until: number; b: Brand; cy: number }> = ({ text, sub, t, at, until, b, cy }) => {
    const hand = isHand(b);
    // hand: cut on with the settle, cut off; smooth: rises and fades
    const k = hand ? (t >= at ? 1 : 0) : k01(t, at, at + 12), out = hand ? (t < until ? 1 : 0) : 1 - k01(t, until, until + 8);
    if (k <= 0 || out <= 0) return null;
    const move = hand ? `scale(${settleScale(t - at, b)}) rotate(-2deg)` : `translateY(${(1 - k) * 80}px) rotate(-2deg)`;
    return (
        <div style={{ position: 'absolute', left: 0, width: 1080, top: cy, display: 'flex', justifyContent: 'center', opacity: out }}>
            <div style={{ transform: move, opacity: k, background: b.paper, padding: '26px 54px 22px',
                borderRadius: 6, boxShadow: '0 18px 40px rgba(0,0,0,.45)', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
                <div style={{ fontFamily: fontOf(b, 'serif'), fontSize: 104, lineHeight: 1, color: b.navy }}>{text}</div>
                {sub && <div style={{ fontFamily: fontOf(b, 'sans'), fontWeight: 800, fontSize: 34, letterSpacing: 8, color: b.orange, marginTop: 12 }}>{sub.toUpperCase()}</div>}
                <Grain id="collage-title-grain" opacity={0.2} seed={3} />
            </div>
        </div>
    );
};
