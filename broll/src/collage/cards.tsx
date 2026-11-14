// Collage b-roll templates: Background, PhotoCard, CardStack, DocumentCard, Medallion, DateTag, NameLabel, Callout,
// TitleCard. Drawn on a 1080-px-wide design canvas (CollageTrack scales it to the timeline). Everything handmade-looking
// is a parameter: seeded tilt, a shadow that deepens as a card lands, scale drift over the beat, ease-out entrances.
import React from 'react';
import { Easing, Img, OffthreadVideo, Sequence, interpolate } from 'remotion';
import type { Brand } from './brand';
import { ILLUSTRATIONS } from './illustrations';
import { FONT, rand } from '../lib/common';
import { Grain } from '../lib/paper';

export const eo = Easing.out(Easing.cubic);
export const k01 = (t: number, a: number, b: number, e = eo) =>
    interpolate(t, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: e });

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
    const k = k01(t, 0, b.enter);
    const sgn = rand(seed * 7.7) > 0.5 ? 1 : -1;
    const tilt = sgn * (b.tilt[0] + rand(seed * 3.1) * (b.tilt[1] - b.tilt[0]));
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
export const Callout: React.FC<{ box: Box; x: number; y: number; r: number; t: number; at: number; color: string }> = ({ box, x, y, r, t, at, color }) => {
    const k = k01(t, at, at + 12, Easing.inOut(Easing.cubic));
    if (k <= 0) return null;
    const R = r * box.w, cx = x * box.w, cy = y * box.h, L = 2 * Math.PI * R * 1.12;
    const d = `M ${cx + R * 0.95} ${cy - R * 0.3} A ${R} ${R * 0.92} 0 1 1 ${cx + R * 0.9} ${cy - R * 0.42} L ${cx + R * 0.7} ${cy - R * 0.78}`;
    return (
        <svg width={box.w} height={box.h} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
            <path d={d} fill="none" stroke={color} strokeWidth={10} strokeLinecap="round" strokeDasharray={L} strokeDashoffset={L * (1 - k)}
                style={{ filter: 'drop-shadow(0 3px 4px rgba(0,0,0,.45))' }} />
        </svg>
    );
};

// Small tilted tag ("1760s", "EARLY 1950s"), stamped onto the card's top-left corner.
export const DateTag: React.FC<{ text: string; t: number; at: number; b: Brand }> = ({ text, t, at, b }) => {
    const k = k01(t, at, at + 8, Easing.out(Easing.back(1.6)));
    return k <= 0 ? null : (
        <div style={{ position: 'absolute', left: -26, top: -34, transform: `rotate(-4deg) scale(${1.25 - 0.25 * k})`, opacity: Math.min(1, k * 1.5),
            transformOrigin: 'left top', background: b.highlight, color: b.navy, fontFamily: FONT.sans, fontWeight: 800, fontSize: 44,
            letterSpacing: 3, padding: '10px 22px', borderRadius: 4, boxShadow: '0 6px 14px rgba(0,0,0,.4)', whiteSpace: 'nowrap' }}>{text}</div>
    );
};

// Black name label on the card's bottom-left ("LOUIS XIV"), revealed left to right.
export const NameLabel: React.FC<{ text: string; t: number; at: number; b: Brand; box: Box }> = ({ text, t, at, b, box }) => {
    const k = k01(t, at, at + 10);
    return k <= 0 ? null : (
        <div style={{ position: 'absolute', left: 28, top: box.h - 40, clipPath: `inset(0 ${(1 - k) * 100}% 0 0)`, background: b.labelBg,
            color: b.labelInk, fontFamily: FONT.sans, fontWeight: 800, fontSize: 40, letterSpacing: 3, padding: '10px 20px',
            boxShadow: '0 6px 14px rgba(0,0,0,.4)', whiteSpace: 'nowrap', transform: 'rotate(-1.5deg)' }}>{text}</div>
    );
};

// Hand-drawn doodle on a picture's words (rect = [x, y, w, h], 0..1 of the box): "underline" = a wobbly double-stroke
// line under them, "arrow" = a curved arrow coming in from the lower right and pointing at them. Drawn on like a pen
// over 12 frames from `at`; `zk` (the card's zoom right now) keeps the stroke the same thickness on screen.
export const Doodle: React.FC<{ kind: 'underline' | 'arrow'; rect: number[]; box: Box; t: number; at: number; color: string; zk?: number }> = ({ kind, rect, box, t, at, color, zk = 1 }) => {
    const k = k01(t, at, at + 12, Easing.inOut(Easing.cubic));
    if (k <= 0 || !rect || rect.length !== 4) return null;
    const [x, y, w, h] = [rect[0] * box.w, rect[1] * box.h, rect[2] * box.w, rect[3] * box.h];
    const sw = 13 / zk;
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
            {/* a white halo under the pen line keeps it readable on busy pictures */}
            <path d={d} fill="none" stroke="#fff" strokeOpacity={0.92} strokeWidth={sw * 2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={L} strokeDashoffset={L * (1 - k)} />
            {head && k > 0.85 && <path d={head} fill="none" stroke="#fff" strokeOpacity={0.92} strokeWidth={sw * 2} strokeLinecap="round" strokeLinejoin="round" opacity={(k - 0.85) / 0.15} />}
            <path d={d} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={L} strokeDashoffset={L * (1 - k)} />
            {head && k > 0.85 && <path d={head} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" opacity={(k - 0.85) / 0.15} />}
        </svg>
    );
};

// A hand-written label ("COLORS") at (x, y) of the picture with arrows drawing out to each target [tx, ty] (0..1),
// one after another, each ending in an arrowhead. White halo under the strokes and the letters.
export const LabelArrows: React.FC<{ text: string; x: number; y: number; targets: number[][]; box: Box; t: number; at: number; color: string; zk?: number }> =
    ({ text, x, y, targets, box, t, at, color, zk = 1 }) => {
        const kl = k01(t, at, at + 8);
        if (kl <= 0) return null;
        const lx = x * box.w, ly = y * box.h, sw = 12 / zk, a = 34 / zk, fs = 92 / zk, L = 4000;
        const arrows = targets.map(([tx0, ty0], i) => {
            const tx = tx0 * box.w, ty = ty0 * box.h;
            const k = k01(t, at + 6 + i * 6, at + 18 + i * 6, Easing.inOut(Easing.cubic));
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
                {arrows}
                <text x={lx} y={ly + fs * 0.32} textAnchor="middle" fontFamily={FONT.hand} fontWeight={700} fontSize={fs} fill={color}
                    stroke="#fff" strokeWidth={10 / zk} paintOrder="stroke" strokeLinejoin="round" opacity={kl}
                    transform={`rotate(-6 ${lx} ${ly}) scale(${0.8 + 0.2 * kl})`} style={{ transformOrigin: `${lx}px ${ly}px` }}>{text}</text>
            </svg>
        );
    };

// The overlays a card carries, in the card's own coordinates (they tilt and drift with it).
const CardOverlays: React.FC<{ overlays: Overlay[]; box: Box; t: number; b: Brand; zk?: number }> = ({ overlays, box, t, b, zk }) => (
    <>
        {overlays.map((o, i) => o.type === 'callout' ? <Callout key={i} box={box} x={o.x ?? 0.5} y={o.y ?? 0.4} r={o.r ?? 0.22} t={t} at={o.at ?? 16} color={b.highlight} />
            : o.type === 'arrows' ? <LabelArrows key={i} text={o.text || ''} x={o.x ?? 0.5} y={o.y ?? 0.8} targets={(o as any).targets || []} box={box} t={t} at={o.at ?? 16} color={b.labelBg} zk={zk} />
            : o.type === 'underline' || o.type === 'arrow' ? <Doodle key={i} kind={o.type} rect={o.rect || []} box={box} t={t} at={o.at ?? 16} color={b.labelBg} zk={zk} />
            : o.type === 'date' ? <DateTag key={i} text={o.text || ''} t={t} at={o.at ?? 8} b={b} />
            : o.type === 'label' ? <NameLabel key={i} text={o.text || ''} t={t} at={o.at ?? 12} b={b} box={box} />
            : null)}
    </>
);

// White-bordered photo or painting, sliding in over the previous card.
export const PhotoCard: React.FC<{ src: string; box: Box; crop?: number[]; t: number; D: number; seed: number; b: Brand;
    from: 'right' | 'left' | 'bottom'; drift: string; overlays?: Overlay[]; cx?: number; cy?: number; video?: CardVideo }> =
    ({ src, box, crop, t, D, seed, b, from, drift, overlays = [], cx = 540, cy = 780, video }) => {
        const m = cardMotion(t, D, seed, b, from, drift);
        const B = b.cardBorderPx;
        return (
            <div style={{ position: 'absolute', left: cx - box.w / 2, top: cy - box.h / 2, width: box.w, height: box.h, transform: m.transform }}>
                <div style={{ position: 'absolute', left: -B, top: -B, right: -B, bottom: -B, background: b.cardBorder, borderRadius: 4, boxShadow: m.shadow }} />
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
export const DocumentCard: React.FC<{ src: string; box: Box; crop?: number[]; rects: number[][]; at: number; t: number; D: number;
    seed: number; b: Brand; drift: string; overlays?: Overlay[]; blurs?: number[][]; zoom?: number[] | null; zoomAt?: number; blurStrength?: number }> =
    ({ src, box, crop, rects, at, t, D, seed, b, drift, overlays = [], blurs = [], zoom, zoomAt, blurStrength = 50 }) => {
        const m = cardMotion(t, D, seed, b, 'bottom', drift);
        const B = b.cardBorderPx;
        // zoom: a punch-in once the highlights are drawn. The whole card grows (at most 3x) until the rect is ~88% of the
        // frame's width (or 45% of its height) and slides so the rect's centre lands where the card's centre was.
        let zt = '', zo = '', zk = 1;
        if (zoom && zoom.length === 4 && zoom[2] > 0 && zoom[3] > 0) {
            const z0 = zoomAt ?? at + rects.length * 12 + 4;
            const k = k01(t, z0, z0 + 22, Easing.inOut(Easing.cubic));
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
                <div style={{ position: 'absolute', left: -B, top: -B, right: -B, bottom: -B, background: b.cardBorder, borderRadius: 4, boxShadow: m.shadow }} />
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
                        {rects.map(([x, y, w, h], i) => {
                            const k = k01(t, at + i * 12, at + i * 12 + 12, Easing.inOut(Easing.quad));
                            return <div key={i} style={{ position: 'absolute', left: x * box.w - 6, top: y * box.h - 4, width: (w * box.w + 12) * k, height: h * box.h + 8,
                                background: b.highlight, opacity: 0.62, mixBlendMode: 'multiply', borderRadius: 3 }} />;
                        })}
                    </div>
                </div>
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
        const pop = k01(t, 0, b.enter, Easing.out(Easing.back(1.5)));
        const d = Math.max(0, Math.min(1, t / Math.max(1, D)));
        const sc = (0.55 + 0.45 * pop) * (drift === 'none' ? 1 : 1 + b.drift * 0.6 * d);
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
    const k = k01(t, at, at + 12), out = 1 - k01(t, until, until + 8);
    if (k <= 0 || out <= 0) return null;
    return (
        <div style={{ position: 'absolute', left: 0, width: 1080, top: cy, display: 'flex', justifyContent: 'center', opacity: out }}>
            <div style={{ transform: `translateY(${(1 - k) * 80}px) rotate(-2deg)`, opacity: k, background: b.paper, padding: '26px 54px 22px',
                borderRadius: 6, boxShadow: '0 18px 40px rgba(0,0,0,.45)', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
                <div style={{ fontFamily: FONT.serif, fontSize: 104, lineHeight: 1, color: b.navy }}>{text}</div>
                {sub && <div style={{ fontFamily: FONT.sans, fontWeight: 800, fontSize: 34, letterSpacing: 8, color: b.orange, marginTop: 12 }}>{sub.toUpperCase()}</div>}
                <Grain id="collage-title-grain" opacity={0.2} seed={3} />
            </div>
        </div>
    );
};
