// Mini chart: bars that grow one after another, or a line that draws left to right behind a leading dot, with the
// value over each point. Points are "Label | value" lines.
import React from 'react';
import { Common, FONT, Place, clamp, ease, fmtNumber, prog, useInOut } from '../lib/common';
import { face, plainClassic, useVibe } from '../lib/vibe';

type P = Common & { mode: string; title: string; points: string[]; prefix: string; suffix: string; dark: boolean };

export function parsePoints(list: string[]) {
    return (list || []).map(String).map((s, i) => {
        const m = s.split('|');
        const raw = (m.length > 1 ? m[m.length - 1] : s).replace(/,/g, '');
        const num = /-?\d+(\.\d+)?/.exec(raw);
        let v = num ? Number(num[0]) : 0;
        if (/k\b/i.test(raw)) v *= 1; // the unit is shown by `suffix`; the bar heights only need the ratio
        return { label: m.length > 1 ? m.slice(0, -1).join('|').trim() : String(i + 1), value: v };
    }).slice(0, 10);
}

export const MiniChart: React.FC<P> = (p) => {
    const { frame, durationInFrames: D, inn } = useInOut(p, (D0) => Math.max(14, Math.round(D0 * 0.6)));
    const end = Math.max(14, Math.round(D * 0.6));
    const pts = parsePoints(p.points);
    const n = Math.max(1, pts.length), max = Math.max(1, ...pts.map(q => q.value)), min = Math.min(0, ...pts.map(q => q.value));
    const W = 720, H = 330, padL = 20, padR = 20, slot = (W - padL - padR) / n;
    const L = useVibe(p), C = plainClassic(p, L);
    const fg = C ? (p.dark ? '#f7f8fa' : '#181a1e') : L.ink, dim = C ? (p.dark ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.5)') : L.dim, grid = C ? (p.dark ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.08)') : L.track;
    const dotFill = C ? (p.dark ? '#16181c' : '#fbfaf7') : L.bg, num = C ? FONT.sans : L.v.font.num;
    const yOf = (v: number) => H - 8 - ((v - min) / (max - min || 1)) * (H - 70);
    const xOf = (i: number) => padL + slot * (i + 0.5);
    const val = (v: number) => (p.prefix || '') + fmtNumber(v, v % 1 ? 1 : 0) + (p.suffix || '');
    const line = String(p.mode) === 'line';
    // line: how far along the points the pen is (0..n-1)
    const pen = ease(prog(frame, 4, end)) * (n - 1);
    const seg = Math.min(n - 2, Math.floor(pen)), f = pen - seg;
    const penX = n > 1 ? xOf(seg) + (xOf(seg + 1) - xOf(seg)) * f : xOf(0);
    const penY = n > 1 ? yOf(pts[seg].value) + (yOf(pts[seg + 1].value) - yOf(pts[seg].value)) * f : yOf(pts[0]?.value || 0);
    const path = pts.map((q, i) => `${i ? 'L' : 'M'} ${xOf(i)} ${yOf(q.value)}`).join(' ');
    return (
        <Place p={p}>
            <div style={{ width: W + 64, padding: '26px 32px 22px', ...(C ? { borderRadius: 24, background: p.dark ? 'rgba(22,24,28,.94)' : 'rgba(251,250,247,.97)', boxShadow: '0 22px 54px rgba(0,0,0,.32)' } : L.card(24)),
                opacity: Math.min(1, inn * 1.4), transform: `translateY(${(1 - inn) * 34}px)`, fontFamily: C ? FONT.sans : L.v.font.body }}>
                {p.title && <div style={{ ...face(L, 'display', { fontWeight: 700 }, C, 34), color: fg, marginBottom: 10 }}>{p.title}</div>}
                <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
                    {[0.25, 0.5, 0.75, 1].map(g => <line key={g} x1={0} x2={W} y1={H - 8 - g * (H - 70)} y2={H - 8 - g * (H - 70)} stroke={grid} strokeWidth={2} />)}
                    <line x1={0} x2={W} y1={H - 6} y2={H - 6} stroke={dim} strokeWidth={2} />
                    {!line && pts.map((q, i) => {
                        const k = ease(prog(frame, 3 + (i / n) * (end - 12), 3 + (i / n) * (end - 12) + 12));
                        const h = (H - 8 - yOf(q.value)) * k, w = Math.min(96, slot * 0.62);
                        return (
                            <g key={i}>
                                <rect x={xOf(i) - w / 2} y={H - 8 - h} width={w} height={Math.max(0, h)} rx={L.r(10)} fill={p.accent} opacity={i === n - 1 ? 1 : 0.62} />
                                <text x={xOf(i)} y={H - 20 - h} textAnchor="middle" fontSize={28} fontWeight={800} fontFamily={num} fill={fg} opacity={clamp(k * 2 - 1)}>{val(q.value)}</text>
                            </g>
                        );
                    })}
                    {line && (
                        <>
                            <path d={path} fill="none" stroke={p.accent} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round"
                                pathLength={1} strokeDasharray={1} strokeDashoffset={1 - clamp(lengthShare(pts.map((q, i) => [xOf(i), yOf(q.value)]), pen))} />
                            {pts.map((q, i) => (
                                <g key={i} opacity={clamp((pen - i) * 4 + 1)}>
                                    <circle cx={xOf(i)} cy={yOf(q.value)} r={9} fill={dotFill} stroke={p.accent} strokeWidth={5} />
                                    <text x={xOf(i)} y={yOf(q.value) - 22} textAnchor="middle" fontSize={28} fontWeight={800} fontFamily={num} fill={fg}>{val(q.value)}</text>
                                </g>
                            ))}
                            <circle cx={penX} cy={penY} r={15} fill={p.accent} />
                            <circle cx={penX} cy={penY} r={15 + (frame % 18)} fill="none" stroke={p.accent} strokeWidth={3} opacity={Math.max(0, 0.6 - (frame % 18) / 30)} />
                        </>
                    )}
                </svg>
                <div style={{ display: 'flex', paddingLeft: padL, paddingRight: padR, marginTop: 8 }}>
                    {pts.map((q, i) => <div key={i} style={{ width: slot, textAlign: 'center', fontSize: 24, fontWeight: 600, color: dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{q.label}</div>)}
                </div>
            </div>
        </Place>
    );
};

// The share of a polyline's length covered when the pen is at point index `pen` (fractional).
function lengthShare(P: number[][], pen: number) {
    let total = 0, upto = 0;
    for (let i = 0; i < P.length - 1; i++) {
        const l = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]);
        total += l;
        upto += l * clamp(pen - i);
    }
    return total ? upto / total : 1;
}
