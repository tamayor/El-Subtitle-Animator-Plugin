// Reason scene (Before 2028, Ep. 05): a full-frame illustrated explainer for one point of an episode. The series'
// dark collage backdrop, an optional header (number in a pen circle + title), an ink-and-paper illustration on a cream
// panel inside the film-strip border, built step by step on the spoken words (`at`: frames from the clip start), and
// up to three real screenshots (social comments) landing under it on their own words with a strawberry pen box.
// Hand-made motion: things hard-cut in at 110 % and settle; with the common `hand` prop the whole clip moves on twos
// and every line boils.
import React from 'react';
import { AbsoluteFill, Img, useCurrentFrame } from 'remotion';
import { Common, FONT, clamp, ease } from '../lib/common';
import { Background, FilmBorder } from '../collage/cards';
import { brandOf } from '../collage/brand';
import { Grain } from '../lib/paper';
import { RisoIllo, IlloItem } from './RisoIllo';

type P = Common & {
    scene: string; title: string; number: number; total: number; at: string | number[];
    stageY: number; stageH: number;
    image1?: string; image2?: string; image3?: string; imageAts?: string | number[]; imageYs?: string | number[]; imageHs?: string | number[]; marks?: string | number[][]; quotes?: string | string[];
};

const INK = '#1c2738', PAPER = '#efe4cc', PAPER2 = '#f7f0e0', MATCHA = '#3f7f45', HL = '#5a9e5d', STRAW = '#c7385a', SKIN = '#e8b9a0', SAND = '#d9c49a', WATER = '#7d9aa6';
const SW = 6;
const line = { stroke: INK, strokeWidth: SW, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };

const nums = (v: unknown): number[] => (Array.isArray(v) ? v : String(v ?? '').split(/[\s,]+/)).map(Number).filter((n) => Number.isFinite(n));

// step helpers, from the frame and the step frames
function steps(f: number, at: number[]) {
    const on = (i: number) => at[i] != null && f >= at[i];
    const since = (i: number) => (on(i) ? f - at[i] : -1);
    const k = (i: number, d = 8) => (on(i) ? clamp((f - at[i]) / d) : 0);
    const settle = (i: number, from = 1.1, d = 10) => (on(i) ? from - (from - 1) * ease(clamp((f - at[i]) / d)) : 0);
    return { on, since, k, settle };
}
type S = ReturnType<typeof steps>;

// a group that hard-cuts in at step i and settles round (cx, cy)
const Pop: React.FC<{ s: S; i: number; cx: number; cy: number; from?: number; children: React.ReactNode }> = ({ s, i, cx, cy, from = 1.1, children }) => {
    if (!s.on(i)) return null;
    const sc = s.settle(i, from);
    return <g transform={`translate(${cx} ${cy}) scale(${sc}) translate(${-cx} ${-cy})`}>{children}</g>;
};

// ---------- figures ----------
type Mood = 'smile' | 'frown' | 'angry' | 'shock' | 'blush' | 'grin' | 'sad';
const Face: React.FC<{ x: number; y: number; s: number; mood: Mood }> = ({ x, y, s, mood }) => (
    <g>
        {mood === 'shock'
            ? <><circle cx={x - 13 * s} cy={y - 5 * s} r={6 * s} fill="#fff" stroke={INK} strokeWidth={3} /><circle cx={x + 13 * s} cy={y - 5 * s} r={6 * s} fill="#fff" stroke={INK} strokeWidth={3} /></>
            : <><circle cx={x - 13 * s} cy={y - 4 * s} r={4.5 * s} fill={INK} /><circle cx={x + 13 * s} cy={y - 4 * s} r={4.5 * s} fill={INK} /></>}
        {mood === 'angry' && <><path d={`M${x - 22 * s} ${y - 20 * s} L${x - 6 * s} ${y - 12 * s}`} {...line} strokeWidth={4} /><path d={`M${x + 22 * s} ${y - 20 * s} L${x + 6 * s} ${y - 12 * s}`} {...line} strokeWidth={4} /></>}
        {(mood === 'smile' || mood === 'blush') && <path d={`M${x - 14 * s} ${y + 12 * s} Q${x} ${y + 26 * s} ${x + 14 * s} ${y + 12 * s}`} {...line} strokeWidth={4} />}
        {mood === 'grin' && <path d={`M${x - 16 * s} ${y + 10 * s} Q${x} ${y + 32 * s} ${x + 16 * s} ${y + 10 * s} Z`} fill="#fff" stroke={INK} strokeWidth={4} strokeLinejoin="round" />}
        {(mood === 'frown' || mood === 'angry' || mood === 'sad') && <path d={`M${x - 14 * s} ${y + 22 * s} Q${x} ${y + 9 * s} ${x + 14 * s} ${y + 22 * s}`} {...line} strokeWidth={4} />}
        {mood === 'shock' && <ellipse cx={x} cy={y + 18 * s} rx={7 * s} ry={9 * s} fill={INK} />}
        {mood === 'blush' && <><ellipse cx={x - 22 * s} cy={y + 9 * s} rx={9 * s} ry={5 * s} fill={STRAW} opacity={0.7} /><ellipse cx={x + 22 * s} cy={y + 9 * s} rx={9 * s} ry={5 * s} fill={STRAW} opacity={0.7} /></>}
        {mood === 'sad' && <path d={`M${x + 18 * s} ${y - 2 * s} q4 10 0 14 q-4 -4 0 -14`} fill={WATER} stroke={INK} strokeWidth={2} />}
    </g>
);

// a person: head centre (x, y), size s. arms: 'down' | 'up' | 'wave' | 'flex'
const Person: React.FC<{ x: number; y: number; s?: number; shirt?: string; mood?: Mood; arms?: string; wave?: number; suit?: boolean; chest?: string; hair?: boolean }> = ({ x, y, s = 1, shirt = HL, mood = 'smile', arms = 'down', wave = 0, suit, chest, hair = true }) => {
    const r = 36 * s, sh = y + r + 8 * s, hip = y + r + 150 * s, wS = 62 * s, wH = 48 * s;
    const body = `M${x - wS} ${sh + 26 * s} Q${x - wS} ${sh} ${x - wS + 26 * s} ${sh} L${x + wS - 26 * s} ${sh} Q${x + wS} ${sh} ${x + wS} ${sh + 26 * s} L${x + wH} ${hip} L${x - wH} ${hip} Z`;
    const arm = (side: number) => {
        const ax = x + side * (wS - 6 * s), ay = sh + 20 * s;
        if (arms === 'up' || arms === 'wave') {
            const sw = arms === 'wave' ? Math.sin(wave + side) * 16 * s : 0;
            return <path d={`M${ax} ${ay} L${ax + side * 34 * s + sw} ${ay - 70 * s} L${ax + side * 30 * s + sw} ${ay - 120 * s}`} {...line} strokeWidth={13 * s} stroke={INK} />;
        }
        if (arms === 'flex' && side > 0) return <path d={`M${ax} ${ay} L${ax + 62 * s} ${ay + 8 * s} L${ax + 64 * s} ${ay - 58 * s}`} {...line} strokeWidth={13 * s} />;
        return <path d={`M${ax} ${ay} L${ax + side * 14 * s} ${ay + 110 * s}`} {...line} strokeWidth={13 * s} />;
    };
    return (
        <g>
            <path d={`M${x - 22 * s} ${hip} L${x - 26 * s} ${hip + 90 * s} M${x + 22 * s} ${hip} L${x + 26 * s} ${hip + 90 * s}`} {...line} strokeWidth={14 * s} />
            {arm(-1)}{arm(1)}
            <path d={body} fill={suit ? INK : shirt} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
            {suit && <><path d={`M${x - 16 * s} ${sh} L${x} ${sh + 44 * s} L${x + 16 * s} ${sh} Z`} fill="#fff" /><path d={`M${x} ${sh + 6 * s} L${x - 8 * s} ${sh + 70 * s} L${x} ${sh + 84 * s} L${x + 8 * s} ${sh + 70 * s} Z`} fill={STRAW} /></>}
            {chest && <text x={x} y={sh + 72 * s} textAnchor="middle" fontFamily={FONT.arial} fontWeight={700} fontSize={22 * s} fill="#fff">{chest}</text>}
            <circle cx={x} cy={y} r={r} fill={SKIN} stroke={INK} strokeWidth={SW} />
            {hair && <path d={`M${x - r} ${y - 4 * s} Q${x - r} ${y - r - 10 * s} ${x} ${y - r - 6 * s} Q${x + r + 4 * s} ${y - r} ${x + r} ${y - 8 * s} Q${x + 6 * s} ${y - r + 2 * s} ${x - r} ${y - 4 * s} Z`} fill={INK} />}
            <Face x={x} y={y + 4 * s} s={s} mood={mood} />
        </g>
    );
};

const Heart: React.FC<{ x: number; y: number; s?: number; fill?: string }> = ({ x, y, s = 1, fill = STRAW }) => (
    <path transform={`translate(${x} ${y}) scale(${s})`} d="M0 14 C-24 -2 -16 -26 0 -12 C16 -26 24 -2 0 14 Z" fill={fill} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
);
const Bubble: React.FC<{ x: number; y: number; w: number; text: string; tail?: number; size?: number; color?: string }> = ({ x, y, w, text, tail = 1, size = 34, color = '#fff' }) => {
    const h = size * 1.9, pts: string[] = [];
    for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI * 2; const rr = i % 2 ? 1 : 1.12; pts.push(`${x + Math.cos(a) * w / 2 * rr},${y + Math.sin(a) * h / 2 * rr}`); }
    return (
        <g>
            <path d={`M${x + tail * w * 0.12} ${y + h * 0.4} L${x + tail * w * 0.3} ${y + h * 0.95} L${x + tail * w * 0.3 - tail * 30} ${y + h * 0.42}`} fill={color} stroke={INK} strokeWidth={4} strokeLinejoin="round" />
            <polygon points={pts.join(' ')} fill={color} stroke={INK} strokeWidth={4} strokeLinejoin="round" />
            <text x={x} y={y + size * 0.36} textAnchor="middle" fontFamily={FONT.arial} fontWeight={700} fontSize={size} fill={INK}>{text}</text>
        </g>
    );
};
const Label: React.FC<{ x: number; y: number; text: string; bg?: string; size?: number; rot?: number }> = ({ x, y, text, bg = STRAW, size = 34, rot = -3 }) => {
    const w = text.length * size * 0.62 + 36;
    return (
        <g transform={`rotate(${rot} ${x} ${y})`}>
            <rect x={x - w / 2} y={y - size * 0.85} width={w} height={size * 1.6} fill={bg} />
            <text x={x} y={y + size * 0.3} textAnchor="middle" fontFamily={FONT.arial} fontWeight={700} fontSize={size} fill="#fff" letterSpacing={1}>{text}</text>
        </g>
    );
};
const Stamp: React.FC<{ x: number; y: number; text: string; color?: string; size?: number; rot?: number; k?: number }> = ({ x, y, text, color = STRAW, size = 72, rot = -12, k = 1 }) => {
    const w = text.length * size * 0.66 + 50, sc = 1 + (1 - k) * 0.5;
    return (
        <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${sc})`} opacity={0.92}>
            <rect x={-w / 2} y={-size * 0.8} width={w} height={size * 1.55} fill="none" stroke={color} strokeWidth={9} rx={10} />
            <rect x={-w / 2 + 12} y={-size * 0.8 + 12} width={w - 24} height={size * 1.55 - 24} fill="none" stroke={color} strokeWidth={3} rx={6} />
            <text x={0} y={size * 0.34} textAnchor="middle" fontFamily={FONT.arial} fontWeight={700} fontSize={size} fill={color} letterSpacing={3}>{text}</text>
        </g>
    );
};
// a pen X drawn on over d frames
const PenX: React.FC<{ x: number; y: number; r: number; k: number; color?: string }> = ({ x, y, r, k, color = STRAW }) => {
    const L = r * 2.83, a = clamp(k * 2), b = clamp(k * 2 - 1);
    return (
        <g stroke={color} strokeWidth={14} strokeLinecap="round" fill="none">
            <path d={`M${x - r} ${y - r} L${x + r} ${y + r}`} strokeDasharray={L} strokeDashoffset={L * (1 - a)} />
            {b > 0 && <path d={`M${x + r} ${y - r * 0.9} L${x - r * 0.95} ${y + r}`} strokeDasharray={L} strokeDashoffset={L * (1 - b)} />}
        </g>
    );
};
const Rooster: React.FC<{ x: number; y: number; s?: number; color: string; flip?: boolean; rot?: number }> = ({ x, y, s = 1, color, flip, rot = 0 }) => (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${(flip ? -1 : 1) * s} ${s})`}>
        <path d="M-70 -10 C-120 -60 -130 -110 -96 -140 C-92 -100 -80 -80 -60 -60 C-90 -110 -70 -150 -40 -160 C-50 -110 -40 -80 -30 -60" fill={INK} stroke={INK} strokeWidth={4} strokeLinejoin="round" />
        <path d="M-60 40 L-48 110 M-24 110 L-48 110 M10 40 L22 110 M46 110 L22 110" {...line} strokeWidth={7} />
        <ellipse cx={-14} cy={0} rx={82} ry={58} fill={color} stroke={INK} strokeWidth={SW} />
        <path d="M-40 -6 Q-10 30 30 4" {...line} strokeWidth={5} />
        <path d="M40 -30 C40 -80 50 -100 74 -104 C98 -104 108 -84 104 -60 C100 -36 76 -20 56 -6 Z" fill={color} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
        <path d="M64 -104 q4 -22 16 -10 q6 -22 18 -4 q10 -14 14 6 Z" fill={STRAW} stroke={INK} strokeWidth={4} strokeLinejoin="round" />
        <path d="M104 -80 L132 -72 L104 -64 Z" fill="#e3a83a" stroke={INK} strokeWidth={4} strokeLinejoin="round" />
        <path d="M100 -62 q8 18 -6 22 q-8 -10 6 -22" fill={STRAW} stroke={INK} strokeWidth={3} />
        <circle cx={88} cy={-80} r={5} fill={INK} />
    </g>
);
const House: React.FC<{ x: number; y: number; w: number; roof: string }> = ({ x, y, w, roof }) => (
    <g>
        <rect x={x} y={y} width={w} height={w * 0.8} fill={PAPER2} stroke={INK} strokeWidth={SW} />
        <path d={`M${x - 10} ${y} L${x + w / 2} ${y - w * 0.55} L${x + w + 10} ${y} Z`} fill={roof} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
        <rect x={x + w * 0.38} y={y + w * 0.38} width={w * 0.24} height={w * 0.42} fill={INK} />
        <rect x={x + w * 0.1} y={y + w * 0.16} width={w * 0.2} height={w * 0.18} fill={WATER} stroke={INK} strokeWidth={3} />
    </g>
);
const Rain: React.FC<{ x0: number; x1: number; y0: number; y1: number; f: number; n?: number; skip?: (x: number) => boolean }> = ({ x0, x1, y0, y1, f, n = 16, skip }) => (
    <g stroke={WATER} strokeWidth={4} strokeLinecap="round">
        {Array.from({ length: n }, (_, i) => {
            const x = x0 + ((i * 97) % (x1 - x0)); if (skip && skip(x)) return null;
            const y = y0 + ((f * 14 + i * 53) % (y1 - y0));
            return <path key={i} d={`M${x} ${y} l-6 26`} />;
        })}
    </g>
);
const Politician: React.FC<{ x: number; y: number; s?: number; mood?: Mood }> = ({ x, y, s = 1, mood = 'grin' }) => <Person x={x} y={y} s={s} suit mood={mood} />;

// ---------- scenes (stage = 820 wide, H tall) ----------
type SceneFn = (s: S, f: number, H: number) => React.ReactNode;
const SCENES: Record<string, SceneFn> = {
    // hook: a scandal card, then a flooded street
    flood: (s, f, H) => (
        <g>
            {!s.on(1) && <Pop s={s} i={0} cx={410} cy={H / 2}>
                <rect x={150} y={60} width={520} height={H - 120} fill={PAPER2} stroke={INK} strokeWidth={SW} />
                <rect x={180} y={90} width={460} height={34} fill={INK} opacity={0.85} />
                {[0, 1, 2].map((i) => <rect key={i} x={180} y={H - 150 + i * 26} width={i === 2 ? 280 : 460} height={12} fill={INK} opacity={0.35} />)}
                <Politician x={410} y={210} s={0.9} mood="shock" />
                <path d="M436 176 l50 -20 l12 40 l-50 14 Z" fill={SKIN} stroke={INK} strokeWidth={5} strokeLinejoin="round" />
                <Stamp x={410} y={H / 2 + 20} text="SCANDAL" k={s.k(0, 6)} size={70} />
            </Pop>}
            {s.on(1) && <g>
                <House x={70} y={170} w={170} roof={STRAW} /><House x={300} y={150} w={200} roof={MATCHA} /><House x={560} y={170} w={180} roof={INK} />
                <Rain x0={20} x1={800} y0={0} y1={H} f={f} n={22} />
                {(() => { const lv = H - 120 - 60 * ease(s.k(1, 30)); return <g>
                    <path d="M560 -10 L560 -10" />
                    <Person x={300} y={lv - 120} s={0.8} shirt={HL} mood="sad" arms="up" />
                    <rect x={470} y={lv - 70} width={190} height={70} rx={24} fill={STRAW} stroke={INK} strokeWidth={SW} />
                    <path d={`M0 ${lv} Q100 ${lv - 14} 205 ${lv} T410 ${lv} T615 ${lv} T820 ${lv} L820 ${H} L0 ${H} Z`} fill={WATER} stroke={INK} strokeWidth={SW} opacity={0.92} />
                    {[0, 1, 2].map((i) => <path key={i} d={`M${120 + i * 250 + Math.sin(f / 6 + i) * 10} ${lv + 40} q20 -10 40 0`} {...line} stroke="#fff" strokeWidth={4} />)}
                </g>; })()}
            </g>}
        </g>
    ),
    // years go by and the street is still flooded
    stillflood: (s, f, H) => {
        const yr = s.on(1) ? 2025 : 2022 + Math.min(3, Math.floor(Math.max(0, f) / 10));
        const lv = H - 170;
        return (
            <g>
                <rect x={560} y={50} width={190} height={210} fill={PAPER2} stroke={INK} strokeWidth={SW} />
                <rect x={560} y={50} width={190} height={56} fill={STRAW} stroke={INK} strokeWidth={SW} />
                <text x={655} y={190} textAnchor="middle" fontFamily={FONT.garamond} fontWeight={700} fontSize={78} fill={INK}>{yr}</text>
                <Rain x0={20} x1={540} y0={0} y1={H} f={f} n={14} />
                <House x={80} y={150} w={200} roof={MATCHA} />
                <Person x={430} y={lv - 140} s={0.95} shirt={HL} mood={s.on(1) ? 'frown' : 'sad'} />
                <path d={`M0 ${lv} Q100 ${lv - 14} 205 ${lv} T410 ${lv} T615 ${lv} T820 ${lv} L820 ${H} L0 ${H} Z`} fill={WATER} stroke={INK} strokeWidth={SW} opacity={0.92} />
                {s.on(1) && <Label x={300} y={60} text="STILL FLOODED" bg={INK} size={36} rot={-2} />}
            </g>
        );
    },
    fans: (s, f) => (
        <g>
            <Pop s={s} i={0} cx={410} cy={250}>
                <rect x={240} y={40} width={340} height={400} fill={PAPER2} stroke={INK} strokeWidth={SW} />
                <Politician x={410} y={170} s={1.15} />
                <Label x={410} y={400} text="IDOL KO!" size={40} rot={0} />
            </Pop>
            <Pop s={s} i={1} cx={410} cy={620}>
                {[110, 260, 410, 560, 710].map((x, i) => <Person key={i} x={x} y={560 + (i % 2) * 20} s={0.72} shirt={[MATCHA, STRAW, HL, STRAW, MATCHA][i]} mood="grin" arms="wave" wave={Math.floor(f / 2) * 0.9 + i} />)}
            </Pop>
            {s.on(2) && Array.from({ length: 10 }, (_, i) => {
                const t = s.since(2) * 7 + i * 47, y = 560 - (t % 420), x = 80 + ((i * 173) % 660) + Math.sin((t + i * 20) / 40) * 20;
                return <Heart key={i} x={x} y={y} s={1.1 + (i % 3) * 0.3} />;
            })}
        </g>
    ),
    // 1 pride and hiya: wore the shirt, fought relatives, the bet failed, fooled, double down
    pride: (s, f, H) => {
        const mood: Mood = s.on(4) ? 'angry' : s.on(3) ? 'blush' : s.on(2) ? 'shock' : 'grin';
        const dig = s.k(4, 40);
        return (
            <g>
                {s.on(4) && <ellipse cx={410} cy={H - 70} rx={150 + dig * 60} ry={34 + dig * 26} fill={INK} />}
                <Pop s={s} i={0} cx={410} cy={420}>
                    <Person x={410} y={250 + dig * 30} s={1.35} shirt={MATCHA} mood={mood} chest="MY BET" />
                    <Heart x={410} y={455 + dig * 30} s={0.9} />
                </Pop>
                {s.on(2) && <path d={`M372 ${360 + dig * 30} l20 30 l-14 20 l24 34 l-10 26`} stroke={STRAW} strokeWidth={7} fill="none" strokeLinejoin="round" />}
                <Pop s={s} i={1} cx={410} cy={300}>
                    <Person x={110} y={420} s={0.85} shirt={STRAW} mood="angry" />
                    <Person x={710} y={420} s={0.85} shirt={HL} mood="angry" />
                    <Bubble x={140} y={250} w={190} text="#@!%" tail={-1} />
                    <Bubble x={680} y={250} w={210} text="ANO BA?!" tail={1} size={30} />
                </Pop>
                <Pop s={s} i={2} cx={410} cy={100}>
                    <rect x={300} y={30} width={220} height={130} fill="#fff" stroke={INK} strokeWidth={5} />
                    <ellipse cx={340} cy={72} rx={18} ry={12} fill={INK} /><rect x={370} y={66} width={120} height={12} fill={INK} opacity={0.5} />
                    <ellipse cx={340} cy={118} rx={18} ry={12} fill="none" stroke={INK} strokeWidth={3} /><rect x={370} y={112} width={100} height={12} fill={INK} opacity={0.3} />
                    <PenX x={410} y={95} r={60} k={s.k(2, 10)} />
                </Pop>
                {s.on(3) && !s.on(4) && <g>
                    <text x={560} y={210} fontFamily={FONT.garamondItalic} fontSize={64} fill={STRAW} transform={`rotate(-8 560 210)`}>hiya…</text>
                    <path d="M470 200 q8 18 0 26 q-8 -8 0 -26" fill={WATER} stroke={INK} strokeWidth={3} />
                </g>}
                {s.on(4) && <g>
                    <path d={`M530 ${300 + dig * 30} L600 ${H - 80}`} {...line} strokeWidth={10} />
                    <path d={`M582 ${H - 104} l44 10 l-14 44 l-40 -12 Z`} fill="#9aa3ab" stroke={INK} strokeWidth={5} strokeLinejoin="round" />
                    <Label x={250} y={H - 40} text="DOUBLE DOWN" size={44} rot={-3} />
                    <path d="M120 560 L120 700 M90 670 L120 704 L150 670" stroke={STRAW} strokeWidth={10} strokeLinecap="round" fill="none" />
                </g>}
            </g>
        );
    },
    // 2 hindi plastic: everyone steals anyway; the polite one looks fake, the rude one feels real
    plastic: (s, f, H) => (
        <g>
            <Pop s={s} i={0} cx={410} cy={140}>
                {[170, 410, 650].map((x, i) => <g key={i}>
                    <Politician x={x} y={120} s={0.62} mood="grin" />
                    <rect x={x - 32} y={108} width={64} height={18} rx={9} fill={INK} />
                    <path d={`M${x + 40} ${170} q40 -10 50 30 q4 40 -40 40 q-30 -6 -24 -40 Z`} fill={SAND} stroke={INK} strokeWidth={4} />
                    <text x={x + 62} y={226} textAnchor="middle" fontFamily={FONT.arial} fontWeight={700} fontSize={26} fill={INK}>₱</text>
                </g>)}
            </Pop>
            {s.on(1) && <g>
                <Pop s={s} i={1} cx={230} cy={560}>
                    <Person x={230} y={470} s={0.95} suit mood="smile" arms="down" />
                </Pop>
                {s.on(2) && <g>
                    <rect x={90} y={360} width={280} height={H - 380} fill="rgba(160,200,215,.22)" stroke={INK} strokeWidth={SW} />
                    <rect x={90} y={330} width={280} height={60} fill={STRAW} stroke={INK} strokeWidth={SW} />
                    <text x={230} y={372} textAnchor="middle" fontFamily={FONT.arial} fontWeight={700} fontSize={30} fill="#fff">100% PLASTIC</text>
                    <path d="M110 380 L170 440" stroke="#fff" strokeWidth={6} opacity={0.7} />
                </g>}
            </g>}
            {s.on(3) && <Pop s={s} i={3} cx={600} cy={560}>
                <Person x={600} y={470} s={0.95} shirt={STRAW} mood="angry" arms="flex" />
                <Bubble x={660} y={340} w={200} text="#@%!" tail={-1} />
            </Pop>}
            {s.on(4) && <Stamp x={600} y={640} text="REAL" color={MATCHA} k={s.k(4, 6)} size={80} rot={-10} />}
        </g>
    ),
    // 3 borrowed power: tough life, a rich and feared giant, step into its shadow, feel strong and protected
    power: (s, f, H) => {
        const px = 600 - 150 * ease(s.k(3, 14));
        const umbrella = s.on(4);
        return (
            <g>
                <Pop s={s} i={1} cx={250} cy={H / 2}>
                    <ellipse cx={330} cy={H - 40} rx={240} ry={30} fill={INK} opacity={0.35} />
                    <circle cx={250} cy={150} r={92} fill={INK} />
                    <path d="M110 300 Q110 250 160 250 L340 250 Q390 250 390 300 L370 700 L130 700 Z" fill={INK} />
                    <path d="M130 700 L120 790 M370 700 L380 790" stroke={INK} strokeWidth={40} strokeLinecap="round" />
                    <path d="M120 320 L60 560" stroke={INK} strokeWidth={36} strokeLinecap="round" />
                    <path d="M30 560 q30 -40 60 0 q30 60 -30 70 q-60 -10 -30 -70 Z" fill={MATCHA} stroke={PAPER} strokeWidth={4} />
                    <text x={60} y={615} textAnchor="middle" fontFamily={FONT.arial} fontWeight={700} fontSize={40} fill="#fff">₱</text>
                    <path d="M200 300 Q250 340 300 300" stroke="#e3a83a" strokeWidth={8} fill="none" />
                    {s.on(2) && <g>
                        <path d="M200 140 L240 150 L210 160 Z M300 140 L260 150 L290 160 Z" fill={STRAW} />
                        {[0, 1, 2, 3, 4].map((i) => <path key={i} d={`M${250 + Math.cos(-2.6 + i * 0.6) * 120} ${150 + Math.sin(-2.6 + i * 0.6) * 120} l${Math.cos(-2.6 + i * 0.6) * 40} ${Math.sin(-2.6 + i * 0.6) * 40}`} stroke={STRAW} strokeWidth={7} strokeLinecap="round" />)}
                    </g>}
                    {umbrella && <g>
                        <path d="M340 290 L520 230" stroke={INK} strokeWidth={30} strokeLinecap="round" />
                        <path d={`M${px - 170} 250 Q${px} 110 ${px + 170} 250 Q${px + 120} 225 ${px + 85} 250 Q${px + 40} 225 ${px} 250 Q${px - 40} 225 ${px - 85} 250 Q${px - 120} 225 ${px - 170} 250 Z`} fill={MATCHA} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
                        <path d={`M${px} 250 L${px} 290`} {...line} />
                    </g>}
                </Pop>
                <path d={`M${px - 110} 120 q-10 -50 40 -50 q20 -40 70 -10 q50 -20 60 30 q40 10 20 40 Z`} fill="#9aa3ab" stroke={INK} strokeWidth={5} strokeLinejoin="round" />
                <Rain x0={px - 110} x1={px + 110} y0={130} y1={H} f={f} n={10} skip={umbrella ? () => true : undefined} />
                <Person x={px} y={H - 330} s={0.85} shirt={HL} mood={umbrella ? 'grin' : s.on(3) ? 'smile' : 'sad'} arms={umbrella ? 'flex' : 'down'} />
                {!s.on(3) && <path d={`M${px + 60} ${H - 170} l70 0 l10 90 l-90 0 Z`} fill={SAND} stroke={INK} strokeWidth={5} strokeLinejoin="round" />}
                {umbrella && <Label x={px + 40} y={H - 40} text="STRONG" bg={MATCHA} size={38} rot={-4} />}
            </g>
        );
    },
    // 4 hometown pride: the town, its politician, kababayan; an attack on him shakes the whole town
    hometown: (s, f, H) => {
        const shake = s.on(4) ? Math.sin(f * 2.3) * 9 * (1 - s.k(4, 40) * 0.5) : 0;
        const rockK = s.k(3, 8);
        return (
            <g transform={`translate(${shake} 0)`}>
                <Pop s={s} i={0} cx={410} cy={H / 2}>
                    <House x={20} y={H - 260} w={150} roof={STRAW} /><House x={650} y={H - 260} w={150} roof={MATCHA} />
                    <rect x={140} y={140} width={56} height={H - 220} fill={PAPER2} stroke={INK} strokeWidth={SW} />
                    <rect x={624} y={140} width={56} height={H - 220} fill={PAPER2} stroke={INK} strokeWidth={SW} />
                    <path d="M110 160 Q410 20 710 160 L710 220 Q410 80 110 220 Z" fill={MATCHA} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
                    <path id="archText" d="M150 196 Q410 66 670 196" fill="none" />
                    <text fontFamily={FONT.arial} fontWeight={700} fontSize={30} fill="#fff" letterSpacing={2}><textPath href="#archText" startOffset="50%" textAnchor="middle">MALIGAYANG PAGDATING</textPath></text>
                </Pop>
                <Pop s={s} i={1} cx={410} cy={330}>
                    <rect x={300} y={210} width={220} height={240} fill={PAPER2} stroke={INK} strokeWidth={SW} />
                    <Politician x={410} y={290} s={0.8} />
                    {s.on(3) && rockK >= 1 && <path d="M380 240 l30 40 l-20 30 l40 50 M410 280 l40 -20" stroke={STRAW} strokeWidth={6} fill="none" />}
                    {[220, 330, 490, 600].map((x, i) => <Person key={i} x={x} y={H - 250 + (i % 2) * 14} s={0.62} shirt={[STRAW, HL, MATCHA, STRAW][i]} mood={s.on(4) ? 'angry' : 'grin'} arms={s.on(4) ? 'up' : 'down'} />)}
                </Pop>
                <Pop s={s} i={2} cx={410} cy={490}>
                    <Label x={410} y={505} text="KABABAYAN!" size={40} rot={-2} />
                    {[250, 360, 470, 580].map((x, i) => <Heart key={i} x={x} y={H - 330 - ((s.since(2) * 3 + i * 9) % 30)} s={1} />)}
                </Pop>
                {s.on(3) && rockK < 1 && <path transform={`translate(${820 - 380 * rockK} ${120 + 160 * rockK})`} d="M-28 0 q4 -26 30 -22 q28 6 22 30 q-10 24 -34 16 q-22 -8 -18 -24 Z" fill="#8c8a84" stroke={INK} strokeWidth={4} />}
                {s.on(4) && [230, 340, 500, 610].map((x, i) => <path key={i} d={`M${x - 20} ${H - 340} q-10 -20 6 -30 q-10 -20 10 -26`} stroke="#9aa3ab" strokeWidth={6} fill="none" strokeLinecap="round" opacity={0.9} />)}
            </g>
        );
    },
    // 5 sabong revenge: elections as a cockfight; a manok not for plans but to beat the ones they hate
    sabong: (s, f, H) => {
        const lunge = s.k(4, 8), knocked = s.on(4) ? ease(s.k(4, 12)) : 0;
        return (
            <g>
                <Pop s={s} i={0} cx={410} cy={H / 2}>
                    {Array.from({ length: 11 }, (_, i) => <g key={i}>
                        <circle cx={40 + i * 74} cy={250 + Math.abs(i - 5) * 6} r={26} fill={SKIN} stroke={INK} strokeWidth={4} />
                        <path d={`M${14 + i * 74} ${310} q26 -40 52 0`} fill={[MATCHA, STRAW, HL, INK][i % 4]} stroke={INK} strokeWidth={4} />
                        {s.on(5) && <path d={`M${20 + i * 74} 240 l-8 -50 M${60 + i * 74} 240 l8 -50`} {...line} strokeWidth={8} />}
                    </g>)}
                    <ellipse cx={410} cy={H - 210} rx={380} ry={170} fill={SAND} stroke={INK} strokeWidth={SW} />
                    <ellipse cx={410} cy={H - 210} rx={330} ry={130} fill="none" stroke={INK} strokeWidth={3} strokeDasharray="14 12" />
                    <rect x={260} y={40} width={300} height={90} fill={INK} />
                    <text x={410} y={102} textAnchor="middle" fontFamily={FONT.arial} fontWeight={700} fontSize={44} fill="#fff" letterSpacing={3}>ELEKSYON</text>
                </Pop>
                <Pop s={s} i={1} cx={410} cy={H - 230}>
                    <Rooster x={250 + lunge * 110} y={H - 240 - Math.sin(lunge * Math.PI) * 60} s={1} color={MATCHA} />
                    <Rooster x={580 + knocked * 60} y={H - 240 + knocked * 30} s={1} color={STRAW} flip rot={knocked * 70} />
                </Pop>
                {s.on(2) && <Pop s={s} i={2} cx={200} cy={H - 470}>
                    <Label x={200} y={H - 470} text="MANOK KO!" bg={MATCHA} size={38} rot={-5} />
                    <path d={`M220 ${H - 440} Q250 ${H - 400} 240 ${H - 360} M222 ${H - 380} L240 ${H - 356} L258 ${H - 382}`} stroke={MATCHA} strokeWidth={8} fill="none" strokeLinecap="round" />
                </Pop>}
                {s.on(3) && !s.on(4) && <Pop s={s} i={3} cx={610} cy={H - 470}>
                    <rect x={530} y={H - 540} width={160} height={130} fill="#fff" stroke={INK} strokeWidth={5} />
                    <text x={610} y={H - 490} textAnchor="middle" fontFamily={FONT.garamond} fontWeight={700} fontSize={34} fill={INK}>PLANS</text>
                    {[0, 1, 2].map((i) => <rect key={i} x={550} y={H - 470 + i * 18} width={120 - i * 20} height={8} fill={INK} opacity={0.35} />)}
                    <PenX x={610} y={H - 475} r={70} k={s.k(3, 10)} />
                </Pop>}
                {s.on(4) && Array.from({ length: 8 }, (_, i) => {
                    const t = s.since(4), a = i * 0.8 - 2.6, d = t * 9;
                    return t < 40 ? <path key={i} transform={`translate(${600 + Math.cos(a) * d} ${H - 280 + Math.sin(a) * d + t * t * 0.08}) rotate(${t * 12 + i * 40})`} d="M0 -16 Q10 0 0 16 Q-10 0 0 -16" fill={i % 2 ? STRAW : '#fff'} stroke={INK} strokeWidth={2} /> : null;
                })}
                {s.on(5) && <Stamp x={600} y={H - 450} text="PANALO!" color={STRAW} k={s.k(5, 6)} size={60} rot={-8} />}
            </g>
        );
    },
    // recap: politicians aren't your pride, your power, your hometown or your fighting cock
    recap: (s, f, H) => {
        const cells: [number, number, string, React.ReactNode][] = [
            [205, 205, 'PRIDE', <g><Person x={205} y={130} s={0.75} shirt={MATCHA} chest="MY BET" mood="grin" /></g>],
            [615, 205, 'POWER', <g><circle cx={615} cy={110} r={56} fill={INK} /><path d="M525 200 Q525 170 560 170 L670 170 Q705 170 705 200 L690 340 L540 340 Z" fill={INK} /><path d="M594 104 L612 110 L596 116 Z M636 104 L618 110 L634 116 Z" fill={STRAW} /></g>],
            [205, 615, 'HOMETOWN', <g><path d="M90 520 Q205 440 320 520 L320 550 Q205 480 90 550 Z" fill={MATCHA} stroke={INK} strokeWidth={5} /><rect x={100} y={540} width={26} height={170} fill={PAPER2} stroke={INK} strokeWidth={5} /><rect x={284} y={540} width={26} height={170} fill={PAPER2} stroke={INK} strokeWidth={5} /><House x={160} y={620} w={90} roof={STRAW} /></g>],
            [615, 615, 'FIGHTING COCK', <g><Rooster x={600} y={640} s={0.78} color={STRAW} /></g>]
        ];
        return (
            <g>
                {cells.map(([cx, cy, lab, art], i) => (
                    <Pop key={i} s={s} i={i} cx={cx} cy={cy}>
                        <rect x={cx - 190} y={cy - 190} width={380} height={380} fill={PAPER2} stroke={INK} strokeWidth={4} />
                        {art}
                        <text x={cx} y={cy + 172} textAnchor="middle" fontFamily={FONT.arial} fontWeight={700} fontSize={30} fill={INK} letterSpacing={2}>{lab}</text>
                        <PenX x={cx} y={cy - 20} r={120} k={s.k(i, 12) * (s.since(i) >= 6 ? 1 : 0)} />
                    </Pop>
                ))}
            </g>
        );
    },
    // they're workers paid by your taxes
    workers: (s, f, H) => (
        <g>
            <Pop s={s} i={0} cx={260} cy={H / 2}>
                <Person x={260} y={250} s={1.25} suit mood="smile" arms="down" />
                <path d="M196 214 Q260 140 324 214 L340 222 L180 222 Z" fill="#e3a83a" stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
                <path d="M228 300 L260 380 L292 300" stroke={STRAW} strokeWidth={5} fill="none" />
                <rect x={226} y={378} width={68} height={50} fill="#fff" stroke={INK} strokeWidth={4} />
                <text x={260} y={410} textAnchor="middle" fontFamily={FONT.arial} fontWeight={700} fontSize={15} fill={INK}>STAFF</text>
            </Pop>
            <Pop s={s} i={1} cx={600} cy={H / 2}>
                <g transform={`rotate(4 600 ${H / 2})`}>
                    <rect x={440} y={H / 2 - 230} width={330} height={440} fill="#fff" stroke={INK} strokeWidth={SW} />
                    <text x={605} y={H / 2 - 170} textAnchor="middle" fontFamily={FONT.garamond} fontWeight={700} fontSize={44} fill={INK}>PAYSLIP</text>
                    {['Position: Public servant', 'Employer: You', 'Funded by: Taxes'].map((t, i) => <text key={i} x={470} y={H / 2 - 100 + i * 52} fontFamily={FONT.arial} fontSize={24} fill={INK}>{t}</text>)}
                    <Stamp x={605} y={H / 2 + 120} text="PAID BY YOUR TAXES" color={MATCHA} size={30} rot={-8} k={s.k(1, 6)} />
                </g>
            </Pop>
        </g>
    )
};

// a sketchy pen box round a rect (crossed corners), drawn on over 8 frames
const PenBox: React.FC<{ x: number; y: number; w: number; h: number; k: number }> = ({ x, y, w, h, k }) => {
    const d = `M${x - 14} ${y + 4} L${x + w + 10} ${y - 4} M${x + w + 2} ${y - 14} L${x + w + 6} ${y + h + 10} M${x + w + 14} ${y + h + 2} L${x - 8} ${y + h + 6} M${x + 2} ${y + h + 14} L${x - 4} ${y - 12}`;
    const L = 2 * (w + h) + 120;
    return <path d={d} stroke={STRAW} strokeWidth={7} strokeLinecap="round" fill="none" strokeDasharray={L} strokeDashoffset={L * (1 - k)} />;
};

export const ReasonScene: React.FC<P> = (p) => {
    const f = useCurrentFrame();
    const H = 1920;
    const b = brandOf({ border: 'film', filmEdge: STRAW } as any);
    const at = nums(p.at), s = steps(f, at);
    const scene: SceneFn | null = String(p.scene || 'none') === 'none' ? null : (SCENES[String(p.scene)] || null);
    const pp = p as any;
    // up to 14 pictures (Ep. 07 rapid cut of clogged drains)
    const photos = Array.from({ length: 14 }, (_, i) => pp['photo' + (i + 1)]).map((x: unknown) => String(x || '')).filter((x: string) => x);
    const pAts = nums(pp.photoAts);
    const fits = String(pp.photoFits || '').split(',').map((x) => x.trim());
    const poss = String(pp.photoPos || '').split('|').map((x) => x.trim());
    const label = String(pp.label || ''), labelAt = Number(pp.labelAt) || 0;
    type Tag = { at: number; img?: string; text?: string; w?: number; hx?: number; hw?: number; sans?: boolean; size?: number; color?: string; mark?: string; comment?: boolean; avatar?: string; dx?: number; y?: number; wrap?: number };
    const rawTags = (Array.isArray(pp.tags) ? pp.tags : (() => { try { return JSON.parse(String(pp.tags || '[]')); } catch { return []; } })()) as any[];
    const tags: Tag[] = rawTags.map((t) => ({ ...t, at: Number(t.at) || 0, img: t.img ? String(pp[t.img] || '') : undefined, avatar: t.avatar ? String(pp[t.avatar] || '') : undefined })).filter((t) => t.img || t.text);
    const labelY = Number(pp.labelY) || 26;
    type Sticker = { e: string; at: number; x: number; y: number; size?: number; rot?: number };
    const stickers = ((Array.isArray(pp.stickers) ? pp.stickers : (() => { try { return JSON.parse(String(pp.stickers || '[]')); } catch { return []; } })()) as Sticker[])
        .map((s) => ({ ...s, at: Number(s.at) || 0 }));
    const showFrame = pp.frame !== false && String(pp.frame) !== 'false';
    // poster (Ep. 09, user: "Risograph Poster Collage Style ... consistent and cleaner"): a flat cream paper panel with a flat
    // colour block printed out of register behind it instead of the film strip, a LIGHT paper tooth over the picture (user:
    // evidence photos / documents stay clean and natural, never halftoned; the heavy riso look is for cards, labels and
    // accent blocks only, which get the stronger soy-ink mottling), and every tag / label set straight with a flat offset block instead of a soft
    // shadow, a random tilt and a string. One motion for everything: a hard cut that settles on twos.
    const poster = pp.poster === true || String(pp.poster) === 'true';
    const blockCol = ({ straw: STRAW, matcha: MATCHA, ink: INK } as Record<string, string>)[String(pp.block || 'straw')] || STRAW;
    type Cutout = { img: string; src?: string; at: number; x: number; y: number; w?: number; rot?: number; label?: string; still?: boolean; pop?: boolean;
        fx?: number; fy?: number; fly?: number; spin?: number; outAt?: number; ox?: number; oy?: number; outFrames?: number };
    // energy bursts (rays + rings + a white core) at a point of the stage, e.g. out of a face on the parody tarp
    type Burst = { at: number; x: number; y: number; dur?: number; r?: number };
    const bursts = ((() => { try { return JSON.parse(String(pp.bursts || '[]')); } catch { return []; } })()) as Burst[];
    // bottle fill comparison: same pesos, how much you get (mL); the loss shown on the first bottle
    type BottleItem = { label: string; ml: number; at: number };
    type Bottles = { x: number; y: number; w?: number; h?: number; gap?: number; max: number; items: BottleItem[]; lossAt?: number; lossText?: string; lossNote?: string; note?: string; color?: string };
    const bottles = ((() => { try { const v = JSON.parse(String(pp.bottles || 'null')); return v && v.items ? v : null; } catch { return null; } })()) as Bottles | null;
    const cutouts = ((Array.isArray(pp.cutouts) ? pp.cutouts : (() => { try { return JSON.parse(String(pp.cutouts || '[]')); } catch { return []; } })()) as Cutout[])
        .map((c) => ({ ...c, at: Number(c.at) || 0, src: String(pp[c.img] || '') }));
    const tagTop = Number(pp.tagTop) || 420, tagGap = Number(pp.tagGap) || 96;
    const hasHead = !!String(p.title || '').trim();
    const stageH = Math.round(Number(p.stageH) || 820), stageW = Math.round(Number(pp.stageW) || 820);   // stageW: the panel takes its picture's shape (a tall picture = a tall panel, no side padding)
    const stageY = Math.round(Number(p.stageY) || (hasHead ? 470 : 300));
    const left = (1080 - stageW) / 2;
    const imgs = [p.image1, p.image2, p.image3].map((x) => String(x || '')).filter((x) => x);
    const iAts = nums(p.imageAts), iYs = nums(p.imageYs), iHs = nums(p.imageHs);
    const quotes = (Array.isArray(p.quotes) ? p.quotes : (() => { try { return JSON.parse(String(p.quotes || '[]')); } catch { return []; } })()) as string[];
    const marks = (Array.isArray(p.marks) ? p.marks : (() => { try { return JSON.parse(String(p.marks || '[]')); } catch { return []; } })()) as number[][];
    const headK = ease(clamp(f / 10));
    let y = stageY + stageH + 96;
    return (
        <AbsoluteFill>
            {/* backdrop: a riso paper sheet (before-2028/tools/riso_backdrop.py) instead of the dark collage backdrop */}
            {String(pp.backdrop || '') ? <Img src={String(pp.backdrop)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} /> : <Background b={b} H={H} />}
            {/* illo: a riso illustration acting out the topic on the backdrop, so a thought with only a card / title is never an empty sheet */}
            {(() => { let it: IlloItem[] = []; try { it = Array.isArray(pp.illo) ? pp.illo : JSON.parse(String(pp.illo || '[]')); } catch { it = []; } return it.length ? <RisoIllo items={it} f={f} /> : null; })()}
            {hasHead && (
                <div style={{ position: 'absolute', left: 0, right: 0, top: 170, display: 'flex', flexDirection: 'column', alignItems: 'center', transform: `scale(${1.1 - 0.1 * headK})` }}>
                    {Number(p.number) > 0 && (
                        <div style={{ position: 'relative', width: 132, height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <svg width={132} height={120} style={{ position: 'absolute', inset: 0 }}>
                                <path d="M66 10 C112 6 128 40 122 66 C116 100 80 114 52 110 C18 104 4 74 10 48 C16 22 44 8 78 14" stroke={STRAW} strokeWidth={7} fill="none" strokeLinecap="round" />
                            </svg>
                            <div style={{ fontFamily: FONT.garamond, fontWeight: 700, fontSize: 88, color: String(pp.backdrop || '') ? INK : PAPER, lineHeight: 1 }}>{p.number}</div>
                        </div>
                    )}
                    <div style={{ fontFamily: FONT.garamond, fontWeight: 700, fontSize: 82, color: String(pp.backdrop || '') ? INK : PAPER, marginTop: 8, textAlign: 'center', lineHeight: 1.05, maxWidth: 960, textShadow: String(pp.backdrop || '') ? 'none' : '0 4px 18px rgba(0,0,0,.5)' }}>{p.title}</div>
                </div>
            )}
            <div style={{ position: 'absolute', left, top: stageY, width: stageW, height: stageH }}>
                {/* frame: false = no film strip and no paper, the stage only places cut-outs / tags over the backdrop */}
                {showFrame && !poster && <FilmBorder box={{ w: stageW, h: stageH }} seed={Number(p.number) || 3} shadow="0 24px 60px rgba(0,0,0,.55)" edgeColor={STRAW} />}
                {showFrame && poster && <div style={{ position: 'absolute', left: 16, top: 14, width: stageW, height: stageH, background: blockCol }} />}
                {showFrame && poster && <div style={{ position: 'absolute', inset: 0, background: '#fbfaf6', outline: `4px solid ${INK}` }} />}
                {showFrame && !poster && (
                    <svg width={stageW} height={stageH} viewBox={`0 0 ${stageW} ${stageH}`} style={{ position: 'absolute', inset: 0, background: PAPER, overflow: 'hidden' }}>
                        {scene ? scene(s, f, stageH) : null}
                    </svg>
                )}
                {/* real pictures (memes, photos) in the frame: each hard-cuts in on its word over the one before */}
                {photos.map((src, i) => {
                    const a = pAts[i] ?? 0;
                    if (f < a || photos.some((_, j) => j > i && f >= (pAts[j] ?? 0))) return null;
                    const sc = poster ? 1.06 - 0.06 * ease(clamp((Math.floor((f - a) / 2) * 2) / 8)) : 1.1 - 0.1 * ease(clamp((f - a) / 10));
                    return (
                        <div key={i} style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: poster ? '#fbfaf6' : '#111' }}>
                            <Img src={src} style={{ width: '100%', height: '100%', objectFit: (fits[i] || 'cover') as any, objectPosition: poss[i] || 'center', transform: `scale(${sc})` }} />
                        </div>
                    );
                })}
                {poster && showFrame && <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}><Grain id={`rsg${Number(p.number) || 0}`} opacity={0.12} seed={5} /></div>}
                {label && f >= labelAt && (
                    <div style={{ position: 'absolute', left: 0, right: 0, top: labelY, display: 'flex', justifyContent: 'center' }}>
                        <div style={{ background: STRAW, color: '#fff', fontFamily: FONT.arial, fontWeight: 700, fontSize: 44, letterSpacing: 2, padding: '10px 26px', whiteSpace: 'nowrap', flex: 'none', transform: poster ? `rotate(-2deg) scale(${1.12 - 0.12 * ease(clamp((Math.floor((f - labelAt) / 2) * 2) / 8))})` : `rotate(-3deg) scale(${1.15 - 0.15 * ease(clamp((f - labelAt) / 8))})`, boxShadow: poster ? `8px 7px 0 ${INK}` : '0 8px 20px rgba(0,0,0,.45)', position: 'relative' }}>{label}{poster && <Grain id="rsgl" opacity={0.6} seed={9} />}</div>
                    </div>
                )}
                {/* stickers: emoji reactions (😡 🔥 😆 🤣) and the anime anger mark, popping in on the words */}
                {stickers.map((st, i) => {
                    if (f < st.at) return null;
                    const t = f - st.at, sz = st.size || 120;
                    const pop = t < 4 ? 0.3 + (t / 4) * 1.0 : t < 8 ? 1.3 - ((t - 4) / 4) * 0.3 : 1;
                    const step = Math.floor(f / 4);
                    const wob = st.e === '🔥' ? 0 : Math.sin(step * 1.7 + i) * 6;
                    const flick = st.e === '🔥' ? 1 + Math.sin(step * 2.3 + i) * 0.08 : 1;
                    const pulse = st.e === 'anger' ? 1 + (step % 2) * 0.14 : 1;
                    return (
                        <div key={'st' + i} style={{ position: 'absolute', left: st.x, top: st.y, width: sz, height: sz, marginLeft: -sz / 2, marginTop: -sz / 2,
                            transform: `rotate(${(st.rot || 0) + wob}deg) scale(${pop * pulse}) scaleY(${flick})`, transformOrigin: st.e === '🔥' ? '50% 90%' : 'center',
                            filter: 'drop-shadow(0 8px 14px rgba(0,0,0,.5))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {st.e === 'anger' ? (
                                <svg width={sz} height={sz} viewBox="-50 -50 100 100">
                                    {[0, 90, 180, 270].map((a) => (
                                        <path key={a} transform={`rotate(${a + 45})`} d="M-9 -38 Q-12 -14 -34 -10 M9 -38 Q12 -14 34 -10" stroke="#fff" strokeWidth={17} fill="none" strokeLinecap="round" />
                                    ))}
                                    {[0, 90, 180, 270].map((a) => (
                                        <path key={'r' + a} transform={`rotate(${a + 45})`} d="M-9 -38 Q-12 -14 -34 -10 M9 -38 Q12 -14 34 -10" stroke={STRAW} strokeWidth={10} fill="none" strokeLinecap="round" />
                                    ))}
                                </svg>
                            ) : (
                                <span style={{ fontSize: sz * 0.86, lineHeight: 1 }}>{st.e}</span>
                            )}
                        </div>
                    );
                })}
                {/* cut-outs: die-cut PNGs of the things being named (a sachet, a packet), slapped onto the frame on their
                    word: hard cut at 110 % settling on twos, a slight boil, an optional strawberry name tag */}
                {cutouts.map((c, i) => {
                    if (f < c.at || !c.src) return null;
                    // still: a plain hard cut, no settle and no boil (user, Ep. 07: "no animation")
                    const t = f - c.at, k = c.still ? 1 : ease(clamp((Math.floor(t / 2) * 2) / 10));
                    const boil = c.still ? 0 : Math.sin(Math.floor(f / 4) * 1.9 + i * 2.1) * 0.8;
                    // pop: the sticker bounce (0.3 -> 1.3 -> 1 over 8 frames) for a run of things popping in one by one
                    const sc = c.pop ? (t < 4 ? 0.3 + (t / 4) * 1.0 : t < 8 ? 1.3 - ((t - 4) / 4) * 0.3 : 1) : 1.1 - 0.1 * k;
                    const w = c.w || 300;
                    // fly in from (fx, fy) over `fly` frames, and get thrown out to (ox, oy) from `outAt` (on twos, spinning)
                    let x = c.x, y = c.y, spin = 0;
                    if (c.fx !== undefined && c.fy !== undefined) {
                        const fl = c.fly || 12, q = ease(clamp((Math.floor(t / 2) * 2) / fl));
                        x = c.fx + (c.x - c.fx) * q; y = c.fy + (c.y - c.fy) * q; spin = (1 - q) * (c.spin ?? 200);
                    }
                    if (c.outAt !== undefined && f >= c.outAt) {
                        const q = clamp((Math.floor((f - c.outAt) / 2) * 2) / (c.outFrames || 12)), e2 = q * q;
                        x += ((c.ox ?? x) - x) * e2; y += ((c.oy ?? y) - y) * e2; spin += (c.spin ?? 200) * 2 * q;
                    }
                    const flyScale = c.fx !== undefined ? 1 : sc;
                    return (
                        <div key={'cut' + i} style={{ position: 'absolute', left: x, top: y, width: w, transform: `translate(-50%, -50%) rotate(${(c.rot || 0) + boil + spin}deg) scale(${flyScale})`,
                            filter: poster ? 'none' : 'drop-shadow(0 14px 18px rgba(0,0,0,.55))' }}>
                            <Img src={c.src} style={{ display: 'block', width: '100%' }} />
                            {c.label && (
                                <div style={{ position: 'absolute', left: '50%', bottom: -18, transform: 'translateX(-50%) rotate(-4deg)', background: STRAW, color: '#fff', fontFamily: FONT.arial, fontWeight: 700,
                                    fontSize: 30, letterSpacing: 1.5, padding: '6px 16px', whiteSpace: 'nowrap', boxShadow: '0 6px 14px rgba(0,0,0,.45)' }}>{c.label}</div>
                            )}
                        </div>
                    );
                })}
                {/* bottle fill comparison: two bottles, the liquid rising on twos to what the same pesos buy; the
                    sachet bottle then shows the missing part as a strawberry dashed ghost with the loss */}
                {bottles && (() => {
                    const bw = bottles.w || 240, bh = bottles.h || 470, gap = bottles.gap || 340, n = bottles.items.length;
                    const neckW = bw * 0.36, neckH = bh * 0.12, bodyH = bh - neckH, col = bottles.color || STRAW;
                    const lossK = bottles.lossAt !== undefined && f >= bottles.lossAt ? ease(clamp((Math.floor((f - bottles.lossAt) / 2) * 2) / 10)) : 0;
                    const level = (ml: number) => bodyH * Math.min(1, ml / bottles.max);
                    return (
                        <svg width={stageW} height={stageH} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
                            {bottles.items.map((it, i) => {
                                const cx = bottles.x + (i - (n - 1) / 2) * gap, top = bottles.y, bodyTop = top + neckH, bottom = top + bh;
                                const k = f < it.at ? 0 : ease(clamp((Math.floor((f - it.at) / 2) * 2) / 18));
                                const lv = level(it.ml) * k, body = `M${cx - bw / 2 + 30} ${bodyTop} Q${cx - bw / 2} ${bodyTop} ${cx - bw / 2} ${bodyTop + 40} L${cx - bw / 2} ${bottom - 24} Q${cx - bw / 2} ${bottom} ${cx - bw / 2 + 24} ${bottom} L${cx + bw / 2 - 24} ${bottom} Q${cx + bw / 2} ${bottom} ${cx + bw / 2} ${bottom - 24} L${cx + bw / 2} ${bodyTop + 40} Q${cx + bw / 2} ${bodyTop} ${cx + bw / 2 - 30} ${bodyTop} Z`;
                                const other = bottles.items.reduce((m, o) => Math.max(m, o.ml), 0);
                                const ghost = i === 0 && lossK > 0 ? (level(other) - level(it.ml)) : 0;
                                return (
                                    <g key={'b' + i}>
                                        <clipPath id={`bclip${i}`}><path d={body} /></clipPath>
                                        <rect x={cx - neckW / 2} y={top} width={neckW} height={neckH + 6} rx={8} fill={PAPER2} stroke={INK} strokeWidth={SW} />
                                        <path d={body} fill={PAPER2} />
                                        <g clipPath={`url(#bclip${i})`}>
                                            <rect x={cx - bw / 2} y={bottom - lv} width={bw} height={lv} fill={col} />
                                            <rect x={cx - bw / 2 + 22} y={bottom - lv} width={16} height={lv} fill="#fff" opacity={0.35} />
                                            {ghost > 0 && (
                                                <rect x={cx - bw / 2 + 8} y={bottom - level(it.ml) - ghost * lossK} width={bw - 16} height={ghost * lossK} fill="none" stroke={STRAW} strokeWidth={5} strokeDasharray="14 10" />
                                            )}
                                        </g>
                                        <path d={body} fill="none" stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
                                        <text x={cx} y={top - 28} textAnchor="middle" fontFamily={FONT.arial} fontWeight={700} fontSize={30} fill={INK} letterSpacing={1}>{it.label}</text>
                                        <text x={cx} y={bottom + 70} textAnchor="middle" fontFamily={FONT.garamond} fontWeight={700} fontSize={66} fill={INK}>{Math.round(it.ml * k)} mL</text>
                                        {ghost > 0 && bottles.lossText && (
                                            <g transform={`translate(${cx} ${bottom - level(it.ml) - ghost / 2}) rotate(-6) scale(${1.25 - 0.25 * lossK})`} opacity={lossK > 0 ? 1 : 0}>
                                                <rect x={-120} y={-38} width={240} height={70} fill={STRAW} />
                                                <text x={0} y={14} textAnchor="middle" fontFamily={FONT.arial} fontWeight={700} fontSize={44} fill="#fff">{bottles.lossText}</text>
                                            </g>
                                        )}
                                    </g>
                                );
                            })}
                            {lossK > 0 && bottles.lossNote && (
                                <text x={bottles.x} y={bottles.y + bh + 140} textAnchor="middle" fontFamily={FONT.garamondItalic} fontSize={46} fill={STRAW} opacity={lossK}>{bottles.lossNote}</text>
                            )}
                            {bottles.note && <text x={bottles.x} y={bottles.y + bh + 190} textAnchor="middle" fontFamily={FONT.arial} fontSize={20} fill={INK} opacity={0.6}>{bottles.note}</text>}
                        </svg>
                    );
                })()}
                {/* energy bursts: a white core, strawberry + matcha rays and rings, flickering on twos */}
                {bursts.map((b, i) => {
                    if (f < b.at || f > b.at + (b.dur || 30)) return null;
                    const t = Math.floor((f - b.at) / 2) * 2, d = b.dur || 30, R = b.r || 420;
                    const grow = ease(clamp(t / 8)), fade = 1 - clamp((t - d + 8) / 8);
                    return (
                        <svg key={'burst' + i} width={R * 2} height={R * 2} style={{ position: 'absolute', left: b.x - R, top: b.y - R, overflow: 'visible', opacity: fade }}>
                            <defs><radialGradient id={`core${i}`}><stop offset="0" stopColor="#fff" stopOpacity={1} /><stop offset="0.35" stopColor="#fff" stopOpacity={0.85} /><stop offset="1" stopColor={STRAW} stopOpacity={0} /></radialGradient></defs>
                            {Array.from({ length: 18 }).map((_, j) => {
                                const a = (j / 18) * Math.PI * 2 + (t % 4) * 0.08, len = R * grow * (0.55 + ((j * 37 + t) % 9) / 18);
                                return <line key={j} x1={R + Math.cos(a) * 40} y1={R + Math.sin(a) * 40} x2={R + Math.cos(a) * len} y2={R + Math.sin(a) * len} stroke={j % 2 ? STRAW : MATCHA} strokeWidth={j % 3 ? 10 : 18} strokeLinecap="round" />;
                            })}
                            {[0.35, 0.6, 0.85].map((r, j) => <circle key={'r' + j} cx={R} cy={R} r={R * r * grow} fill="none" stroke="#fff" strokeWidth={6} opacity={0.6 - j * 0.15} />)}
                            <circle cx={R} cy={R} r={R * 0.38 * grow} fill={`url(#core${i})`} />
                        </svg>
                    );
                })}
                {/* tags: funny comments / callouts hung one by one, stacking down the frame */}
                {tags.map((t, i) => {
                    if (f < t.at) return null;
                    const k = ease(clamp((f - t.at) / 8)), hk = clamp((f - t.at - 6) / 8);
                    const rot = poster ? -1.5 : [-3, 2.4, -1.6, 3, -2.2, 1.8][i % 6], dx = (t.dx ?? 0) + (poster ? 0 : [-34, 30, -18, 36, -28, 20][i % 6]);
                    if (poster && !t.comment && !t.img) {
                        // poster tag: a straight cream strip, centred, with a flat block printed out of register behind it
                        const kk = ease(clamp((Math.floor((f - t.at) / 2) * 2) / 8));
                        return (
                            <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: t.y ?? tagTop + i * tagGap, display: 'flex', justifyContent: 'center', transform: `translateX(${dx}px) rotate(${rot}deg) scale(${1.1 - 0.1 * kk})` }}>
                                <div style={{ position: 'relative', background: t.sans ? (t.mark || STRAW) : PAPER, padding: t.sans ? '10px 26px 10px' : '10px 30px 14px', boxShadow: `8px 7px 0 ${t.sans ? INK : (t.mark || STRAW)}`, outline: t.sans ? 'none' : `3px solid ${INK}`,
                                    fontFamily: t.sans ? FONT.arial : FONT.garamondItalic, fontWeight: t.sans ? 700 : 500, fontSize: t.size || 50, color: t.sans ? '#fff' : (t.color || INK), whiteSpace: 'nowrap', letterSpacing: t.sans ? 2 : 0, lineHeight: 1.1 }}>
                                    {t.text}
                                    <Grain id={`rsgt${i}`} opacity={0.6} seed={11 + i} />
                                </div>
                            </div>
                        );
                    }
                    const isImg = !!t.img && !t.comment, W = t.w || (isImg ? 640 : 0);
                    const top = t.y ?? tagTop + i * tagGap;
                    return (
                        <div key={i} style={{ position: 'absolute', left: '50%', top, transform: `translateX(-50%) translateX(${dx}px) rotate(${rot}deg) scale(${1.12 - 0.12 * k})`, transformOrigin: 'left center', filter: 'drop-shadow(0 10px 16px rgba(0,0,0,.55))' }}>
                            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', background: isImg || t.comment ? '#242526' : PAPER, padding: isImg || t.comment ? '10px 18px 10px 58px' : '14px 30px 16px 66px',
                                clipPath: 'polygon(30px 0, 100% 0, 100% 100%, 30px 100%, 0 70%, 0 30%)' }}>
                                <div style={{ position: 'absolute', left: 18, top: '50%', width: 20, height: 20, marginTop: -10, borderRadius: 20, background: isImg || t.comment ? PAPER : INK, opacity: 0.9 }} />
                                {t.comment ? (
                                    // a Facebook-style comment rebuilt big: the commenter's blurred avatar, a blurred name bar, their exact words
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                        <div style={{ width: 62, height: 62, borderRadius: 62, overflow: 'hidden', flex: 'none', background: '#555' }}>
                                            {t.avatar && <Img src={t.avatar} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(4px)', transform: 'scale(1.3)' }} />}
                                        </div>
                                        <div style={{ background: '#3a3b3c', borderRadius: 22, padding: '10px 20px 12px' }}>
                                            <div style={{ width: 150, height: 14, borderRadius: 7, background: '#8a8d91', filter: 'blur(3px)', marginBottom: 8 }} />
                                            <div style={{ position: 'relative', fontFamily: FONT.arial, fontSize: t.size || 36, color: '#e4e6eb', whiteSpace: t.wrap ? 'normal' : 'nowrap', width: t.wrap || undefined, lineHeight: 1.18 }}>
                                                {/* the highlighter runs under each line of the words (box-decoration so a wrapped comment gets one swipe per line) */}
                                                <span style={{ backgroundImage: `linear-gradient(${HL}, ${HL})`, backgroundRepeat: 'no-repeat', backgroundPosition: '0 85%', backgroundSize: `${hk * 100}% 50%`,
                                                    WebkitBoxDecorationBreak: 'clone', boxDecorationBreak: 'clone', padding: '0 3px' } as React.CSSProperties}>{t.text}</span>
                                            </div>
                                        </div>
                                    </div>
                                ) : isImg ? (
                                    <div style={{ position: 'relative', width: W }}>
                                        <Img src={t.img!} style={{ display: 'block', width: '100%' }} />
                                        {/* matcha highlighter swiped over the joke */}
                                        <div style={{ position: 'absolute', left: `${(t.hx ?? 0.17) * 100}%`, top: '48%', height: '42%', width: `${(t.hw ?? 0.8) * 100 * hk}%`, background: HL, opacity: 0.5, mixBlendMode: 'screen', borderRadius: 4 }} />
                                    </div>
                                ) : (
                                    <div style={{ position: 'relative', fontFamily: t.sans ? FONT.arial : FONT.garamondItalic, fontWeight: t.sans ? 700 : 500, fontSize: t.size || 50, color: t.color || INK, whiteSpace: 'nowrap', letterSpacing: t.sans ? 1 : 0 }}>
                                        <span style={{ position: 'absolute', left: -6, right: -6, bottom: 4, height: '42%', background: t.mark || HL, opacity: 0.55, transformOrigin: 'left', transform: `scaleX(${hk})` }} />
                                        <span style={{ position: 'relative' }}>{t.text}</span>
                                    </div>
                                )}
                            </div>
                            <svg width={90} height={60} style={{ position: 'absolute', left: -70, top: '50%', marginTop: -50, overflow: 'visible' }}>
                                <path d="M86 50 C60 46 40 20 6 4" stroke={PAPER} strokeWidth={3} fill="none" strokeLinecap="round" />
                            </svg>
                        </div>
                    );
                })}
            </div>
            {imgs.map((src, i) => {
                const a = iAts[i] ?? 0, on = f >= a;
                const top = iYs[i] ?? y + i * 200;
                if (!on) return null;
                // a later screenshot landing on the same spot replaces this one
                if (imgs.some((_, j) => j > i && iYs[j] != null && iYs[j] === iYs[i] && f >= (iAts[j] ?? 0))) return null;
                const q = String(quotes[i] || ''), qa = a + 8, qWords = q.split(/\s+/).filter(Boolean);
                const shownW = Math.max(0, Math.min(qWords.length, Math.floor((f - qa) / 2) + 1));   // a word every 2 frames
                const ih = iHs[i] || 120;
                return (
                    <React.Fragment key={i}>
                        <div style={{ position: 'absolute', left: 90, top, width: 900, transform: `rotate(${i % 2 ? 1.2 : -1.2}deg) scale(${1.1 - 0.1 * ease(clamp((f - a) / 10))})`, transformOrigin: 'center top',
                            boxShadow: '0 16px 40px rgba(0,0,0,.6)', border: '3px solid #3a3b3c', borderRadius: 10, overflow: 'hidden', background: '#242526' }}>
                            <Img src={src} style={{ display: 'block', width: '100%' }} />
                            {marks[i] && marks[i].length === 4 && (
                                <svg width={900} height={2000} viewBox="0 0 900 2000" style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
                                    <PenBox x={marks[i][0]} y={marks[i][1]} w={marks[i][2]} h={marks[i][3]} k={clamp((f - a - 8) / 8)} />
                                </svg>
                            )}
                        </div>
                        {q && f >= qa && (
                            // the key phrase, word for word, on a torn cream paper strip tucked under the comment
                            <div style={{ position: 'absolute', left: 0, right: 0, top: top + ih - 26, display: 'flex', justifyContent: 'center' }}>
                                <div style={{ maxWidth: 940, padding: '14px 34px 18px', background: PAPER, color: INK, fontFamily: FONT.garamondItalic, fontSize: 50, lineHeight: 1.12,
                                    textAlign: 'center', transform: `rotate(${i % 2 ? -1.6 : 1.4}deg)`, boxShadow: '0 10px 24px rgba(0,0,0,.5)',
                                    clipPath: 'polygon(0% 6%, 4% 0%, 12% 5%, 22% 1%, 35% 4%, 48% 0%, 61% 5%, 74% 1%, 86% 4%, 96% 0%, 100% 7%, 99% 92%, 93% 100%, 81% 95%, 67% 100%, 54% 96%, 40% 100%, 27% 95%, 14% 100%, 3% 95%, 0% 100%)' }}>
                                    {qWords.map((w, j) => <span key={j} style={{ opacity: j < shownW ? 1 : 0 }}>{w}{j < qWords.length - 1 ? ' ' : ''}</span>)}
                                </div>
                            </div>
                        )}
                    </React.Fragment>
                );
            })}
        </AbsoluteFill>
    );
};
