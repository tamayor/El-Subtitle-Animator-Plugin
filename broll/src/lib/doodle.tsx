// Hand-drawn pieces shared by the doodle effects: the invisible-pen draw-on, a wobble filter, the stepped "boil"
// seed, rough shapes (ellipse, underline, scribble, box, bracket, star, burst, arrow), hatching and the icon set.
import React from 'react';
import { clamp, rand } from './common';

// The stroke is drawn from 0 to k of its length (pathLength = 1).
export const draw = (k: number) => ({ pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1 - clamp(k), fill: 'none',
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, visibility: (k <= 0 ? 'hidden' : 'visible') as 'hidden' | 'visible' });

// Lines re-drawn every `step` frames: the seed for that drawing.
export const boilSeed = (frame: number, step = 3) => Math.floor(Math.max(0, frame) / step);

// A deterministic pencil wobble: use as filter={`url(#${id})`}. A new seed gives a new drawing of the same line.
export const Wobble: React.FC<{ id: string; seed?: number; amount?: number; freq?: number }> = ({ id, seed = 1, amount = 6, freq = 0.02 }) => (
    <filter id={id} x="-20%" y="-20%" width="140%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency={freq} numOctaves={2} seed={seed} result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale={amount} xChannelSelector="R" yChannelSelector="G" />
    </filter>
);

// Diagonal pencil hatching: fill={`url(#${id})`}.
export const Hatch: React.FC<{ id: string; color: string; gap?: number; width?: number; angle?: number }> = ({ id, color, gap = 9, width = 3.4, angle = 38 }) => (
    <pattern id={id} width={gap} height={gap} patternUnits="userSpaceOnUse" patternTransform={`rotate(${angle})`}>
        <line x1={0} y1={0} x2={0} y2={gap} stroke={color} strokeWidth={width} />
    </pattern>
);

const j = (seed: number, i: number, amt: number) => (rand(seed * 7.13 + i * 3.71) - 0.5) * 2 * amt;
const n = (v: number) => Math.round(v * 10) / 10;

// A loop drawn by hand: it starts a little outside, goes round once and overshoots its start.
export function roughEllipse(cx: number, cy: number, rx: number, ry: number, seed = 1, turns = 1.12) {
    const steps = 28, pts: string[] = [];
    const total = Math.round(steps * turns);
    for (let i = 0; i <= total; i++) {
        const a = -Math.PI * 0.62 + (i / steps) * Math.PI * 2;
        const grow = 1 + (i / total - 0.5) * 0.07;
        const x = cx + Math.cos(a) * rx * grow + j(seed, i, rx * 0.025), y = cy + Math.sin(a) * ry * grow + j(seed + 9, i, ry * 0.03);
        pts.push(`${n(x)} ${n(y)}`);
    }
    return smooth(pts);
}

// Catmull-Rom-ish smoothing through "x y" points.
export function smooth(pts: string[]) {
    const P = pts.map(s => s.split(' ').map(Number));
    if (P.length < 3) return 'M ' + pts.join(' L ');
    let d = `M ${P[0][0]} ${P[0][1]}`;
    for (let i = 0; i < P.length - 1; i++) {
        const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
        d += ` C ${n(p1[0] + (p2[0] - p0[0]) / 6)} ${n(p1[1] + (p2[1] - p0[1]) / 6)}, ${n(p2[0] - (p3[0] - p1[0]) / 6)} ${n(p2[1] - (p3[1] - p1[1]) / 6)}, ${p2[0]} ${p2[1]}`;
    }
    return d;
}

export function roughLine(x1: number, y1: number, x2: number, y2: number, seed = 1, wob = 6) {
    const pts: string[] = [];
    for (let i = 0; i <= 6; i++) {
        const k = i / 6;
        pts.push(`${n(x1 + (x2 - x1) * k + (i && i < 6 ? j(seed, i, wob * 0.4) : 0))} ${n(y1 + (y2 - y1) * k + (i && i < 6 ? j(seed + 3, i, wob) : 0))}`);
    }
    return smooth(pts);
}

// A marker zigzag sweeping left to right over a w x h area centred on (cx, cy).
export function scribble(cx: number, cy: number, w: number, h: number, seed = 1, passes = 9) {
    const pts: string[] = [];
    for (let i = 0; i <= passes; i++) {
        const x = cx - w / 2 + (w * i) / passes + j(seed, i, w * 0.02);
        const y = cy + (i % 2 ? h / 2 : -h / 2) + j(seed + 5, i, h * 0.12);
        pts.push(`${n(x)} ${n(y)}`);
    }
    return 'M ' + pts.join(' L ');
}

export function roughBox(cx: number, cy: number, w: number, h: number, seed = 1) {
    const x0 = cx - w / 2, y0 = cy - h / 2, x1 = cx + w / 2, y1 = cy + h / 2, o = Math.min(w, h) * 0.04;
    const q = (i: number) => j(seed, i, o);
    return `M ${n(x0 - o + q(1))} ${n(y0 + q(2))} L ${n(x1 + o)} ${n(y0 + q(3))} M ${n(x1 + q(4))} ${n(y0 - o)} L ${n(x1 + q(5))} ${n(y1 + o)} `
        + `M ${n(x1 + o)} ${n(y1 + q(6))} L ${n(x0 - o)} ${n(y1 + q(7))} M ${n(x0 + q(8))} ${n(y1 + o)} L ${n(x0 + q(9))} ${n(y0 - o)}`;
}

export function brackets(cx: number, cy: number, w: number, h: number) {
    const x0 = cx - w / 2, y0 = cy - h / 2, x1 = cx + w / 2, y1 = cy + h / 2, a = Math.min(w, h) * 0.18;
    return `M ${n(x0 + a)} ${n(y0)} L ${n(x0)} ${n(y0)} L ${n(x0)} ${n(y1)} L ${n(x0 + a)} ${n(y1)} M ${n(x1 - a)} ${n(y0)} L ${n(x1)} ${n(y0)} L ${n(x1)} ${n(y1)} L ${n(x1 - a)} ${n(y1)}`;
}

export function star(cx: number, cy: number, r: number, seed = 1) {
    const pts: string[] = [];
    for (let i = 0; i <= 5; i++) {
        const a = -Math.PI / 2 + i * (Math.PI * 4 / 5);
        pts.push(`${n(cx + Math.cos(a) * r + j(seed, i, r * 0.05))} ${n(cy + Math.sin(a) * r + j(seed + 2, i, r * 0.05))}`);
    }
    return 'M ' + pts.join(' L ');
}

// Little rays around a point: one sub-path each.
export function burst(cx: number, cy: number, r0: number, r1: number, count = 9, seed = 1, from = -Math.PI, to = Math.PI) {
    let d = '';
    for (let i = 0; i < count; i++) {
        const a = from + ((to - from) * (i + 0.5)) / count + j(seed, i, 0.08), len = r1 * (0.8 + rand(seed + i) * 0.4);
        d += `M ${n(cx + Math.cos(a) * r0)} ${n(cy + Math.sin(a) * r0)} L ${n(cx + Math.cos(a) * len)} ${n(cy + Math.sin(a) * len)} `;
    }
    return d.trim();
}

// A curved arrow from A to B: the shaft, and the head as its own path (so it can be drawn last).
export function arrow(ax: number, ay: number, bx: number, by: number, bend = 0.22, head = 34, seed = 1) {
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    const mx = (ax + bx) / 2 - (dy / len) * len * bend + j(seed, 1, len * 0.02), my = (ay + by) / 2 + (dx / len) * len * bend + j(seed, 2, len * 0.02);
    const shaft = `M ${n(ax)} ${n(ay)} Q ${n(mx)} ${n(my)} ${n(bx)} ${n(by)}`;
    const ang = Math.atan2(by - my, bx - mx);
    const h = (o: number) => `${n(bx - Math.cos(ang + o) * head)} ${n(by - Math.sin(ang + o) * head)}`;
    return { shaft, head: `M ${h(0.5)} L ${n(bx)} ${n(by)} L ${h(-0.45)}` };
}

// Simple drawn icons on a 100 x 100 box. Closed paths (ending in Z) take the fill.
export const ICONS: Record<string, string[]> = {
    lightbulb: ['M50 10 C30 10 19 26 19 40 C19 52 28 58 34 67 L34 74 L66 74 L66 67 C72 58 81 52 81 40 C81 26 70 10 50 10 Z', 'M38 82 L62 82', 'M43 90 L57 90', 'M42 46 L50 56 L58 46'],
    house: ['M24 46 L24 86 L76 86 L76 46 L50 20 Z', 'M12 52 L50 14 L88 52', 'M43 86 L43 62 L57 62 L57 86'],
    coin: ['M50 12 A38 38 0 1 1 49.9 12 Z', 'M61 37 C56 30 40 31 40 41 C40 51 60 48 60 59 C60 70 44 70 38 63', 'M50 26 L50 74'],
    heart: ['M50 85 C20 62 9 46 14 31 C19 17 38 14 50 30 C62 14 81 17 86 31 C91 46 80 62 50 85 Z'],
    clock: ['M50 12 A38 38 0 1 1 49.9 12 Z', 'M50 26 L50 50 L66 60'],
    brain: ['M48 22 C38 12 23 18 26 31 C13 35 13 51 24 55 C18 67 30 79 42 75 C44 81 48 81 48 76 Z', 'M52 22 C62 12 77 18 74 31 C87 35 87 51 76 55 C82 67 70 79 58 75 C56 81 52 81 52 76 Z', 'M30 42 C36 40 40 44 40 50', 'M70 42 C64 40 60 44 60 50'],
    star: ['M50 10 L61 38 L91 40 L68 59 L76 88 L50 72 L24 88 L32 59 L9 40 L39 38 Z'],
    rocket: ['M50 8 C67 24 71 46 64 66 L36 66 C29 46 33 24 50 8 Z', 'M50 28 A8 8 0 1 1 49.9 28 Z', 'M36 52 L21 70 L37 66', 'M64 52 L79 70 L63 66', 'M43 73 L50 92 L57 73'],
    check: ['M50 10 A40 40 0 1 1 49.9 10 Z', 'M30 52 L44 66 L71 36'],
    fire: ['M50 8 C54 27 75 36 73 60 C72 77 62 90 50 90 C38 90 27 77 27 60 C27 48 35 42 38 31 C44 37 46 44 46 49 C50 38 53 24 50 8 Z', 'M50 84 C42 84 38 76 40 68 C42 62 48 60 50 52 C54 60 60 64 60 72 C60 79 56 84 50 84'],
    warning: ['M50 12 L91 84 L9 84 Z', 'M50 38 L50 62', 'M50 72 L50 74'],
    chart: ['M14 14 L14 86 L88 86', 'M24 72 L42 50 L56 62 L84 28', 'M66 28 L84 28 L84 46'],
    target: ['M50 10 A40 40 0 1 1 49.9 10 Z', 'M50 28 A22 22 0 1 1 49.9 28', 'M50 44 A6 6 0 1 1 49.9 44'],
    phone: ['M32 8 L68 8 C72 8 74 10 74 14 L74 86 C74 90 72 92 68 92 L32 92 C28 92 26 90 26 86 L26 14 C26 10 28 8 32 8 Z', 'M44 16 L56 16', 'M46 84 L54 84']
};
export const ICON_NAMES = Object.keys(ICONS);
