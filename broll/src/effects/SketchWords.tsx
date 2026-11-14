// Sketch words: the big word is drawn on in pencil (outline first, hatching after), with a scribbled underline and a
// small handwritten note above it.
import React from 'react';
import { interpolate } from 'remotion';
import { Common, FONT, Place, typed, useInOut } from '../lib/common';
import { useVibe } from '../lib/vibe';

type P = Common & { word: string; note: string; ink: string; paper: boolean };

export const SketchWords: React.FC<P> = (p) => {
    const accent = useVibe(p).accent;   // the vibe's accent when the clip has none of its own
    const { frame, fps, durationInFrames: D, out } = useInOut(p, (D0, f) => Math.max(12, Math.min(D0 * 0.55, f * 1.2)) + 10);
    const word = String(p.word || '');
    const fs = 300;
    const W = Math.max(400, word.length * fs * 0.52 + 80), H = 420;
    const drawEnd = Math.max(12, Math.min(D * 0.55, fps * 1.2));
    const stroke = interpolate(frame, [2, drawEnd], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    const hatch = interpolate(frame, [drawEnd * 0.6, drawEnd + 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    const line = interpolate(frame, [drawEnd, drawEnd + 10], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    const note = typed(String(p.note || ''), frame, 0, fps, 12);
    const ink = p.ink || '#7a2a1e';
    const id = 'h' + word.replace(/\W/g, '');
    const boil = Math.floor(frame / 4) % 3;    // a little hand-drawn jitter

    return (
        <Place p={p}>
            <div style={{ position: 'relative', width: W, height: H, opacity: out,
                background: p.paper ? '#f3eee2' : 'transparent', borderRadius: p.paper ? 18 : 0,
                boxShadow: p.paper ? '0 14px 40px rgba(0,0,0,.3)' : 'none' }}>
                <div style={{ position: 'absolute', left: 40, top: 0, fontFamily: FONT.hand, fontSize: 92, color: p.paper ? '#333' : '#fff',
                    transform: 'rotate(-4deg)', textShadow: p.paper ? 'none' : '0 2px 10px rgba(0,0,0,.5)' }}>{note}</div>
                <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
                    <defs>
                        <pattern id={id} width={8} height={8} patternUnits="userSpaceOnUse" patternTransform={`rotate(${35 + boil * 4})`}>
                            <line x1={0} y1={0} x2={0} y2={8} stroke={ink} strokeWidth={4.2} />
                        </pattern>
                        <clipPath id={id + 'c'}><rect x={-20} y={-20} width={(W + 40) * hatch} height={H + 40} /></clipPath>
                    </defs>
                    <text x={W / 2} y={330} textAnchor="middle" fontFamily={FONT.serif} fontSize={fs} fill={`url(#${id})`}
                        clipPath={`url(#${id}c)`} opacity={0.9}>{word}</text>
                    <text x={W / 2} y={330} textAnchor="middle" fontFamily={FONT.serif} fontSize={fs} fill="none" stroke={ink}
                        strokeWidth={3.5} strokeDasharray={4000} strokeDashoffset={4000 * stroke} strokeLinejoin="round"
                        transform={`translate(${boil - 1} ${(boil % 2) - 0.5})`}>{word}</text>
                    <path d={`M ${W * 0.12} 372 C ${W * 0.35} 356, ${W * 0.6} 390, ${W * 0.88} 366`} pathLength={1}
                        stroke={accent} strokeWidth={10} fill="none" strokeLinecap="round" strokeDasharray={1} strokeDashoffset={line} opacity={0.85} />
                </svg>
            </div>
        </Place>
    );
};
