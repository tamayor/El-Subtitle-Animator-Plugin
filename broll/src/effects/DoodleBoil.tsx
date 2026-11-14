// Doodle boil: chalk scribbles (white, yellow, pink, blue) trace an oval around the speaker with small rings and
// sparkles; every line is re-drawn every few frames, so it "boils". With Follow the speaker the lines trace the
// speaker's own outline (props._outline: the matte's contour at the clip's start, middle and end, blended in between);
// without a matte, or with Follow off, they loop an oval set by hand (x, y, width, height).
import React from 'react';
import { useVideoConfig } from 'remotion';
import { Common, Full, clamp, ease, prog, rand, useInOut, useUnit } from '../lib/common';
import { Wobble, boilSeed, draw, roughEllipse, smooth, star } from '../lib/doodle';

type Outline = { at: number[]; pts: number[][][] };
type P = Common & { follow?: boolean; gap?: number; _outline?: Outline; boxW: number; boxH: number; step: number; extras: number; weight: number };

const CHALK = ['#ffffff', '#ffe66b', '#ff8fc0', '#7fc4ff'];

// The outline at clip frame `real`: the keyed outlines blended point by point (they share a start and a point count).
function outlineAt(o: Outline | undefined, real: number): number[][] | null {
    if (!o || !Array.isArray(o.pts) || !o.pts.length) return null;
    const n = o.pts.length;
    if (n === 1) return o.pts[0];
    let i = 0;
    while (i < n - 2 && real > o.at[i + 1]) i++;
    const a = o.pts[i], b = o.pts[i + 1], k = clamp((real - o.at[i]) / Math.max(1, o.at[i + 1] - o.at[i]));
    return a.length === b.length ? a.map((q, j) => [q[0] + (b[j][0] - q[0]) * k, q[1] + (b[j][1] - q[1]) * k]) : a;
}
// One chalk pass round the outline: pushed out from the middle by `grow` px, each point nudged. A speaker who runs off
// the bottom of the frame is not closed along that edge: the pen starts at one side and lifts at the other.
function tracePath(pts: number[][], W: number, H: number, grow: number, seed: number, jit: number) {
    const cx = pts.reduce((s, q) => s + q[0], 0) / pts.length * W, cy = pts.reduce((s, q) => s + q[1], 0) / pts.length * H;
    const out = pts.map((q, i) => {
        const x = q[0] * W, y = q[1] * H, d = Math.hypot(x - cx, y - cy) || 1;
        return `${Math.round((x + (x - cx) / d * grow + (rand(seed * 3.1 + i * 1.7) - 0.5) * jit) * 10) / 10} ${Math.round((y + (y - cy) / d * grow + (rand(seed * 5.3 + i * 2.9) - 0.5) * jit) * 10) / 10}`;
    });
    const low = (q: number[]) => q[1] >= 0.985;
    const first = pts.findIndex(low);
    if (first < 0) return smooth([...out, out[0], out[1], out[2]]);
    let last = first; for (let i = 0; i < pts.length; i++) if (low(pts[i])) last = i;
    const open = [...out.slice(last + 1), ...out.slice(0, first)];
    return open.length > 4 ? smooth(open) : smooth(out);
}

export const DoodleBoil: React.FC<P> = (p) => {
    const { frame, raw, real, durationInFrames: D } = useInOut(p, (D0) => Math.max(8, Math.round(D0 * 0.35)));
    const { width: W, height: H } = useVideoConfig();
    const u = useUnit();
    const end = Math.max(8, Math.round(D * 0.35));
    const seed = 1 + boilSeed(raw, Math.max(1, Math.round(Number(p.step) || 3))) % 4;
    const cx = clamp(p.x ?? 0.5) * W, cy = clamp(p.y ?? 0.5) * H, s = p.scale || 1;
    const rx = (Number(p.boxW) || 0.4) * W * s / 2, ry = (Number(p.boxH) || 0.7) * H * s / 2;
    const sw = (Number(p.weight) || 9) * u;
    const nExtra = Math.max(0, Math.min(16, Math.round(Number(p.extras) || 8)));
    const pts = p.follow === false ? null : outlineAt(p._outline, real);
    const gap = (Number.isFinite(Number(p.gap)) ? Number(p.gap) : 18) * u;
    // rings and sparkles sit around the outline's own box when it is followed
    const bx = pts ? [Math.min(...pts.map(q => q[0])), Math.min(...pts.map(q => q[1])), Math.max(...pts.map(q => q[0])), Math.max(...pts.map(q => q[1]))] : null;
    const ecx = bx ? (bx[0] + bx[2]) / 2 * W : cx, ecy = bx ? (bx[1] + bx[3]) / 2 * H : cy, erx = bx ? (bx[2] - bx[0]) / 2 * W : rx, ery = bx ? (bx[3] - bx[1]) / 2 * H : ry;
    return (
        <Full p={p}>
            <svg width={W} height={H} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
                <defs><Wobble id="dbw" seed={seed} amount={9 * u} freq={0.022 / Math.max(0.5, u)} /></defs>
                <g filter="url(#dbw)" fill="none" strokeLinecap="round">
                    {CHALK.map((c, i) => {
                        const k = ease(prog(frame, i * 2, end + i * 2));
                        const grow = 1 + i * 0.045;
                        return <path key={i} d={pts ? tracePath(pts, W, H, gap * (1 + i * 0.75), seed * 5 + i, 12 * u)
                            : roughEllipse(cx + (rand(seed + i) - 0.5) * 14 * u, cy + (rand(seed * 2 + i) - 0.5) * 14 * u, rx * grow, ry * grow, seed * 5 + i, 1.05 + i * 0.03)}
                            stroke={c} strokeWidth={sw * (i === 0 ? 1 : 0.7)} opacity={i === 0 ? 0.95 : 0.85} {...draw(k)} />;
                    })}
                    {Array.from({ length: nExtra }, (_, i) => {
                        const a = (i / nExtra) * Math.PI * 2 + 0.4, d = 1.2 + rand(i * 3.1) * 0.22;
                        const x = ecx + Math.cos(a) * erx * d, y = Math.min(H * 0.96, ecy + Math.sin(a) * ery * d), r = (16 + rand(i * 1.7) * 18) * u * s;
                        const k = clamp(prog(frame, end * 0.5 + i, end * 0.5 + i + 6));
                        const c = CHALK[(i + 1) % 4];
                        return i % 2
                            ? <path key={'e' + i} d={star(x, y, r, seed + i)} stroke={c} strokeWidth={sw * 0.55} {...draw(k)} />
                            : <path key={'e' + i} d={roughEllipse(x, y, r * 0.8, r * 0.8, seed + i)} stroke={c} strokeWidth={sw * 0.55} {...draw(k)} />;
                    })}
                </g>
            </svg>
        </Full>
    );
};
