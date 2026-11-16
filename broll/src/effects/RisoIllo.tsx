// Risograph-style illustrative animation for the Before 2028 backdrops (user, 2026-11-16: "never leave empty backdrop ...
// add a Risograph-style illustrative animation (hand: true, on twos, Matcha + Strawberry + Ink + Cream) that visually
// acts out the episode's topic instead of leaving an empty void"; reference = a 2-ink poster: a stack of matcha folders,
// a strawberry clock and rubber stamp, a winding queue of ink silhouettes with long flat shadows, halftone shading).
// Flat unshaded shapes, halftone dots for the shadows, a second ink printed slightly out of register. Everything moves
// on twos. Used by reason-scene through its `illo` prop: [{ kind, x, y, s, at, ...}] in frame pixels (1080 x 1920).
import React from 'react';

const INK = '#1c2738', PAPER = '#efe4cc', MATCHA = '#3f7f45', STRAW = '#c7385a';
const cl = (x: number) => Math.max(0, Math.min(1, x));
const ez = (x: number) => 1 - Math.pow(1 - cl(x), 3);
const two = (f: number) => Math.floor(f / 2) * 2;
const rnd = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export type IlloItem = { kind: string; x: number; y: number; s?: number; at?: number; w?: number; h?: number; n?: number; color?: string; flip?: boolean; text?: string };

// one silhouette with a long flat shadow falling to the lower right
const Person: React.FC<{ x: number; y: number; s: number; i: number; f: number; shadow?: string }> = ({ x, y, s, i, f, shadow = MATCHA }) => {
    const bob = ((Math.floor(f / 4) + i) % 2) * 2 * s;
    const lean = (rnd(i) - 0.5) * 6;
    const wide = 15 + rnd(i + 9) * 6, tall = 34 + rnd(i + 3) * 10;
    return (
        <g transform={`translate(${x} ${y - bob}) scale(${s})`}>
            <polygon points={`-8,0 8,0 ${70 + rnd(i) * 12},26 ${52 + rnd(i) * 12},32`} fill={shadow} opacity={0.9} />
            <g transform={`rotate(${lean})`}>
                <rect x={-wide / 2 + 1} y={-22} width={wide / 2 - 2} height={22} fill={INK} />
                <rect x={1} y={-22} width={wide / 2 - 2} height={22} fill={INK} />
                <rect x={-wide / 2} y={-22 - tall} width={wide} height={tall + 2} rx={5} fill={INK} />
                <circle cx={0} cy={-22 - tall - 9} r={8.5} fill={INK} />
                {rnd(i + 5) > 0.6 && <rect x={wide / 2 - 2} y={-22 - tall * 0.55} width={9} height={12} fill={INK} />}
            </g>
        </g>
    );
};

// a winding queue walking up the frame: the people shuffle forward one place every few frames
const Queue: React.FC<{ it: IlloItem; f: number }> = ({ it, f }) => {
    const n = it.n || 30, w = it.w || 760, h = it.h || 520, t0 = f - (it.at || 0);
    const phase = (Math.floor(t0 / 6) * 0.25) % 1;
    const pts = Array.from({ length: n }, (_, i) => {
        const t = (i + 1 - phase) / n;                         // 0 = head of the line (top), 1 = tail (bottom, nearest)
        const px = it.x + (it.flip ? -1 : 1) * w * 0.46 * Math.sin(t * Math.PI * 2.2 + 0.6) * (0.55 + 0.45 * t);
        const py = it.y + h * t;
        return { px, py, sc: (0.75 + 0.95 * t) * (it.s || 1), i };
    }).filter((p) => t0 >= 0 && p.i * 1.2 <= t0 + 4).sort((a, b) => a.py - b.py);
    return <g>{pts.map((p) => <Person key={p.i} x={p.px} y={p.py} s={p.sc} i={p.i} f={f} />)}</g>;
};

// a tall binder and a stack of folders that piles up on twos
const Folders: React.FC<{ it: IlloItem; f: number; id: string }> = ({ it, f, id }) => {
    const s = it.s || 1, t0 = f - (it.at || 0);
    if (t0 < 0) return null;
    const k = 1.08 - 0.08 * ez(two(t0) / 8);
    const layers = [MATCHA, PAPER, MATCHA, PAPER, MATCHA, INK, PAPER, MATCHA];
    return (
        <g transform={`translate(${it.x} ${it.y}) scale(${s * k})`}>
            <ellipse cx={60} cy={8} rx={330} ry={46} fill={`url(#${id}ht)`} />
            {/* the tall binder, printed with a strawberry plate slightly out of register */}
            <polygon points="-250,-10 -170,-470 20,-520 -30,-40" fill={STRAW} transform="translate(9 7)" />
            <polygon points="-250,-10 -170,-470 20,-520 -30,-40" fill={MATCHA} />
            <polygon points="-250,-10 -170,-470 -140,-478 -214,-14" fill={INK} />
            <circle cx={-196} cy={-300} r={9} fill={PAPER} />
            {[0, 1, 2, 3].map((j) => <line key={j} x1={-150 + j * 26} y1={-470 - j * 7} x2={-196 + j * 34} y2={-60 - j * 3} stroke={PAPER} strokeWidth={5} />)}
            {/* the stack: one folder lands every 4 frames */}
            {layers.map((c, j) => {
                const a = t0 - 6 - j * 4;
                if (a < 0) return null;
                const dy = (1 - ez(two(a) / 6)) * -60, tilt = (rnd(j + 2) - 0.5) * 7;
                return (
                    <g key={j} transform={`translate(${70 + (rnd(j) - 0.5) * 26} ${-30 - j * 40 + dy}) rotate(${tilt})`}>
                        <polygon points="-170,0 150,-22 190,18 -130,42" fill={c === PAPER ? MATCHA : STRAW} transform="translate(7 6)" opacity={c === INK ? 0 : 0.9} />
                        <polygon points="-170,0 150,-22 190,18 -130,42" fill={c} stroke={INK} strokeWidth={4} strokeLinejoin="round" />
                        {c === PAPER && [0, 1, 2].map((q) => <line key={q} x1={-120 + q * 8} y1={10 + q * 9} x2={140 + q * 8} y2={-10 + q * 9} stroke={INK} strokeWidth={2.5} opacity={0.55} />)}
                        {c === INK && <circle cx={150} cy={6} r={8} fill={PAPER} />}
                    </g>
                );
            })}
        </g>
    );
};

// a clock whose hands race round (the time you lose)
const Clock: React.FC<{ it: IlloItem; f: number; id: string }> = ({ it, f, id }) => {
    const s = it.s || 1, t0 = f - (it.at || 0);
    if (t0 < 0) return null;
    const k = 1.1 - 0.1 * ez(two(t0) / 8), m = two(t0) * 9, hr = two(t0) * 0.75 - 60;
    return (
        <g transform={`translate(${it.x} ${it.y}) scale(${s * k})`}>
            <circle cx={10} cy={8} r={150} fill={MATCHA} opacity={0.9} />
            <circle r={150} fill={PAPER} stroke={it.color || STRAW} strokeWidth={22} />
            <path d="M0 -150 A150 150 0 0 1 150 0 L0 0 Z" fill={`url(#${id}ht)`} opacity={0.5} />
            {Array.from({ length: 12 }, (_, j) => <line key={j} x1={0} y1={-124} x2={0} y2={j % 3 ? -106 : -92} stroke={it.color || STRAW} strokeWidth={j % 3 ? 6 : 10} transform={`rotate(${j * 30})`} />)}
            <line x1={0} y1={0} x2={0} y2={-70} stroke={INK} strokeWidth={12} strokeLinecap="round" transform={`rotate(${hr})`} />
            <line x1={0} y1={0} x2={0} y2={-112} stroke={INK} strokeWidth={7} strokeLinecap="round" transform={`rotate(${m})`} />
            <circle r={11} fill={INK} />
        </g>
    );
};

// a rubber stamp that comes down every second and leaves its mark
const Stamp: React.FC<{ it: IlloItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, t0 = f - (it.at || 0);
    if (t0 < 0) return null;
    const c = two(t0) % 30, down = c < 4 ? c / 4 : c < 8 ? 1 : c < 14 ? 1 - (c - 8) / 6 : 0;
    const hits = Math.floor((t0 + 22) / 30), col = it.color || STRAW;
    return (
        <g transform={`translate(${it.x} ${it.y}) scale(${s})`}>
            {hits > 0 && (
                <g transform="rotate(-7)" opacity={0.92}>
                    <rect x={-150} y={84} width={300} height={84} fill="none" stroke={col} strokeWidth={9} />
                    <text x={0} y={146} textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight={700} fontSize={56} letterSpacing={4} fill={col}>{it.text || 'DENIED'}</text>
                </g>
            )}
            <g transform={`translate(0 ${-150 + down * 150}) rotate(${-6 + down * 6})`}>
                <g transform="translate(9 7)" fill={MATCHA} opacity={0.9}><circle cx={0} cy={-250} r={66} /><rect x={-34} y={-220} width={68} height={150} /><rect x={-130} y={-80} width={260} height={74} rx={10} /></g>
                <circle cx={0} cy={-250} r={66} fill={col} /><rect x={-34} y={-220} width={68} height={150} fill={col} /><rect x={-130} y={-80} width={260} height={74} rx={10} fill={col} />
                <rect x={-130} y={-22} width={260} height={16} fill={INK} />
            </g>
        </g>
    );
};

// ID cards landing one on another
const Ids: React.FC<{ it: IlloItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, t0 = f - (it.at || 0), n = it.n || 2;
    return (
        <g transform={`translate(${it.x} ${it.y}) scale(${s})`}>
            {Array.from({ length: n }, (_, j) => {
                const a = t0 - j * 10;
                if (a < 0) return null;
                const k = 1.14 - 0.14 * ez(two(a) / 8), rot = [-7, 6, -2, 9][j % 4] + Math.sin(Math.floor(f / 4) * 1.7 + j) * 0.8, band = j % 2 ? STRAW : MATCHA;
                return (
                    <g key={j} transform={`translate(${(j - (n - 1) / 2) * 150} ${j * 34}) rotate(${rot}) scale(${k})`}>
                        <rect x={-190} y={-120} width={380} height={240} rx={18} fill={j % 2 ? MATCHA : STRAW} transform="translate(9 8)" />
                        <rect x={-190} y={-120} width={380} height={240} rx={18} fill={PAPER} stroke={INK} strokeWidth={5} />
                        <path d="M-190 -102 a18 18 0 0 1 18 -18 h344 a18 18 0 0 1 18 18 v38 h-380 Z" fill={band} />
                        <rect x={-160} y={-44} width={110} height={130} fill={INK} opacity={0.12} />
                        <circle cx={-105} cy={6} r={26} fill={INK} /><path d="M-150 86 q45 -64 90 0 Z" fill={INK} />
                        {[0, 1, 2, 3].map((q) => <rect key={q} x={-24} y={-34 + q * 30} width={q === 3 ? 110 : 180} height={12} fill={INK} opacity={0.75} />)}
                    </g>
                );
            })}
        </g>
    );
};

// an envelope sliding across, again and again (lagay)
const Envelope: React.FC<{ it: IlloItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, t0 = f - (it.at || 0);
    if (t0 < 0) return null;
    const c = two(t0) % 44, dx = -260 + ez(c / 16) * 520, rot = -8 + ez(c / 16) * 12;
    return (
        <g transform={`translate(${it.x} ${it.y}) scale(${s})`}>
            <rect x={-420} y={70} width={840} height={26} fill={INK} />
            <rect x={-420} y={96} width={840} height={150} fill={MATCHA} /><rect x={-420} y={96} width={840} height={150} fill="url(#illoht)" opacity={0.35} />
            <g transform={`translate(${dx} 0) rotate(${rot})`}>
                <rect x={-150} y={-90} width={300} height={180} fill={STRAW} transform="translate(9 8)" />
                <rect x={-150} y={-90} width={300} height={180} fill={PAPER} stroke={INK} strokeWidth={5} />
                <path d="M-150 -90 L0 20 L150 -90" fill="none" stroke={INK} strokeWidth={5} />
                <text x={0} y={72} textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight={700} fontSize={64} fill={STRAW}>₱</text>
            </g>
        </g>
    );
};

// Ep. 10 (absurd price estimates) kinds ------------------------------------------------------------------------------
// a bowl of rice with a ₱22 coin dropping in beside it: the coin is too small for the bowl (x, y = the bowl's rim)
const Rice: React.FC<{ it: IlloItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, t0 = f - (it.at || 0);
    if (t0 < 0) return null;
    const k = 1.08 - 0.08 * ez(two(t0) / 8), c = t0 - 10, cy = c < 0 ? -400 : -40 - (1 - ez(two(c) / 8)) * 160;
    const steam = Math.floor(f / 6) % 2;
    return (
        <g transform={`translate(${it.x} ${it.y}) scale(${s * k})`}>
            <ellipse cx={30} cy={160} rx={210} ry={22} fill="url(#illoht)" />
            {/* the rice mound, grains as small cream dashes */}
            <path d="M-150 0 Q-140 -110 0 -112 Q140 -110 150 0 Z" fill={PAPER} stroke={INK} strokeWidth={5} />
            {Array.from({ length: 22 }, (_, j) => <rect key={j} x={-110 + rnd(j) * 220} y={-90 + rnd(j + 40) * 80} width={14} height={6} rx={3} fill={INK} opacity={0.35} transform={`rotate(${rnd(j + 7) * 80 - 40} ${-110 + rnd(j) * 220} ${-90 + rnd(j + 40) * 80})`} />)}
            {/* the bowl, a strawberry plate out of register */}
            <path d="M-170 0 H170 Q160 150 0 150 Q-160 150 -170 0 Z" fill={MATCHA} transform="translate(9 8)" />
            <path d="M-170 0 H170 Q160 150 0 150 Q-160 150 -170 0 Z" fill={STRAW} stroke={INK} strokeWidth={5} />
            <path d="M-120 40 H120" stroke={PAPER} strokeWidth={8} strokeDasharray="22 14" />
            {[-50, 10, 70].map((x, j) => <path key={j} d={`M${x} -130 q${steam ? 14 : -14} -30 0 -60 q${steam ? -14 : 14} -30 0 -60`} fill="none" stroke={INK} strokeWidth={5} opacity={0.5} />)}
            {/* the coin */}
            {c >= 0 && (
                <g transform={`translate(240 ${cy}) rotate(${-10 + Math.sin(Math.floor(f / 4)) * 3})`}>
                    <circle r={66} fill={MATCHA} transform="translate(7 6)" />
                    <circle r={66} fill={PAPER} stroke={INK} strokeWidth={6} />
                    <circle r={50} fill="none" stroke={INK} strokeWidth={3} strokeDasharray="6 6" />
                    <text y={18} textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight={700} fontSize={50} fill={INK}>{it.text || '₱22'}</text>
                </g>
            )}
        </g>
    );
};

// a bar chart whose strawberry "food line" is pulled down: every bar above the line turns matcha = "not poor" on paper
// (x, y = the chart's centre; 600 x 400)
const Chart: React.FC<{ it: IlloItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, t0 = f - (it.at || 0);
    if (t0 < 0) return null;
    const hs = [150, 230, 120, 260, 190, 300, 170, 240];
    const ly = 200 - 290 + ez(two(t0 - 18) / 30) * 170;            // the line's height from the bottom: 290 -> 120
    const lineH = 200 - ly;
    return (
        <g transform={`translate(${it.x} ${it.y}) scale(${s})`}>
            <rect x={-300} y={-200} width={600} height={400} fill={STRAW} transform="translate(10 9)" />
            <rect x={-300} y={-200} width={600} height={400} fill={PAPER} stroke={INK} strokeWidth={5} />
            {hs.map((h, j) => {
                const g = ez(two(t0 - j * 2) / 8) * h, poor = h < lineH;
                return <g key={j}>
                    <rect x={-260 + j * 66} y={180 - g} width={46} height={g} fill={poor ? STRAW : MATCHA} stroke={INK} strokeWidth={4} />
                    {!poor && g > 30 && <rect x={-260 + j * 66} y={180 - g} width={46} height={g} fill="url(#illoht)" opacity={0.25} />}
                </g>;
            })}
            <line x1={-280} y1={180} x2={280} y2={180} stroke={INK} strokeWidth={6} />
            {/* the line, held by a hand-drawn tab at the right */}
            <line x1={-290} y1={ly} x2={290} y2={ly} stroke={INK} strokeWidth={8} strokeDasharray="26 14" />
            <g transform={`translate(212 ${ly - 64})`}>
                <rect x={0} y={0} width={120} height={52} fill={INK} transform="translate(6 5)" />
                <rect x={0} y={0} width={120} height={52} fill={STRAW} stroke={INK} strokeWidth={4} />
                <text x={60} y={38} textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight={700} fontSize={32} fill="#fff">{it.text || '₱64'}</text>
            </g>
        </g>
    );
};

// a receipt printing down out of a slot, items line by line, the total in strawberry at the end (x, y = the slot)
const Receipt: React.FC<{ it: IlloItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, t0 = f - (it.at || 0), H = it.h || 420;
    if (t0 < 0) return null;
    const len = Math.min(H, two(t0) * 12), rows = Math.floor((len - 40) / 34);
    return (
        <g transform={`translate(${it.x} ${it.y}) scale(${s})`}>
            <path d={`M-130 0 H130 V${len - 14} l-16 14 l-16 -14 l-16 14 l-16 -14 l-16 14 l-16 -14 l-16 14 l-16 -14 l-16 14 l-16 -14 l-16 14 l-16 -14 l-16 14 l-16 -14 l-16 14 l-16 -14 l-14 14 V0 Z`} fill={MATCHA} transform="translate(9 8)" />
            <path d={`M-130 0 H130 V${len - 14} l-16 14 l-16 -14 l-16 14 l-16 -14 l-16 14 l-16 -14 l-16 14 l-16 -14 l-16 14 l-16 -14 l-16 14 l-16 -14 l-16 14 l-16 -14 l-16 14 l-16 -14 l-14 14 V0 Z`} fill="#fbfaf6" stroke={INK} strokeWidth={4} />
            {Array.from({ length: Math.max(0, rows) }, (_, j) => {
                const last = (j + 1) * 34 + 60 > H;
                return last
                    ? <text key={j} x={0} y={40 + j * 34 + 14} textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight={700} fontSize={36} fill={STRAW}>{it.text || 'TOTAL ₱702.70'}</text>
                    : <g key={j}><rect x={-104} y={30 + j * 34} width={90 + rnd(j) * 70} height={10} fill={INK} opacity={0.7} /><rect x={50} y={30 + j * 34} width={54} height={10} fill={INK} opacity={0.7} /></g>;
            })}
            <rect x={-170} y={-34} width={340} height={40} rx={8} fill={INK} />
        </g>
    );
};

// a wage stack of coins rising, then a paper ("see? no need") slaps down on top and caps it (x, y = the stack's base)
const Coins: React.FC<{ it: IlloItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, t0 = f - (it.at || 0), n = it.n || 7;
    if (t0 < 0) return null;
    const cap = 30, shown = Math.min(n, Math.floor(two(t0) / 4) + 1), capped = t0 >= cap;
    const top = -shown * 34 - 20, py = capped ? top - 6 : top - 140 - (1 - ez(two(t0) / cap)) * 140;
    return (
        <g transform={`translate(${it.x} ${it.y}) scale(${s})`}>
            <ellipse cx={30} cy={30} rx={190} ry={22} fill="url(#illoht)" />
            {Array.from({ length: shown }, (_, j) => (
                <g key={j} transform={`translate(${(rnd(j) - 0.5) * 12} ${-j * 34})`}>
                    <ellipse cx={6} cy={8} rx={120} ry={28} fill={STRAW} />
                    <rect x={-120} y={-20} width={240} height={26} fill={MATCHA} stroke={INK} strokeWidth={4} />
                    <ellipse cx={0} cy={-20} rx={120} ry={26} fill={PAPER} stroke={INK} strokeWidth={4} />
                    <text y={-10} textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight={700} fontSize={30} fill={INK}>₱</text>
                </g>
            ))}
            {/* the official paper coming down on the stack */}
            <g transform={`translate(0 ${py}) rotate(${capped ? -3 : -9})`}>
                <rect x={-190} y={-110} width={380} height={110} fill={STRAW} transform="translate(9 8)" />
                <rect x={-190} y={-110} width={380} height={110} fill="#fbfaf6" stroke={INK} strokeWidth={5} />
                <text x={0} y={-42} textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight={700} fontSize={40} letterSpacing={2} fill={STRAW}>{it.text || 'NO RAISE'}</text>
            </g>
        </g>
    );
};

export const RisoIllo: React.FC<{ items: IlloItem[]; f: number }> = ({ items, f }) => (
    <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{ position: 'absolute', inset: 0 }}>
        <defs>
            <pattern id="illoht" width={9} height={9} patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><circle cx={4.5} cy={4.5} r={2.3} fill={INK} /></pattern>
        </defs>
        {items.map((it, i) => {
            switch (it.kind) {
                case 'queue': return <Queue key={i} it={it} f={f} />;
                case 'folders': return <Folders key={i} it={it} f={f} id="illo" />;
                case 'clock': return <Clock key={i} it={it} f={f} id="illo" />;
                case 'stamp': return <Stamp key={i} it={it} f={f} />;
                case 'ids': return <Ids key={i} it={it} f={f} />;
                case 'envelope': return <Envelope key={i} it={it} f={f} />;
                case 'rice': return <Rice key={i} it={it} f={f} />;
                case 'chart': return <Chart key={i} it={it} f={f} />;
                case 'receipt': return <Receipt key={i} it={it} f={f} />;
                case 'coins': return <Coins key={i} it={it} f={f} />;
                default: return null;
            }
        })}
    </svg>
);
