// Doodle callout: a hand-drawn mark that draws itself over the footage: circle, box, brackets, arrow, connector,
// underline, double underline, scribble highlight, star, burst lines or an exclamation mark, with an optional
// handwritten label. Sizes are shares of the frame, so it can be fitted to a face, a chart or a word on screen.
import React from 'react';
import { useVideoConfig } from 'remotion';
import { Common, FONT, Full, clamp, ease, prog, useInOut, useUnit } from '../lib/common';
import { Wobble, arrow, boilSeed, brackets, burst, draw, roughBox, roughEllipse, roughLine, scribble, star } from '../lib/doodle';

type P = Common & { shape: string; boxW: number; boxH: number; toX: number; toY: number; label: string; weight: number; boil: boolean; shadow: boolean };

export const DoodleCallout: React.FC<P> = (p) => {
    const { frame, raw, fps, durationInFrames: D } = useInOut(p, (D0, f) => Math.max(8, Math.min(Math.round(D0 * 0.5), Math.round(f * 0.7))));
    const { width: W, height: H } = useVideoConfig();
    const u = useUnit();
    const end = Math.max(8, Math.min(Math.round(D * 0.5), Math.round(fps * 0.7)));
    const k = ease(prog(frame, 1, end));
    const seed = p.boil ? 1 + (boilSeed(raw, 4) % 3) : 1;
    const cx = clamp(p.x ?? 0.5) * W, cy = clamp(p.y ?? 0.5) * H;
    const s = p.scale || 1, w = (Number(p.boxW) || 0.3) * W * s, h = (Number(p.boxH) || 0.3) * H * s;
    const sw = (Number(p.weight) || 10) * u;
    const shape = String(p.shape || 'circle');
    const common = { stroke: p.accent, strokeWidth: sw };
    const paths: React.ReactNode[] = [];
    let labelAt = { x: cx, y: cy - h / 2 - 34 * u };
    const two = (a: string, b: string, split = 0.72) => {
        paths.push(<path key="a" d={a} {...common} {...draw(clamp(k / split))} />);
        paths.push(<path key="b" d={b} {...common} {...draw(clamp((k - split) / (1 - split)))} />);
    };
    if (shape === 'box') paths.push(<path key="a" d={roughBox(cx, cy, w, h, seed)} {...common} {...draw(k)} />);
    else if (shape === 'bracket') paths.push(<path key="a" d={brackets(cx, cy, w, h)} {...common} {...draw(k)} />);
    else if (shape === 'underline') { paths.push(<path key="a" d={roughLine(cx - w / 2, cy, cx + w / 2, cy - 4 * u, seed, 7 * u)} {...common} {...draw(k)} />); labelAt = { x: cx, y: cy + 60 * u }; }
    else if (shape === 'double-underline') {
        two(roughLine(cx - w / 2, cy, cx + w / 2, cy - 4 * u, seed, 7 * u), roughLine(cx + w / 2 - 12 * u, cy + 22 * u, cx - w / 2 + 20 * u, cy + 26 * u, seed + 4, 6 * u), 0.55);
        labelAt = { x: cx, y: cy + 84 * u };
    } else if (shape === 'scribble') paths.push(<path key="a" d={scribble(cx, cy, w, h, seed, Math.max(6, Math.round(w / (34 * u))))} stroke={p.accent} strokeWidth={sw * 2.6} opacity={0.62} {...draw(k)} strokeLinejoin="round" />);
    else if (shape === 'star') paths.push(<path key="a" d={star(cx, cy, Math.min(w, h) / 2, seed)} {...common} {...draw(k)} />);
    else if (shape === 'burst') paths.push(<path key="a" d={burst(cx, cy, Math.min(w, h) * 0.5, Math.min(w, h) * 0.5 + 70 * u * s, 11, seed)} {...common} {...draw(k)} strokeDasharray={undefined} strokeDashoffset={undefined} pathLength={undefined}
        strokeOpacity={clamp(k * 2)} transform={`translate(${cx} ${cy}) scale(${0.6 + k * 0.4}) translate(${-cx} ${-cy})`} />);
    else if (shape === 'exclamation') {
        const hh = Math.max(h, 120 * u);
        two(roughLine(cx, cy - hh / 2, cx - 4 * u, cy + hh * 0.2, seed, 3 * u), `M ${cx - 5 * u} ${cy + hh * 0.42} L ${cx - 3 * u} ${cy + hh * 0.46}`, 0.75);
        paths.push(<path key="c" d={burst(cx, cy - hh * 0.1, hh * 0.42, hh * 0.62, 6, seed, -Math.PI * 0.95, -Math.PI * 0.05)} {...common} strokeWidth={sw * 0.7} fill="none" strokeLinecap="round" opacity={clamp((k - 0.7) * 4)} />);
    } else if (shape === 'arrow' || shape === 'connector') {
        const tx = clamp(p.toX ?? 0.7) * W, ty = clamp(p.toY ?? 0.6) * H;
        const a = arrow(cx, cy, tx, ty, shape === 'connector' ? 0.28 : 0.16, 40 * u * s, seed);
        two(a.shaft, a.head);
        labelAt = { x: cx, y: cy - 30 * u };
    } else paths.push(<path key="a" d={roughEllipse(cx, cy, w / 2, h / 2, seed)} {...common} {...draw(k)} />);
    return (
        <Full p={p}>
            <svg width={W} height={H} style={{ position: 'absolute', inset: 0, overflow: 'visible', filter: p.shadow ? `drop-shadow(0 ${3 * u}px ${5 * u}px rgba(0,0,0,.45))` : 'none' }}>
                <defs><Wobble id="dcw" seed={seed} amount={5 * u} freq={0.018 / Math.max(0.5, u)} /></defs>
                <g filter="url(#dcw)">{paths}</g>
            </svg>
            {p.label && (
                <div style={{ position: 'absolute', left: labelAt.x, top: labelAt.y, transform: `translate(-50%, -100%) rotate(-3deg)`, fontFamily: FONT.hand, fontWeight: 700,
                    fontSize: 78 * u * s, color: p.accent, whiteSpace: 'nowrap', textShadow: `0 ${2 * u}px ${8 * u}px rgba(0,0,0,.55)`, opacity: prog(frame, end * 0.6, end + 2) }}>{p.label}</div>
            )}
        </Full>
    );
};
