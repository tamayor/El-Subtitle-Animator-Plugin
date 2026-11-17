// Risograph-style illustrative animation for the Before 2028 backdrops (user, 2026-11-16: "never leave empty backdrop ...
// add a Risograph-style illustrative animation (hand: true, on twos, Matcha + Strawberry + Ink + Cream) that visually
// acts out the episode's topic instead of leaving an empty void"; reference = a 2-ink poster: a stack of matcha folders,
// a strawberry clock and rubber stamp, a winding queue of ink silhouettes with long flat shadows, halftone shading).
// Flat unshaded shapes, halftone dots for the shadows, a second ink printed slightly out of register. Everything moves
// on twos. Used by reason-scene through its `illo` prop: [{ kind, x, y, s, at, ...}] in frame pixels (1080 x 1920).
import React from 'react';
import { kitScene, KitDefs, KitItem } from './RisoKit';

const INK = '#1c2738', PAPER = '#efe4cc', MATCHA = '#3f7f45', STRAW = '#c7385a';
const cl = (x: number) => Math.max(0, Math.min(1, x));
const ez = (x: number) => 1 - Math.pow(1 - cl(x), 3);
const two = (f: number) => Math.floor(f / 2) * 2;
const rnd = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export type IlloItem = { kind: string; x: number; y: number; s?: number; at?: number; w?: number; h?: number; n?: number; color?: string; flip?: boolean; text?: string; out?: number; steps?: number[] };

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
    // the mark's box grows with the word (user, Ep. 10: "the NOT POOR word is congested in box"): ~40 px per letter + padding
    const word = it.text || 'DENIED', bw = Math.max(300, word.length * 40 + 90);
    return (
        <g transform={`translate(${it.x} ${it.y}) scale(${s})`}>
            {hits > 0 && (
                <g transform="rotate(-7)" opacity={0.92}>
                    <rect x={-bw / 2} y={84} width={bw} height={84} fill="none" stroke={col} strokeWidth={9} />
                    <text x={0} y={146} textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight={700} fontSize={52} letterSpacing={3} fill={col}>{word}</text>
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

// Ep. 11 (politicians' 3-year power cycle) kinds ----------------------------------------------------------------------
const ARIAL = 'Arial, Helvetica, sans-serif';
const arc = (r: number, a0: number, a1: number) => {   // degrees, 0 = top, clockwise
    const p = (a: number) => [Math.sin(a * Math.PI / 180) * r, -Math.cos(a * Math.PI / 180) * r];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    return `M${x0} ${y0} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
};
// the 3-year term as a ring: YEAR 1 ink (silent), YEAR 2 matcha, YEAR 3 strawberry (the show); a hand sweeps round and
// stops on year 3 (x, y = centre; r 170). text = the word in the middle
const Cycle: React.FC<{ it: IlloItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, t0 = f - (it.at || 0);
    if (t0 < 0) return null;
    const k = 1.08 - 0.08 * ez(two(t0) / 8), segs = [[INK, 'YEAR 1'], [MATCHA, 'YEAR 2'], [STRAW, 'YEAR 3']];
    const hand = Math.min(300, two(t0) * 6);
    return (
        <g transform={`translate(${it.x} ${it.y}) scale(${s * k})`}>
            <circle cx={10} cy={9} r={196} fill={STRAW} opacity={0.85} />
            <circle r={196} fill={PAPER} stroke={INK} strokeWidth={5} />
            {segs.map(([c, lab], j) => {
                const on = t0 >= j * 8;
                if (!on) return null;
                const mid = j * 120 + 60, lx = Math.sin(mid * Math.PI / 180) * 152, ly = -Math.cos(mid * Math.PI / 180) * 152;
                return <g key={j}>
                    <path d={arc(152, j * 120 + 4, j * 120 + 116)} fill="none" stroke={c} strokeWidth={56} />
                    <text x={lx} y={ly + 9} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={24} fill="#fff" transform={`rotate(${mid > 90 && mid < 270 ? mid - 180 : mid} ${lx} ${ly})`}>{lab}</text>
                </g>;
            })}
            <circle r={96} fill="url(#illoht)" opacity={0.18} />
            <line x1={0} y1={0} x2={0} y2={-112} stroke={INK} strokeWidth={10} strokeLinecap="round" transform={`rotate(${hand})`} />
            <circle r={14} fill={INK} />
            {it.text && <text y={66} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={30} letterSpacing={2} fill={INK}>{it.text}</text>}
        </g>
    );
};
// a wall calendar: the days get crossed off on twos until the last one, election day, gets a strawberry pen circle
// (x, y = centre; 360 x 400). text = the circled day's label
const Calendar: React.FC<{ it: IlloItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, t0 = f - (it.at || 0);
    if (t0 < 0) return null;
    const k = 1.08 - 0.08 * ez(two(t0) / 8), crossed = Math.min(26, Math.floor(two(t0) / 2)), ring = t0 - 30;
    return (
        <g transform={`translate(${it.x} ${it.y}) scale(${s * k})`}>
            <rect x={-180} y={-190} width={360} height={390} fill={MATCHA} transform="translate(10 9)" />
            <rect x={-180} y={-190} width={360} height={390} fill="#fbfaf6" stroke={INK} strokeWidth={5} />
            <rect x={-180} y={-190} width={360} height={70} fill={STRAW} stroke={INK} strokeWidth={5} />
            <text x={0} y={-142} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={34} letterSpacing={3} fill="#fff">{it.color || 'MAY'}</text>
            {[-120, 120].map((x) => <rect key={x} x={x - 8} y={-206} width={16} height={40} rx={8} fill={INK} />)}
            {Array.from({ length: 28 }, (_, j) => {
                const cx = -175 + (j % 7) * 50 + 25, cy = -100 + Math.floor(j / 7) * 70 + 30;
                return <g key={j}>
                    <rect x={cx - 20} y={cy - 26} width={40} height={52} fill="none" stroke={INK} strokeWidth={2} opacity={0.35} />
                    {j < crossed && <path d={`M${cx - 15} ${cy - 18} L${cx + 15} ${cy + 18} M${cx + 15} ${cy - 18} L${cx - 15} ${cy + 18}`} stroke={INK} strokeWidth={5} strokeLinecap="round" opacity={0.8} />}
                    {j === 27 && <text x={cx} y={cy + 10} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={26} fill={STRAW}>12</text>}
                </g>;
            })}
            {ring >= 0 && <g>
                <ellipse cx={125} cy={180} rx={40 + 4 * Math.sin(Math.floor(f / 4))} ry={44} fill="none" stroke={STRAW} strokeWidth={8} transform="rotate(-8 125 180)" />
                <text x={125} y={268} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={28} letterSpacing={2} fill={STRAW}>{it.text || 'ELECTION DAY'}</text>
            </g>}
        </g>
    );
};
// a desk phone ringing and ringing, nobody picks up; the missed-call count goes up (x, y = centre). text = the label
const Phone: React.FC<{ it: IlloItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, t0 = f - (it.at || 0);
    if (t0 < 0) return null;
    const c = two(t0) % 24, ringing = c < 12, sh = ringing ? (Math.floor(f / 2) % 2 ? 5 : -5) : 0, missed = Math.floor(t0 / 24) + 1;
    return (
        <g transform={`translate(${it.x} ${it.y}) scale(${s})`}>
            <ellipse cx={20} cy={120} rx={200} ry={22} fill="url(#illoht)" />
            <g transform={`translate(${sh} 0)`}>
                <path d="M-150 110 L-110 -20 H110 L150 110 Z" fill={STRAW} transform="translate(9 8)" />
                <path d="M-150 110 L-110 -20 H110 L150 110 Z" fill={MATCHA} stroke={INK} strokeWidth={5} />
                {Array.from({ length: 9 }, (_, j) => <circle key={j} cx={-40 + (j % 3) * 40} cy={18 + Math.floor(j / 3) * 28} r={10} fill={PAPER} stroke={INK} strokeWidth={3} />)}
                <g transform={`translate(0 ${ringing ? -14 : 0}) rotate(${ringing ? sh : 0})`}>
                    <path d="M-150 -40 Q-150 -90 -100 -90 H100 Q150 -90 150 -40 L120 -30 Q110 -60 80 -58 H-80 Q-110 -60 -120 -30 Z" fill={INK} />
                </g>
            </g>
            {ringing && [0, 1].map((q) => <g key={q}>
                <path d={`M${-185 - q * 26} -110 q-20 50 0 100`} fill="none" stroke={STRAW} strokeWidth={7} strokeLinecap="round" />
                <path d={`M${185 + q * 26} -110 q20 50 0 100`} fill="none" stroke={STRAW} strokeWidth={7} strokeLinecap="round" />
            </g>)}
            <g transform="translate(0 175)">
                <rect x={-170} y={-28} width={340} height={56} fill={INK} transform="translate(6 5)" />
                <rect x={-170} y={-28} width={340} height={56} fill={STRAW} stroke={INK} strokeWidth={4} />
                <text y={12} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={30} fill="#fff">{(it.text || 'MISSED CALLS') + ': ' + missed}</text>
            </g>
        </g>
    );
};
// a phone screen chat: bubbles from them land one by one (text = "a|b|c", `w` = frames between bubbles, `n` = index of the
// first bubble shown big, as the payoff). The first bubble is always the grey "Seen" mark from me (x, y = screen centre)
const Chat: React.FC<{ it: IlloItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, t0 = f - (it.at || 0), gap = it.w || 24;
    if (t0 < 0) return null;
    const msgs = (it.text || 'Seen').split('|');
    // the thread scrolls up once the newest bubble would pass the screen's bottom (bubbles 96 apart, screen ends at y 250)
    const shown = msgs.filter((_, j) => t0 - j * gap >= 0).length, scroll = Math.max(0, -160 + (shown - 1) * 96 + 80 - 236);
    return (
        <g transform={`translate(${it.x} ${it.y}) scale(${s})`}>
            <rect x={-190} y={-290} width={380} height={580} rx={44} fill={STRAW} transform="translate(10 9)" />
            <rect x={-190} y={-290} width={380} height={580} rx={44} fill={INK} />
            <rect x={-170} y={-250} width={340} height={500} rx={18} fill="#fbfaf6" />
            <rect x={-170} y={-250} width={340} height={60} fill={MATCHA} />
            <circle cx={-130} cy={-220} r={18} fill={PAPER} /><rect x={-100} y={-230} width={120} height={14} fill={PAPER} />
            {msgs.map((m, j) => {
                const a = t0 - j * gap;
                if (a < 0) return null;
                const mine = it.n !== undefined ? j < it.n : j === 0, big = it.n !== undefined && j >= it.n, k = 1.15 - 0.15 * ez(two(a) / 6);
                const fs = big ? 40 : 28, w = Math.min(300, m.length * fs * 0.56 + 40), y = -160 + j * 96 - scroll, x = mine ? 150 - w : -150;
                if (y < -186) return null;
                return <g key={j} transform={`translate(${x + w / 2} ${y + 34}) scale(${k}) translate(${-x - w / 2} ${-y - 34})`}>
                    <rect x={x} y={y} width={w} height={big ? 76 : 64} rx={30} fill={mine ? '#dcd6c6' : big ? STRAW : MATCHA} stroke={INK} strokeWidth={3} />
                    <text x={x + w / 2} y={y + (big ? 52 : 42)} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={fs} fill={mine ? INK : '#fff'}>{m}</text>
                </g>;
            })}
        </g>
    );
};
// a twin-bell alarm clock going off: it hops and rattles on twos, ring lines burst out (x, y = clock centre). text = face
const Alarm: React.FC<{ it: IlloItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, t0 = f - (it.at || 0);   // drawn still before `at`, rings from `at`
    const on = t0 >= 0, sh = on ? (Math.floor(f / 2) % 2 ? 7 : -7) : 0, hop = on ? (Math.floor(f / 2) % 2) * -10 : 0;
    return (
        <g transform={`translate(${it.x} ${it.y}) scale(${s})`}>
            <ellipse cx={20} cy={180} rx={170} ry={20} fill="url(#illoht)" />
            <g transform={`translate(0 ${hop}) rotate(${sh * 0.6})`}>
                {[-1, 1].map((d) => <g key={d}>
                    <path d={`M${d * 70} -150 a64 64 0 0 1 ${d * 90} 60 Z`} fill={STRAW} stroke={INK} strokeWidth={5} transform={`rotate(${on ? sh * 2 : 0} ${d * 110} -120)`} />
                    <line x1={d * 90} y1={110} x2={d * 130} y2={170} stroke={INK} strokeWidth={14} strokeLinecap="round" />
                </g>)}
                <circle cx={10} cy={9} r={145} fill={MATCHA} />
                <circle r={145} fill={PAPER} stroke={INK} strokeWidth={8} />
                {Array.from({ length: 12 }, (_, j) => <line key={j} x1={0} y1={-120} x2={0} y2={j % 3 ? -106 : -96} stroke={INK} strokeWidth={j % 3 ? 5 : 9} transform={`rotate(${j * 30})`} />)}
                <text y={62} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={34} letterSpacing={2} fill={STRAW}>{it.text || '2028'}</text>
                {/* before `at` the long hand ticks the timer down (Ep11 every-2-seconds rule: never a still clock) */}
                <line x1={0} y1={0} x2={0} y2={-92} stroke={INK} strokeWidth={8} strokeLinecap="round" transform={on ? undefined : `rotate(${two(t0) * 15})`} />
                <line x1={0} y1={0} x2={52} y2={-20} stroke={INK} strokeWidth={11} strokeLinecap="round" />
                <circle r={11} fill={STRAW} />
            </g>
            {on && Math.floor(f / 4) % 2 === 0 && [-60, -30, 0, 30, 60].map((a) => <line key={a} x1={0} y1={-200} x2={0} y2={-236} stroke={STRAW} strokeWidth={8} strokeLinecap="round" transform={`rotate(${a})`} />)}
        </g>
    );
};
// a loudspeaker on a pole blasting: sound waves pulse out to the right (x, y = the horn's mouth centre)
const Speaker: React.FC<{ it: IlloItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, t0 = f - (it.at || 0);
    if (t0 < 0) return null;
    const k = 1.08 - 0.08 * ez(two(t0) / 8), ph = Math.floor(two(t0) / 4) % 3, d = it.flip ? -1 : 1;
    return (
        <g transform={`translate(${it.x} ${it.y}) scale(${d * s * k} ${s * k})`}>
            <rect x={-178} y={-10} width={22} height={170} fill={INK} />
            <path d="M-200 -40 H-140 L0 -120 V120 L-140 40 H-200 Z" fill={MATCHA} transform="translate(9 8)" />
            <path d="M-200 -40 H-140 L0 -120 V120 L-140 40 H-200 Z" fill={STRAW} stroke={INK} strokeWidth={5} strokeLinejoin="round" />
            <path d="M-140 -40 V40" stroke={INK} strokeWidth={5} />
            <ellipse cx={0} cy={0} rx={20} ry={120} fill={INK} />
            {[0, 1, 2].map((q) => {
                const on = (q + ph) % 3 !== 2;
                return on ? <path key={q} d={`M${50 + q * 50} ${-60 - q * 22} q${36 + q * 6} ${60 + q * 22} 0 ${120 + q * 44}`} fill="none" stroke={q === 1 ? STRAW : INK} strokeWidth={10} strokeLinecap="round" /> : null;
            })}
        </g>
    );
};

// a heart pumping lub-dub on twos (Ep. 11 "sudden kindness"), pulse lines flick out on each beat (x, y = centre, ~300 wide)
const HEART = 'M0 120 C-150 20 -140 -120 -60 -120 C-20 -120 0 -90 0 -65 C0 -90 20 -120 60 -120 C140 -120 150 20 0 120 Z';
const Heart: React.FC<{ it: IlloItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, t0 = f - (it.at || 0);
    if (t0 < 0) return null;
    const c = two(t0) % 18, beat = c < 2 ? 1.16 : c < 4 ? 1.02 : c < 6 ? 1.1 : 1, pulse = c < 6;
    return (
        <g transform={`translate(${it.x} ${it.y}) scale(${s})`}>
            <ellipse cx={14} cy={150} rx={150} ry={18} fill="url(#illoht)" />
            {pulse && [-50, -20, 20, 50].map((a) => <line key={a} x1={0} y1={-175} x2={0} y2={-205} stroke={STRAW} strokeWidth={9} strokeLinecap="round" transform={`rotate(${a})`} />)}
            <g transform={`scale(${beat})`}>
                <path d={HEART} fill={MATCHA} transform="translate(11 9)" />
                <path d={HEART} fill={it.color || STRAW} stroke={INK} strokeWidth={6} strokeLinejoin="round" />
                <path d="M-80 -78 C-110 -60 -112 -20 -96 6" fill="none" stroke="#fbfaf6" strokeWidth={12} strokeLinecap="round" opacity={0.85} />
                <path d={HEART} fill="url(#illoht)" opacity={0.18} transform="translate(30 30) scale(0.7)" />
                {it.text && <text y={20} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={34} letterSpacing={2} fill="#fff">{it.text}</text>}
            </g>
        </g>
    );
};

// ---- Ep. 12 (house-visit video trick) ----------------------------------------------------------------------------------
// a "humble" shirt (plain matcha tee + a tuyo pinned on it) on a hanger, swaying on twos; from frame `n` it gets lifted off
// and up out of the frame ("they take that costume off"). x, y = hook top; ~360 x 470. text = the tag on the hanger
const Hanger: React.FC<{ it: IlloItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, t0 = f - (it.at || 0);
    if (t0 < 0) return null;
    const k = 1.08 - 0.08 * ez(two(t0) / 8), sway = Math.sin(two(t0) / 7) * 4;
    const off = it.n !== undefined ? t0 - it.n : -1, lift = off >= 0 ? ez(two(off) / 10) * -200 : 0;
    const SHIRT = 'M-150 40 L-70 10 Q0 50 70 10 L150 40 L185 140 L120 160 L115 400 H-115 L-120 160 L-185 140 Z';
    return (
        <g transform={`translate(${it.x} ${it.y}) scale(${s * k})`}>
            <line x1={-190} y1={0} x2={190} y2={0} stroke={INK} strokeWidth={8} strokeLinecap="round" />
            <g transform={`translate(0 ${lift}) rotate(${sway})`} opacity={off >= 0 ? 1 - cl(two(off) / 8) : 1}>
                <path d="M0 0 q0 -22 18 -22 q18 0 18 18" fill="none" stroke={INK} strokeWidth={8} strokeLinecap="round" />
                <path d="M0 0 L-160 50 H160 Z" fill="none" stroke={INK} strokeWidth={8} strokeLinejoin="round" />
                <path d={SHIRT} fill={STRAW} transform="translate(10 9)" />
                <path d={SHIRT} fill={MATCHA} stroke={INK} strokeWidth={5} strokeLinejoin="round" />
                <path d="M-115 260 H115 V400 H-115 Z" fill="url(#illoht)" opacity={0.22} />
                {/* the tuyo pinned on like a badge */}
                <g transform="translate(-48 150) rotate(-18)">
                    <path d="M-50 0 Q-10 -26 40 0 L62 -18 L58 18 L40 0 Q-10 26 -50 0 Z" fill={PAPER} stroke={INK} strokeWidth={4} />
                    <circle cx={-34} cy={-3} r={4} fill={INK} />
                </g>
                {it.text && <g transform="translate(90 120) rotate(8)">
                    <rect x={-70} y={-20} width={140} height={44} fill={PAPER} stroke={INK} strokeWidth={3} />
                    <text y={11} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={22} letterSpacing={1} fill={STRAW}>{it.text}</text>
                </g>}
            </g>
        </g>
    );
};
// a front door: it stands open (a warm strawberry glow inside) and slams shut at `n`, rattling once; a knock-knock mark
// can sit on it (text). x, y = the door's bottom centre; ~300 x 470
const Door: React.FC<{ it: IlloItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, t0 = f - (it.at || 0);
    if (t0 < 0) return null;
    const shut = it.n !== undefined ? t0 - it.n : 0, open = shut < 0 ? 1 : 1 - ez(two(shut) / 4);
    const shake = shut >= 0 && shut < 8 ? (Math.floor(f / 2) % 2 ? 6 : -6) : 0;
    return (
        <g transform={`translate(${it.x + shake} ${it.y}) scale(${s})`}>
            <ellipse cx={30} cy={10} rx={230} ry={22} fill="url(#illoht)" />
            <rect x={-170} y={-470} width={340} height={470} fill={MATCHA} transform="translate(10 9)" />
            <rect x={-170} y={-470} width={340} height={470} fill={INK} />
            <rect x={-140} y={-440} width={280} height={440} fill={STRAW} />
            {/* the door leaf, hinged on the left: its width narrows as it swings open */}
            <g transform={`translate(-140 0) scale(${0.18 + 0.82 * (1 - open)} 1)`}>
                <rect x={0} y={-440} width={280} height={440} fill={PAPER} stroke={INK} strokeWidth={6} />
                <rect x={36} y={-400} width={208} height={150} fill="none" stroke={INK} strokeWidth={5} />
                <rect x={36} y={-210} width={208} height={170} fill="none" stroke={INK} strokeWidth={5} />
                <circle cx={244} cy={-230} r={14} fill={MATCHA} stroke={INK} strokeWidth={4} />
            </g>
            {/* the visitor walks up to the open door (walk cycle on twos) and steps inside just before it slams */}
            {it.n !== undefined && shut < -8 && (() => {
                const k2 = cl(two(t0) / Math.max(2, it.n - 10)), vx = 250 - 250 * ez(k2), step = Math.floor(f / 4) % 2;
                return <g transform={`translate(${vx} 0)`}>
                    <rect x={-22} y={-110} width={18} height={110} fill={INK} transform={`rotate(${step ? 10 : -10} -13 -110)`} />
                    <rect x={4} y={-110} width={18} height={110} fill={INK} transform={`rotate(${step ? -10 : 10} 13 -110)`} />
                    <rect x={-36} y={-250} width={72} height={146} rx={22} fill={INK} />
                    <path d="M-32 -244 L32 -130" stroke={STRAW} strokeWidth={14} />
                    <circle cx={0} cy={-284} r={32} fill={INK} />
                </g>;
            })()}
            {/* after the slam a CLOSED sign keeps swinging on its nail */}
            {shut >= 0 && (() => {
                const sw = [10, 4, -6, -10, -4, 6][Math.floor(f / 4) % 6] * (shut < 30 ? 1.6 : 1);
                return <g transform={`translate(0 -330) rotate(${sw})`}>
                    <line x1={-40} y1={0} x2={0} y2={-40} stroke={INK} strokeWidth={4} /><line x1={40} y1={0} x2={0} y2={-40} stroke={INK} strokeWidth={4} />
                    <circle cx={0} cy={-40} r={6} fill={INK} />
                    <rect x={-92} y={0} width={184} height={64} fill={INK} transform="translate(6 5)" />
                    <rect x={-92} y={0} width={184} height={64} fill={STRAW} stroke={INK} strokeWidth={4} />
                    <text y={44} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={36} letterSpacing={3} fill="#fff">CLOSED</text>
                </g>;
            })()}
            {shut >= 0 && shut < 10 && [-1, 1].map((d) => <g key={d}>{[0, 1].map((q) => <line key={q} x1={d * (200 + q * 30)} y1={-300 + q * 60} x2={d * (240 + q * 30)} y2={-320 + q * 60} stroke={STRAW} strokeWidth={8} strokeLinecap="round" />)}</g>)}
            {it.text && shut >= 0 && <text x={0} y={60} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={34} letterSpacing={3} fill={STRAW}>{it.text}</text>}
        </g>
    );
};
// a ballot box with ballots dropping in on twos and a tally of strokes counting up beside the slot
// (x, y = box bottom centre; ~360 x 380)
const Ballot: React.FC<{ it: IlloItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, t0 = f - (it.at || 0);
    if (t0 < 0) return null;
    const k = 1.08 - 0.08 * ez(two(t0) / 8), drop = two(t0) % 12, n = Math.min(14, Math.floor(t0 / 6));
    return (
        <g transform={`translate(${it.x} ${it.y}) scale(${s * k})`}>
            <ellipse cx={30} cy={8} rx={210} ry={20} fill="url(#illoht)" />
            <rect x={-170} y={-260} width={340} height={260} fill={STRAW} transform="translate(10 9)" />
            <rect x={-170} y={-260} width={340} height={260} fill="#fbfaf6" stroke={INK} strokeWidth={6} />
            <rect x={-170} y={-260} width={340} height={56} fill={MATCHA} stroke={INK} strokeWidth={6} />
            <rect x={-70} y={-238} width={140} height={14} rx={7} fill={INK} />
            <text x={0} y={-110} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={44} letterSpacing={4} fill={INK}>{it.text || 'BALOTA'}</text>
            {/* tally strokes in groups of five */}
            {Array.from({ length: n }, (_, j) => {
                const g = Math.floor(j / 5), q = j % 5, x0 = -130 + g * 92;
                return q < 4 ? <line key={j} x1={x0 + q * 16} y1={-70} x2={x0 + q * 16} y2={-24} stroke={STRAW} strokeWidth={6} strokeLinecap="round" />
                    : <line key={j} x1={x0 - 8} y1={-30} x2={x0 + 58} y2={-64} stroke={STRAW} strokeWidth={6} strokeLinecap="round" />;
            })}
            <g transform={`translate(0 ${-330 + Math.min(1, drop / 8) * 100})`} opacity={drop < 8 ? 1 : 0}>
                <rect x={-46} y={-60} width={92} height={110} fill={PAPER} stroke={INK} strokeWidth={4} transform="rotate(-6)" />
                <ellipse cx={-18} cy={-26} rx={12} ry={8} fill={INK} transform="rotate(-6)" />
                {[0, 1, 2].map((q) => <line key={q} x1={0} y1={-26 + q * 22} x2={30} y2={-28 + q * 22} stroke={INK} strokeWidth={3} transform="rotate(-6)" />)}
            </g>
        </g>
    );
};
// a phone playing the house-visit clip (a tiny house + a figure at its door), a play bar running, and a view counter
// climbing fast to `text` (e.g. "1.2M VIEWS"). x, y = screen centre; ~420 x 640
const Video: React.FC<{ it: IlloItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, t0 = f - (it.at || 0);
    if (t0 < 0) return null;
    const k = 1.08 - 0.08 * ez(two(t0) / 8), p = cl(two(t0) / (it.w || 90));
    const goal = parseFloat((it.text || '1.2M').replace(/[^0-9.]/g, '')) || 1.2, unit = /K/i.test(it.text || '') ? 'K' : 'M';
    const views = (goal * ez(p)).toFixed(unit === 'M' ? 1 : 0) + unit + ' VIEWS';
    return (
        <g transform={`translate(${it.x} ${it.y}) scale(${s * k})`}>
            <rect x={-210} y={-320} width={420} height={640} rx={48} fill={MATCHA} transform="translate(11 10)" />
            <rect x={-210} y={-320} width={420} height={640} rx={48} fill={INK} />
            <rect x={-186} y={-276} width={372} height={540} rx={18} fill="#fbfaf6" />
            {/* the clip: a tiny house, a figure at the door, a strawberry glow */}
            <rect x={-186} y={-276} width={372} height={300} fill={PAPER} />
            <path d="M-120 0 V-120 L-30 -190 L60 -120 V0 Z" fill={MATCHA} stroke={INK} strokeWidth={4} />
            <rect x={-58} y={-70} width={50} height={70} fill={STRAW} stroke={INK} strokeWidth={3} />
            <Person x={110} y={0} s={2.1} i={4} f={f} shadow={STRAW} />
            <path d="M-186 -276 H186 V24 H-186 Z" fill="url(#illoht)" opacity={0.08} />
            {t0 % 30 < 18 && <g transform="translate(0 -126)"><circle r={46} fill={INK} opacity={0.7} /><path d="M-14 -22 L24 0 L-14 22 Z" fill="#fff" /></g>}
            <rect x={-160} y={48} width={320} height={10} fill="#dcd6c6" />
            <rect x={-160} y={48} width={320 * p} height={10} fill={STRAW} />
            <circle cx={-160 + 320 * p} cy={53} r={12} fill={STRAW} />
            <text x={0} y={128} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={44} fill={INK}>{views}</text>
            <text x={0} y={190} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={30} fill={MATCHA}>{'♥ ' + Math.round(80 * ez(p)) + 'K   ↗ SHARE'}</text>
        </g>
    );
};
// a camera viewfinder: REC dot blinking, corner brackets framing a small house + a family at the table; text = the
// corner label (e.g. "AD #2028"). x, y = frame centre; w x h (default 700 x 420)
const Rec: React.FC<{ it: IlloItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, t0 = f - (it.at || 0);
    if (t0 < 0) return null;
    const w = it.w || 700, h = it.h || 420, k = 1.08 - 0.08 * ez(two(t0) / 8), c = 46;
    return (
        <g transform={`translate(${it.x} ${it.y}) scale(${s * k})`}>
            <rect x={-w / 2 + 40} y={-h / 2 + 50} width={w - 80} height={h - 100} fill={PAPER} />
            <path d={`M${-w / 2 + 40} ${h / 2 - 50} H${w / 2 - 40} V${h / 2 - 150} H${-w / 2 + 40} Z`} fill="url(#illoht)" opacity={0.18} />
            {/* the family at their table, the table itself a strawberry block */}
            <rect x={-150} y={40} width={300} height={34} fill={STRAW} stroke={INK} strokeWidth={4} />
            {[-110, -40, 40, 110].map((x, j) => <Person key={j} x={x} y={40} s={1.7} i={j + 11} f={f} />)}
            {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([dx, dy], j) =>
                <path key={j} d={`M${dx * w / 2} ${dy * (h / 2 - c)} V${dy * h / 2} H${dx * (w / 2 - c)}`} fill="none" stroke={INK} strokeWidth={9} strokeLinecap="round" />)}
            <line x1={-24} y1={0} x2={24} y2={0} stroke={INK} strokeWidth={3} opacity={0.5} /><line x1={0} y1={-24} x2={0} y2={24} stroke={INK} strokeWidth={3} opacity={0.5} />
            <g transform={`translate(${-w / 2 + 40} ${-h / 2 + 30})`}>
                {Math.floor(f / 12) % 2 === 0 && <circle cx={14} cy={0} r={14} fill={STRAW} />}
                <text x={40} y={13} fontFamily={ARIAL} fontWeight={700} fontSize={36} fill={INK}>REC</text>
            </g>
            {it.text && <text x={w / 2 - 40} y={-h / 2 + 43} textAnchor="end" fontFamily={ARIAL} fontWeight={700} fontSize={30} letterSpacing={2} fill={STRAW}>{it.text}</text>}
        </g>
    );
};
// a video camera on a tripod, then a strawberry slash strikes through it at `n` (no cameras). x, y = tripod foot centre
const CamOff: React.FC<{ it: IlloItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, t0 = f - (it.at || 0);
    if (t0 < 0) return null;
    const k = 1.08 - 0.08 * ez(two(t0) / 8), sl = it.n !== undefined ? cl(two(t0 - it.n) / 6) : 0;
    const BODY = 'M-150 -330 H70 V-190 H-150 Z';
    return (
        <g transform={`translate(${it.x} ${it.y}) scale(${s * k})`}>
            <ellipse cx={20} cy={8} rx={200} ry={20} fill="url(#illoht)" />
            {[-1, 0, 1].map((d) => <line key={d} x1={-40} y1={-190} x2={-40 + d * 140} y2={0} stroke={INK} strokeWidth={14} strokeLinecap="round" />)}
            <path d={BODY} fill={STRAW} transform="translate(10 9)" />
            <path d={BODY} fill={MATCHA} stroke={INK} strokeWidth={6} />
            <path d="M70 -300 L170 -340 V-180 L70 -220 Z" fill={INK} />
            <circle cx={-100} cy={-370} r={42} fill={PAPER} stroke={INK} strokeWidth={6} /><circle cx={10} cy={-370} r={42} fill={PAPER} stroke={INK} strokeWidth={6} />
            {sl === 0 && Math.floor(f / 12) % 2 === 0 && <circle cx={-120} cy={-300} r={12} fill={STRAW} />}
            {sl > 0 && <line x1={-230} y1={-440} x2={-230 + 460 * sl} y2={-440 + 470 * sl} stroke={STRAW} strokeWidth={sl >= 1 ? [30, 40, 34, 44][Math.floor(f / 4) % 4] : 30} strokeLinecap="round" />}
            {sl >= 1 && Math.floor(f / 8) % 2 === 0 && [-1, 1].map((d) => <line key={d} x1={d * 250} y1={-260} x2={d * 290} y2={-290} stroke={STRAW} strokeWidth={8} strokeLinecap="round" />)}
            {it.text && sl >= 1 && <text x={0} y={70} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={40} letterSpacing={3} fill={STRAW}>{it.text}</text>}
        </g>
    );
};

// ---- Ep. 12 T01 (the house visit, beat by beat) ------------------------------------------------------------------------
// a bamboo bench; the politician (ink silhouette, strawberry sash) walks in and sits down at `n`, then nods along on twos.
// x, y = bench seat centre; ~440 x 330
const Bench: React.FC<{ it: IlloItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, t0 = f - (it.at || 0);
    if (t0 < 0) return null;
    const sitAt = it.n ?? 12, walk = cl(two(t0) / Math.max(2, sitAt)), sat = t0 >= sitAt;
    const px = sat ? 0 : 260 - 260 * ez(walk), nod = sat ? (Math.floor(f / 6) % 2) * 4 : (Math.floor(f / 4) % 2) * 5;
    return (
        <g transform={`translate(${it.x} ${it.y}) scale(${s})`}>
            <ellipse cx={20} cy={120} rx={240} ry={20} fill="url(#illoht)" />
            {/* bamboo: matcha poles with ink nodes, printed with a strawberry plate out of register */}
            {[-60, -30, 0].map((dy, j) => <g key={j}>
                <rect x={-200} y={dy - 12} width={400} height={24} rx={12} fill={STRAW} transform="translate(8 7)" opacity={0.8} />
                <rect x={-200} y={dy - 12} width={400} height={24} rx={12} fill={MATCHA} stroke={INK} strokeWidth={4} />
                {[-120, 0, 120].map((x) => <line key={x} x1={x + j * 14} y1={dy - 12} x2={x + j * 14} y2={dy + 12} stroke={INK} strokeWidth={4} />)}
            </g>)}
            {[-180, 180].map((x) => <rect key={x} x={x - 12} y={-20} width={24} height={140} fill={MATCHA} stroke={INK} strokeWidth={4} />)}
            {/* the visitor */}
            <g transform={`translate(${px} ${sat ? -14 : -74}) translate(0 ${-nod})`}>
                {sat ? <>
                    <rect x={-36} y={-6} width={92} height={30} rx={12} fill={INK} />
                    <rect x={40} y={-6} width={26} height={110} rx={10} fill={INK} />
                    <rect x={-34} y={-120} width={70} height={120} rx={20} fill={INK} />
                </> : <>
                    <rect x={-20} y={40} width={18} height={110} fill={INK} transform={`rotate(${(Math.floor(f / 4) % 2) * 14 - 7} -11 40)`} />
                    <rect x={4} y={40} width={18} height={110} fill={INK} transform={`rotate(${(Math.floor(f / 4) % 2) * -14 + 7} 13 40)`} />
                    <rect x={-34} y={-80} width={70} height={124} rx={20} fill={INK} />
                </>}
                <path d={sat ? 'M-30 -116 L32 -10' : 'M-30 -76 L32 30'} stroke={STRAW} strokeWidth={14} />
                <circle cx={0} cy={sat ? -150 : -110} r={30} fill={INK} />
                {it.text && <text x={0} y={sat ? -200 : -160} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={26} letterSpacing={2} fill={STRAW}>{it.text}</text>}
            </g>
        </g>
    );
};
// a plate of rice with two tuyo; a bare hand dips in, scoops and lifts on a loop (twos). x, y = plate centre; ~460 x 340
const Kamay: React.FC<{ it: IlloItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, t0 = f - (it.at || 0);
    if (t0 < 0) return null;
    const k = 1.08 - 0.08 * ez(two(t0) / 8), c = two(t0) % 20, dip = c < 8 ? c / 8 : c < 12 ? 1 : 1 - (c - 12) / 8;
    const Fish = ({ x, y, r }: { x: number; y: number; r: number }) => (
        <g transform={`translate(${x} ${y}) rotate(${r})`}>
            <path d="M-70 0 Q-20 -30 50 0 L80 -24 L74 24 L50 0 Q-20 30 -70 0 Z" fill={STRAW} transform="translate(5 4)" opacity={0.85} />
            <path d="M-70 0 Q-20 -30 50 0 L80 -24 L74 24 L50 0 Q-20 30 -70 0 Z" fill="#c9a46a" stroke={INK} strokeWidth={4} />
            {[-30, -10, 10, 30].map((q) => <line key={q} x1={q} y1={-14} x2={q + 6} y2={14} stroke={INK} strokeWidth={2.5} opacity={0.6} />)}
            <circle cx={-52} cy={-3} r={4} fill={INK} />
        </g>
    );
    return (
        <g transform={`translate(${it.x} ${it.y}) scale(${s * k})`}>
            <ellipse cx={14} cy={20} rx={230} ry={70} fill={MATCHA} />
            <ellipse cx={0} cy={0} rx={230} ry={70} fill="#fbfaf6" stroke={INK} strokeWidth={6} />
            <ellipse cx={0} cy={0} rx={180} ry={48} fill="none" stroke={INK} strokeWidth={3} opacity={0.4} />
            <ellipse cx={-50} cy={-6} rx={90} ry={32} fill="#fffdf5" stroke={INK} strokeWidth={3} />
            {Array.from({ length: 14 }, (_, j) => <ellipse key={j} cx={-110 + (j % 7) * 20} cy={-18 + Math.floor(j / 7) * 18} rx={6} ry={3} fill={INK} opacity={0.25} />)}
            <Fish x={90} y={-6} r={-8} /><Fish x={70} y={22} r={10} />
            {/* the hand: four fingers + thumb, lowering into the rice and lifting with a pinch */}
            <g transform={`translate(${-40 + dip * 10} ${-170 + dip * 130}) rotate(${-10 + dip * 6})`}>
                <rect x={-40} y={-160} width={80} height={120} rx={20} fill={INK} />
                {[0, 1, 2, 3].map((q) => <rect key={q} x={-38 + q * 20} y={-50} width={17} height={70 - Math.abs(q - 1.5) * 10} rx={8} fill={INK} />)}
                <rect x={36} y={-80} width={18} height={56} rx={9} fill={INK} transform="rotate(-30 45 -80)" />
                {c >= 12 && <ellipse cx={-8} cy={22} rx={26} ry={10} fill="#fffdf5" stroke={INK} strokeWidth={2} />}
            </g>
        </g>
    );
};
// a framed family portrait (ink silhouettes on cream); at `n` an extra figure with a strawberry sash slides in from the
// right and squeezes into the photo, a "?" over him. x, y = frame centre; ~520 x 360
const FamPhoto: React.FC<{ it: IlloItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, t0 = f - (it.at || 0);
    if (t0 < 0) return null;
    const k = 1.08 - 0.08 * ez(two(t0) / 8), e = it.n !== undefined ? t0 - it.n : -1, slide = e >= 0 ? ez(two(e) / 10) : 0;
    const tilt = e >= 0 && e < 14 ? (Math.floor(f / 2) % 2 ? 1.5 : -1.5) : -2;
    return (
        <g transform={`translate(${it.x} ${it.y}) scale(${s * k}) rotate(${tilt})`}>
            <rect x={-250} y={-170} width={500} height={340} fill={STRAW} transform="translate(12 10)" />
            <rect x={-250} y={-170} width={500} height={340} fill="#7a5a3a" stroke={INK} strokeWidth={6} />
            <rect x={-222} y={-142} width={444} height={284} fill={PAPER} />
            <rect x={-222} y={40} width={444} height={102} fill="url(#illoht)" opacity={0.2} />
            {[[-150, 1.25], [-70, 1.4], [10, 0.95], [80, 1.1]].map(([x, sc], j) => (
                <g key={j} transform={`translate(${x} 130) scale(${sc})`}>
                    <rect x={-26} y={-112} width={52} height={112} rx={16} fill={INK} /><circle cx={0} cy={-132} r={22} fill={INK} />
                </g>))}
            <defs><clipPath id={`fam${it.x}`}><rect x={-222} y={-142} width={444} height={284} /></clipPath></defs>
            {e >= 0 && <g clipPath={`url(#fam${it.x})`}><g transform={`translate(${300 - 150 * slide} 130) scale(1.35)`}>
                <rect x={-26} y={-112} width={52} height={112} rx={16} fill={INK} /><circle cx={0} cy={-132} r={22} fill={INK} />
                <path d="M-24 -104 L24 -30" stroke={STRAW} strokeWidth={10} />
            </g></g>}
            {e >= 0 && slide > 0.9 && <text x={150} y={-90} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={56} fill={STRAW}>?</text>}
            {it.text && <text x={0} y={222} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={30} letterSpacing={2} fill={STRAW}>{it.text}</text>}
        </g>
    );
};

export const RisoIllo: React.FC<{ items: IlloItem[]; f: number }> = ({ items, f }) => (
    <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{ position: 'absolute', inset: 0 }}>
        <defs>
            <KitDefs />
            <pattern id="illoht" width={9} height={9} patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><circle cx={4.5} cy={4.5} r={2.3} fill={INK} /></pattern>
        </defs>
        {items.map((it, i) => {
            if (it.out != null && f >= it.out) return null;
            const kit = kitScene(it as KitItem, f, i);   // Ep. 13+ scenes (RisoKit.tsx, the illustration standard)
            if (kit !== undefined) return kit;
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
                case 'cycle': return <Cycle key={i} it={it} f={f} />;
                case 'calendar': return <Calendar key={i} it={it} f={f} />;
                case 'phone': return <Phone key={i} it={it} f={f} />;
                case 'chat': return <Chat key={i} it={it} f={f} />;
                case 'alarm': return <Alarm key={i} it={it} f={f} />;
                case 'speaker': return <Speaker key={i} it={it} f={f} />;
                case 'heart': return <Heart key={i} it={it} f={f} />;
                case 'hanger': return <Hanger key={i} it={it} f={f} />;
                case 'door': return <Door key={i} it={it} f={f} />;
                case 'ballot': return <Ballot key={i} it={it} f={f} />;
                case 'video': return <Video key={i} it={it} f={f} />;
                case 'rec': return <Rec key={i} it={it} f={f} />;
                case 'camoff': return <CamOff key={i} it={it} f={f} />;
                case 'bench': return <Bench key={i} it={it} f={f} />;
                case 'kamay': return <Kamay key={i} it={it} f={f} />;
                case 'famphoto': return <FamPhoto key={i} it={it} f={f} />;
                default: return null;
            }
        })}
    </svg>
);
