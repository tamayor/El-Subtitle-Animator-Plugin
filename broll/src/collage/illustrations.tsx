// Medallion illustrations, drawn as SVG from code (viewBox 0 0 1000 1000, centred in the medallion's circle) in the
// brand palette. Each one is animated by `t` (frames since its beat started), `D` (beat length) and `at` (frames of
// key words inside the beat, from shots.json beatsAt, in order), so its moments land on the spoken words.
// Add one: a component here + an entry in ILLUSTRATIONS (tone = the medallion's disc colour).
import React, { useEffect, useState } from 'react';
import { Easing, continueRender, delayRender, interpolate } from 'remotion';
import type { Brand } from './brand';
import { FONT, rand } from '../lib/common';

// img: a cut-out photo (transparent PNG) from the beat's assets, drawn instead of the drawn figure; imgAspect = w / h;
// anchors: where that photo's neck / shoulders / cuffs / arms are (shots.json assetAnchors[file]), over SUIT's defaults
export type Anchors = { neck?: number[]; shoulderY?: number; cuffY?: number; armL?: number; armR?: number };
export type IlluProps = { t: number; D: number; at: number[]; brand: Brand; uid: string; img?: string; imgAspect?: number; anchors?: Anchors };

// An SVG <image> does not hold the render like Remotion's <Img>, so wait until the picture has decoded.
function useDecoded(src?: string) {
    const [h] = useState(() => (src ? delayRender('medallion picture ' + src) : null));
    useEffect(() => {
        if (!src || h === null) return;
        const im = new Image();
        im.src = src;
        im.decode().then(() => continueRender(h), () => continueRender(h));
    }, [src, h]);
}

// ---- the real suit: a cut-out photo with a white sticker outline -------------------------------------------------
// Where its parts are, 0..1 of the cut-out (measured on the chosen picture: a front-view suit, arms down).
const SUIT = { neck: [0.5, 0.08], shoulderY: 0.13, cuffY: 0.44, armL: 0.27, armR: 0.73, h: 820 };
type SBox = { x: number; y: number; w: number; h: number };
const suitBox = (aspect = 0.4): SBox => { const h = SUIT.h, w = h * aspect; return { x: 500 - w / 2, y: 500 - h / 2, w, h }; };
const at01 = (s: SBox, nx: number, ny: number) => [s.x + nx * s.w, s.y + ny * s.h];

// The photo with its outline + shadow, and a mask of its shape (`${uid}-suit`, pulled in 8 px so a rim of the real
// suit stays visible around anything drawn inside it).
const RealSuit: React.FC<{ img: string; s: SBox; b: Brand; uid: string }> = ({ img, s, b, uid }) => (
    <>
        <defs>
            <filter id={`${uid}-sticker`} x="-25%" y="-10%" width="150%" height="120%" colorInterpolationFilters="sRGB">
                <feMorphology in="SourceAlpha" operator="dilate" radius={b.outline} result="fat" />
                <feFlood floodColor="#fbf8f1" />
                <feComposite in2="fat" operator="in" result="border" />
                <feDropShadow in="border" dx={0} dy={10} stdDeviation={12} floodColor="#000" floodOpacity={0.32} result="sh" />
                <feMerge><feMergeNode in="sh" /><feMergeNode in="border" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id={`${uid}-white`} x="-5%" y="-5%" width="110%" height="110%">
                <feMorphology in="SourceAlpha" operator="erode" radius={8} result="e" />
                <feFlood floodColor="#fff" />
                <feComposite in2="e" operator="in" />
            </filter>
            <mask id={`${uid}-suit`} maskUnits="userSpaceOnUse" x={0} y={0} width={1000} height={1000}>
                <image href={img} x={s.x} y={s.y} width={s.w} height={s.h} preserveAspectRatio="none" filter={`url(#${uid}-white)`} />
            </mask>
        </defs>
        <image href={img} x={s.x} y={s.y} width={s.w} height={s.h} preserveAspectRatio="none" filter={`url(#${uid}-sticker)`} />
    </>
);
const eo = Easing.out(Easing.cubic);
const k01 = (t: number, a: number, b: number, e = eo) => interpolate(t, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: e });

// ---- figure geometry (front view, centre x 500) ------------------------------------------------------------------
// Every part is a filled shape (limbs are capsule paths, not stroked lines) and there is no <g>, so the same shapes
// work inside a <clipPath>, which ignores strokes and groups.
type Limb = [number, number, number, number, number];   // x1 y1 x2 y2 width
const LIMBS: Limb[] = [
    [394, 324, 362, 468, 50], [362, 468, 346, 606, 42],      // left arm (a gap from the torso)
    [606, 324, 638, 468, 50], [638, 468, 654, 606, 42],      // right arm
    [462, 596, 456, 768, 76], [456, 768, 452, 898, 58],      // left leg
    [538, 596, 544, 768, 76], [544, 768, 548, 898, 58]       // right leg
];
const TORSO = 'M 420 298 Q 500 286 580 298 Q 606 304 608 330 L 592 450 Q 580 520 586 606 Q 500 632 414 606 Q 420 520 408 450 L 392 330 Q 394 304 420 298 Z';
const capsule = (x1: number, y1: number, x2: number, y2: number, w: number) => {
    const L = Math.hypot(x2 - x1, y2 - y1) || 1, r = Math.max(2, w / 2), nx = (-(y2 - y1) / L) * r, ny = ((x2 - x1) / L) * r;
    return `M ${x1 + nx} ${y1 + ny} L ${x2 + nx} ${y2 + ny} A ${r} ${r} 0 0 0 ${x2 - nx} ${y2 - ny} L ${x1 - nx} ${y1 - ny} A ${r} ${r} 0 0 0 ${x1 + nx} ${y1 + ny} Z`;
};

// The figure's shapes in one colour, `grow` px fatter (a sticker outline) or thinner (negative: an inner layer).
const figureShapes = (color: string, g: number, head: boolean) => {
    const s = g < 0 ? 1 + g / 100 : 1;
    return [
        head ? <ellipse key="h" cx={500} cy={204} rx={50 + g} ry={62 + g} fill={color} /> : null,
        <path key="n" d={head ? capsule(500, 250, 500, 304, 50 + 2 * g) : capsule(500, 264, 500, 304, 64 + 2 * g)} fill={color} />,
        ...LIMBS.map(([a, b, c, d, w], i) => <path key={i} d={capsule(a, b, c, d, w + 2 * g)} fill={color} />),
        <path key="t" d={TORSO} fill={color} stroke={g > 0 ? color : 'none'} strokeWidth={g > 0 ? 2 * g : 0} strokeLinejoin="round"
            transform={g < 0 ? `translate(500 455) scale(${s}) translate(-500 -455)` : undefined} />,
        <circle key="lh" cx={343} cy={634} r={Math.max(3, 24 + g)} fill={color} />,
        <circle key="rh" cx={657} cy={634} r={Math.max(3, 24 + g)} fill={color} />,
        <ellipse key="lf" cx={444} cy={922} rx={Math.max(3, 36 + g)} ry={Math.max(3, 19 + g)} fill={color} />,
        <ellipse key="rf" cx={556} cy={922} rx={Math.max(3, 36 + g)} ry={Math.max(3, 19 + g)} fill={color} />
    ];
};
const Figure: React.FC<{ color: string; grow?: number; head?: boolean; opacity?: number }> = ({ color, grow = 0, head = false, opacity = 1 }) =>
    <g opacity={opacity}>{figureShapes(color, grow, head)}</g>;

// A clip path holding the figure (for fills that stay inside it).
const FigureClip: React.FC<{ id: string; grow?: number; head?: boolean }> = ({ id, grow = 0, head = false }) => (
    <clipPath id={id}>{figureShapes('#000', grow, head)}</clipPath>
);

// The empty wetsuit: navy, lighter chest panel and knee pads, a dark neck opening and a white sticker outline.
const Wetsuit: React.FC<{ b: Brand; uid: string }> = ({ b, uid }) => (
    <g>
        <Figure color="#fbf8f1" grow={b.outline} />
        <Figure color={b.navy} />
        <g clipPath={`url(#${uid}-suit)`}>
            <path d="M 436 326 Q 500 314 564 326 L 556 450 Q 500 462 444 450 Z" fill={b.navyLight} />
            <rect x={428} y={736} width={56} height={64} rx={18} fill={b.navyLight} />
            <rect x={516} y={736} width={56} height={64} rx={18} fill={b.navyLight} />
            <path d="M 500 300 L 500 600" stroke="#33445f" strokeWidth={4} strokeDasharray="10 8" />
            <path d="M 392 450 Q 500 466 608 450" stroke="#33445f" strokeWidth={4} fill="none" />
        </g>
        <ellipse cx={500} cy={266} rx={30} ry={10} fill="#0c121c" />
    </g>
);

const Drop: React.FC<{ x: number; y: number; s?: number; color: string; opacity?: number }> = ({ x, y, s = 1, color, opacity = 1 }) => (
    <path d="M0,-24 C 10,-7 15,4 15,11 A 15 15 0 1 1 -15 11 C -15 4 -10,-7 0,-24 Z" fill={color} opacity={opacity}
        transform={`translate(${x} ${y}) scale(${s})`} />
);

// b02 "It isn't waterproof": drops fall through the suit and leave water inside it.
export const WetsuitDrops: React.FC<IlluProps> = (p) => {
    useDecoded(p.img);
    return p.img ? <WetsuitDropsReal {...p} img={p.img} /> : <WetsuitDropsDrawn {...p} />;
};
const WetsuitDropsReal: React.FC<IlluProps & { img: string }> = ({ t, brand: b, uid, img, imgAspect }) => {
    const s = suitBox(imgAspect);
    const drops = Array.from({ length: 9 }, (_, i) => ({ x: s.x + 20 + rand(i * 3.1 + 1) * (s.w - 40), at: i * 3, v: 34 + rand(i + 7) * 10 }));
    const spots = [[0.45, 0.24, 6], [0.62, 0.36, 10], [0.14, 0.3, 14], [0.86, 0.3, 9], [0.33, 0.66, 16], [0.66, 0.78, 12]];
    return (
        <g>
            <RealSuit img={img} s={s} b={b} uid={uid} />
            <g mask={`url(#${uid}-suit)`}>
                <g style={{ mixBlendMode: 'screen' }}>
                    {spots.map(([nx, ny, a], i) => { const [x, y] = at01(s, nx, ny); return <circle key={i} cx={x} cy={y} r={s.w * 0.24 * k01(t, a, a + 16)} fill={b.teal} />; })}
                </g>
            </g>
            {drops.map((d, i) => {
                const y = -40 + (t - d.at) * d.v;
                return t >= d.at && y < 1060 ? <Drop key={i} x={d.x} y={y} color={b.tealLight} opacity={y > s.y && y < s.y + s.h ? 0.6 : 1} /> : null;
            })}
        </g>
    );
};
const WetsuitDropsDrawn: React.FC<IlluProps> = ({ t, brand: b, uid }) => {
    const drops = Array.from({ length: 9 }, (_, i) => ({ x: 340 + rand(i * 3.1 + 1) * 320, at: i * 3, v: 34 + rand(i + 7) * 10 }));
    const spots = [[470, 400, 6], [530, 520, 10], [350, 520, 14], [650, 430, 9], [450, 820, 16], [560, 700, 12]];
    return (
        <g>
            <defs><FigureClip id={`${uid}-suit`} /><FigureClip id={`${uid}-in`} grow={-12} /></defs>
            <Wetsuit b={b} uid={uid} />
            <g clipPath={`url(#${uid}-in)`}>
                {spots.map(([x, y, a], i) => <circle key={i} cx={x} cy={y} r={70 * k01(t, a, a + 16)} fill={b.teal} opacity={0.85} />)}
            </g>
            {drops.map((d, i) => {
                const y = -40 + (t - d.at) * d.v;
                return t >= d.at && y < 1060 ? <Drop key={i} x={d.x} y={y} color={b.tealLight} opacity={y > 300 && y < 900 ? 0.55 : 1} /> : null;
            })}
        </g>
    );
};

// b04 "Down your neck, up your sleeves, right against your skin": water fills the suit in that order.
export const WaterFill: React.FC<IlluProps> = (p) => {
    useDecoded(p.img);
    return p.img ? <WaterFillReal {...p} img={p.img} /> : <WaterFillDrawn {...p} />;
};
const WaterFillReal: React.FC<IlluProps & { img: string }> = ({ t, D, at, brand: b, uid, img, imgAspect, anchors }) => {
    const s = suitBox(imgAspect), A = { ...SUIT, ...(anchors || {}) };
    const [neck = 12, sleeves = Math.round(D * 0.4), skin = Math.round(D * 0.85)] = at;
    const kNeck = k01(t, neck - 8, neck + 14), kSleeve = k01(t, sleeves - 8, sleeves + 16), kSkin = k01(t, skin - 30, skin + 4);
    const [nx, ny] = at01(s, A.neck[0], A.neck[1]);
    const cuff = s.y + A.cuffY * s.h, shoulder = s.y + A.shoulderY * s.h, up = (cuff - shoulder + 30) * kSleeve;
    const bottom = s.y + s.h + 30, level = bottom - (s.h + 80) * kSkin;
    const wave = `M ${s.x - 60} ${level} ` + Array.from({ length: 10 }, (_, i) => `q 20 ${i % 2 ? 12 : -12} 40 0`).join(' ') + ` L ${s.x + s.w + 60} 1000 L ${s.x - 60} 1000 Z`;
    return (
        <g>
            <defs>
                <mask id={`${uid}-m`} maskUnits="userSpaceOnUse" x={0} y={0} width={1000} height={1000}>
                    <rect width={1000} height={1000} fill="#000" />
                    <ellipse cx={nx} cy={ny} rx={s.w * 0.5 * kNeck} ry={s.h * 0.3 * kNeck} fill="#fff" />
                    <rect x={s.x - 30} y={cuff + 20 - up} width={A.armL * s.w + 30} height={up} fill="#fff" />
                    <rect x={s.x + A.armR * s.w} y={cuff + 20 - up} width={(1 - A.armR) * s.w + 30} height={up} fill="#fff" />
                    <path d={wave} fill="#fff" transform={`translate(${(t * 3) % 80 - 40} 0)`} />
                </mask>
            </defs>
            <RealSuit img={img} s={s} b={b} uid={uid} />
            <g mask={`url(#${uid}-suit)`}>
                <g mask={`url(#${uid}-m)`} style={{ mixBlendMode: 'screen' }}>
                    <rect width={1000} height={1000} fill={b.teal} />
                    {Array.from({ length: 12 }, (_, i) => (
                        <path key={i} d={`M ${s.x + ((i * 37 + t * 2) % s.w)} ${s.y + 60 + i * 62} q 14 -8 28 0 t 28 0`} stroke={b.tealLight} strokeWidth={5} fill="none" strokeLinecap="round" />
                    ))}
                </g>
            </g>
            {t >= neck - 10 && t < neck + 18 && [0, 1, 2].map((i) => <Drop key={i} x={nx - 18 + i * 18} y={s.y - 70 + (t - neck + 10) * 8 - i * 22} s={0.7} color={b.tealLight} />)}
        </g>
    );
};
const WaterFillDrawn: React.FC<IlluProps> = ({ t, D, at, brand: b, uid }) => {
    const [neck = 12, sleeves = Math.round(D * 0.4), skin = Math.round(D * 0.85)] = at;
    const kNeck = k01(t, neck - 8, neck + 14), kSleeve = k01(t, sleeves - 8, sleeves + 16), kSkin = k01(t, skin - 30, skin + 4);
    const wave = (y0: number, amp: number, ph: number) =>
        `M 200 ${y0} ` + Array.from({ length: 13 }, (_, i) => `Q ${225 + i * 50} ${y0 + (i % 2 ? amp : -amp)} ${250 + i * 50} ${y0}`).join(' ') + ` L 900 1000 L 200 1000 Z`;
    return (
        <g>
            <defs>
                <FigureClip id={`${uid}-suit`} />
                <FigureClip id={`${uid}-in`} grow={-13} />
                <mask id={`${uid}-m`}>
                    <rect width={1000} height={1000} fill="#000" />
                    <ellipse cx={500} cy={300} rx={130 * kNeck} ry={170 * kNeck} fill="#fff" />
                    {/* up the sleeves: from the wrists to the shoulders */}
                    <rect x={300} y={660 - 360 * kSleeve} width={110} height={360 * kSleeve} fill="#fff" />
                    <rect x={590} y={660 - 360 * kSleeve} width={110} height={360 * kSleeve} fill="#fff" />
                    {/* against the skin: the whole body, rising from the feet */}
                    <path d={wave(960 - 760 * kSkin, 14, t)} fill="#fff" transform={`translate(${(t * 3) % 50 - 25} 0)`} />
                </mask>
            </defs>
            <Wetsuit b={b} uid={uid} />
            <g clipPath={`url(#${uid}-in)`} mask={`url(#${uid}-m)`}>
                <rect width={1000} height={1000} fill={b.teal} />
                {Array.from({ length: 12 }, (_, i) => (
                    <path key={i} d={`M ${300 + ((i * 37 + t * 2) % 400)} ${280 + i * 55} q 18 -10 36 0 t 36 0`} stroke={b.tealLight} strokeWidth={5} fill="none" strokeLinecap="round" />
                ))}
            </g>
            {t >= neck - 10 && t < neck + 18 && [0, 1, 2].map((i) => <Drop key={i} x={482 + i * 18} y={170 + (t - neck + 10) * 9 - i * 22} s={0.7} color={b.tealLight} />)}
        </g>
    );
};

// b06 "How does a suit that lets the water in keep you warm?": a body in teal water, heat glowing out from its core.
// With a cut-out photo (the suit), the figure is that photo's exact silhouette in flat cream and the heat stays inside it.
export const HeatBody: React.FC<IlluProps> = (p) => {
    useDecoded(p.img);
    return p.img ? <HeatSuit {...p} img={p.img} /> : <HeatBodyDrawn {...p} />;
};
const HeatSuit: React.FC<IlluProps & { img: string }> = ({ t, D, brand: b, uid, img, imgAspect, anchors }) => {
    const s = suitBox(imgAspect), A = { ...SUIT, ...(anchors || {}) };
    const k = k01(t, 10, Math.max(30, D * 0.75), Easing.inOut(Easing.cubic));
    const pulse = 1 + Math.sin(t / 5) * 0.025 * k;
    const [cx, cy] = at01(s, 0.5, (A.shoulderY + A.cuffY) / 2);   // the chest
    const R = s.h * 0.62;
    return (
        <g>
            <defs>
                <filter id={`${uid}-flat`} x="-5%" y="-5%" width="110%" height="110%">
                    <feFlood floodColor={b.paper} />
                    <feComposite in2="SourceAlpha" operator="in" />
                </filter>
                <filter id={`${uid}-white`} x="-5%" y="-5%" width="110%" height="110%">
                    <feFlood floodColor="#fff" />
                    <feComposite in2="SourceAlpha" operator="in" />
                </filter>
                <mask id={`${uid}-shape`} maskUnits="userSpaceOnUse" x={0} y={0} width={1000} height={1000}>
                    <image href={img} x={s.x} y={s.y} width={s.w} height={s.h} preserveAspectRatio="none" filter={`url(#${uid}-white)`} />
                </mask>
                <radialGradient id={`${uid}-heat`} cx={cx} cy={cy} r={R} gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor={b.heat} />
                    <stop offset="0.3" stopColor={b.orange} />
                    <stop offset="0.62" stopColor="#ffc56e" />
                    <stop offset="1" stopColor="#ffe2b0" stopOpacity="0" />
                </radialGradient>
            </defs>
            {Array.from({ length: 16 }, (_, i) => (
                <path key={i} d={`M -40 ${i * 66 + 20} q 60 -12 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0`}
                    stroke={b.tealLight} strokeWidth={4} fill="none" opacity={0.35} transform={`translate(${-((t * 2 + i * 30) % 120)} 0)`} />
            ))}
            <image href={img} x={s.x} y={s.y} width={s.w} height={s.h} preserveAspectRatio="none" filter={`url(#${uid}-flat)`} />
            <g mask={`url(#${uid}-shape)`}>
                <circle cx={cx} cy={cy} r={R * k * pulse} fill={`url(#${uid}-heat)`} />
            </g>
        </g>
    );
};
const HeatBodyDrawn: React.FC<IlluProps> = ({ t, D, brand: b, uid }) => {
    const k = k01(t, 10, Math.max(30, D * 0.75), Easing.inOut(Easing.cubic));
    const pulse = 1 + Math.sin(t / 5) * 0.025 * k;
    return (
        <g>
            <defs>
                <FigureClip id={`${uid}-b`} head />
                <radialGradient id={`${uid}-heat`} cx={500} cy={430} r={480} gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor={b.heat} />
                    <stop offset="0.3" stopColor={b.orange} />
                    <stop offset="0.62" stopColor="#ffc56e" />
                    <stop offset="1" stopColor="#ffe2b0" stopOpacity="0" />
                </radialGradient>
            </defs>
            {Array.from({ length: 16 }, (_, i) => (
                <path key={i} d={`M -40 ${i * 66 + 20} q 60 -12 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0 t 120 0`}
                    stroke={b.tealLight} strokeWidth={4} fill="none" opacity={0.35} transform={`translate(${-((t * 2 + i * 30) % 120)} 0)`} />
            ))}
            <Figure color={b.paper} head />
            <g clipPath={`url(#${uid}-b)`}>
                <circle cx={500} cy={430} r={480 * k * pulse} fill={`url(#${uid}-heat)`} />
            </g>
        </g>
    );
};

// b11 "The wool kept them warm and the rubber kept the water out": a cross-section, water / rubber / wool / skin.
export const DryLayers: React.FC<IlluProps> = ({ t, D, at, brand: b, uid }) => {
    const [wool = 16, warm = 42, rubber = 62, out = Math.round(D * 0.9)] = at;
    const R0 = 390, R1 = 450, W1 = 690;   // rubber top / bottom, wool bottom
    const kWarm = k01(t, warm - 6, warm + 26);
    const tag = (txt: string, x: number, y: number, a: number, dark: boolean) => {
        const k = k01(t, a - 2, a + 7, Easing.out(Easing.back(2)));
        return k <= 0 ? null : (
            <g transform={`translate(${x} ${y}) scale(${k}) rotate(-3)`}>
                <rect x={-8} y={-34} width={txt.length * 30 + 36} height={64} rx={6} fill={dark ? b.labelBg : b.highlight} />
                <text x={10} y={12} fontFamily={FONT.sans} fontWeight={800} fontSize={40} letterSpacing={3} fill={dark ? b.labelInk : b.navy}>{txt}</text>
            </g>
        );
    };
    // drops fall onto the rubber and bounce off it, more of them on "out"
    const drops = [];
    for (let i = 0; i < 18; i++) {
        const s = i < 9 ? 40 + i * 6 : out - 14 + (i - 9) * 3, life = t - s;   // a burst of drops on "out"
        if (life < 0 || life > 24) continue;
        const x = 220 + rand(i * 5.3) * 560, fall = Math.min(life, 12);
        const y = life <= 12 ? 40 + fall * ((R0 - 60) / 12) : R0 - 30 - (life - 12) * 7;
        drops.push(<Drop key={i} x={x} y={y} s={0.8} color="#e7f6f7" opacity={life <= 12 ? 1 : 1 - (life - 12) / 12} />);
        if (life > 11 && life < 17) drops.push(<ellipse key={'s' + i} cx={x} cy={R0 - 4} rx={30 + (life - 11) * 6} ry={6} fill="none" stroke="#e7f6f7" strokeWidth={4} opacity={1 - (life - 11) / 6} />);
    }
    return (
        <g>
            <defs>
                <pattern id={`${uid}-knit`} width={34} height={30} patternUnits="userSpaceOnUse">
                    <path d="M 3 4 L 17 22 L 31 4" stroke="#c4ab80" strokeWidth={6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </pattern>
                <linearGradient id={`${uid}-warm`} x1="0" y1="1" x2="0" y2="0">
                    <stop offset="0" stopColor={b.heat} />
                    <stop offset="0.45" stopColor={b.orange} />
                    <stop offset="1" stopColor="#ffb25a" stopOpacity="0" />
                </linearGradient>
            </defs>
            <rect x={0} y={0} width={1000} height={R0} fill={b.teal} />
            {Array.from({ length: 6 }, (_, i) => (
                <path key={i} d={`M -60 ${70 + i * 52} q 50 -12 100 0 t 100 0 t 100 0 t 100 0 t 100 0 t 100 0 t 100 0 t 100 0 t 100 0 t 100 0 t 100 0`}
                    stroke={b.tealLight} strokeWidth={5} fill="none" opacity={0.5} transform={`translate(${-((t * 2.5 + i * 37) % 100)} 0)`} />
            ))}
            <rect x={0} y={R1} width={1000} height={W1 - R1} fill="#efe6d2" />
            <rect x={0} y={R1} width={1000} height={W1 - R1} fill={`url(#${uid}-knit)`} />
            <rect x={0} y={W1} width={1000} height={1000 - W1} fill={b.skin} />
            <rect x={0} y={R1 + (1 - kWarm) * (1000 - R1)} width={1000} height={1000} fill={`url(#${uid}-warm)`} opacity={0.78} />
            <rect x={0} y={R0} width={1000} height={R1 - R0} fill={b.navy} />
            <rect x={0} y={R0 + 8} width={1000} height={5} fill="#3b4c69" />
            {drops}
            {tag('WOOL', 150, 575, wool, true)}
            {tag('RUBBER', 150, 340, rubber, false)}
        </g>
    );
};

// "Today we're looking at the wetsuit": the suit on its own, swaying in, a name tag on the word.
export const WetsuitHero: React.FC<IlluProps> = ({ t, D, at, brand: b, uid, img, imgAspect }) => {
    useDecoded(img);
    const [word = Math.round(D * 0.7)] = at;
    const k = k01(t, word - 2, word + 8, Easing.out(Easing.back(2)));
    const sway = Math.sin(t / 9) * 1.5;
    return (
        <g>
            {img ? <g transform={`rotate(${sway} 500 520)`}><RealSuit img={img} s={suitBox(imgAspect)} b={b} uid={uid} /></g> : <>
                <defs><FigureClip id={`${uid}-suit`} /></defs>
                <g transform={`rotate(${sway} 500 520)`}><Wetsuit b={b} uid={uid} /></g>
            </>}
            {k > 0 && (
                <g transform={`translate(640 190) rotate(6) scale(${k})`}>
                    <rect x={-10} y={-40} width={300} height={74} rx={6} fill={b.highlight} />
                    <text x={140} y={12} textAnchor="middle" fontFamily={FONT.sans} fontWeight={800} fontSize={42} letterSpacing={3} fill={b.navy}>WETSUIT</text>
                </g>
            )}
        </g>
    );
};

export const ILLUSTRATIONS: Record<string, { tone: 'cream' | 'teal'; C: React.FC<IlluProps> }> = {
    'wetsuit-hero': { tone: 'cream', C: WetsuitHero },
    'wetsuit-drops': { tone: 'cream', C: WetsuitDrops },
    'water-fill': { tone: 'cream', C: WaterFill },
    'heat-body': { tone: 'teal', C: HeatBody },
    'dry-layers': { tone: 'cream', C: DryLayers }
};
