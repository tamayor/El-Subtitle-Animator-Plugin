// Live cursor: a named cursor glides in, drags a selection box (handles + live size label) around a spot, and rests.
import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { Common, FONT, clamp, ease, useInOut, useUnit } from '../lib/common';

type P = Common & { name: string; boxW: number; boxH: number; sizeLabel: boolean; boxColor: string };

const Arrow: React.FC<{ s: number }> = ({ s }) => (
    <svg width={34 * s} height={42 * s} viewBox="0 0 34 42" style={{ overflow: 'visible', filter: 'drop-shadow(0 3px 6px rgba(0,0,0,.45))' }}>
        <path d="M2 2 L2 34 L10.5 26.5 L16.5 40 L22 37.5 L16 24.5 L28 24.5 Z" fill="#fff" stroke="#111" strokeWidth={2.2} strokeLinejoin="round" />
    </svg>
);

export const LiveCursor: React.FC<P> = (p) => {
    const { width, height } = useVideoConfig();
    const { frame, durationInFrames: D, inn, out, delay } = useInOut(p, (D0) => Math.max(Math.max(8, Math.round(D0 * 0.22)) + 8, Math.round(D0 * 0.6)));
    const u = useUnit() * (p.scale || 1);
    const cx = clamp(p.x) * width, cy = clamp(p.y) * height;
    const bw = clamp(p.boxW, 0.02, 1) * width * (p.scale || 1), bh = clamp(p.boxH, 0.02, 1) * height * (p.scale || 1);
    const x0 = cx - bw / 2, y0 = cy - bh / 2;

    // timeline (fractions of the clip): glide to the corner, drag the box open, settle
    const tGlide = Math.max(8, Math.round(D * 0.22)), tDrag = Math.max(tGlide + 8, Math.round(D * 0.6));
    const g = interpolate(frame, [0, tGlide], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
    const d = interpolate(frame, [tGlide, tDrag], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
    const startX = width * 0.95, startY = height * 1.05;
    const idle = frame > tDrag ? Math.sin((frame - tDrag) / 9) * 4 * u : 0;
    const curX = frame < tGlide ? startX + (x0 - startX) * g : x0 + bw * d + idle;
    const curY = frame < tGlide ? startY + (y0 - startY) * g : y0 + bh * d + idle * 0.6;

    const w = bw * d, h = bh * d;
    const show = d > 0.001;
    const hs = 10 * u;   // handle size
    const label = `${Math.round(w / 10) * 10} × ${Math.round(h / 10) * 10}`;
    const handles = [[0, 0], [0.5, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1]];

    return (
        <AbsoluteFill style={{ opacity: useCurrentFrame() < delay ? 0 : out }}>
            {show && (
                <div style={{ position: 'absolute', left: x0, top: y0, width: w, height: h,
                    border: `${2.5 * u}px solid ${p.boxColor}`, background: 'rgba(255,255,255,0.06)', boxSizing: 'border-box' }}>
                    {handles.map(([hx, hy], i) => (
                        <div key={i} style={{ position: 'absolute', left: hx * w - hs / 2 - 1.25 * u, top: hy * h - hs / 2 - 1.25 * u,
                            width: hs, height: hs, background: '#fff', border: `${2 * u}px solid ${p.boxColor}`, boxSizing: 'border-box', opacity: d }} />
                    ))}
                    {p.sizeLabel && (
                        <div style={{ position: 'absolute', left: '50%', top: -44 * u, transform: 'translateX(-50%)',
                            background: p.boxColor, color: '#1a1a1a', fontFamily: FONT.mono, fontSize: 20 * u, fontWeight: 700,
                            padding: `${4 * u}px ${12 * u}px`, borderRadius: 4 * u, whiteSpace: 'nowrap', opacity: d }}>{label}</div>
                    )}
                </div>
            )}
            <div style={{ position: 'absolute', left: curX, top: curY, opacity: inn }}>
                <Arrow s={u * 1.4} />
                <div style={{ position: 'absolute', left: 30 * u, top: 46 * u, background: p.accent, color: '#0f1a12',
                    fontFamily: FONT.sans, fontWeight: 600, fontSize: 24 * u, padding: `${5 * u}px ${14 * u}px`,
                    borderRadius: 8 * u, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.35)' }}>{p.name}</div>
            </div>
        </AbsoluteFill>
    );
};
