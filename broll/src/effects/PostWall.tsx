// Post wall: a grid of tiles fills in, tile by tile, while the counter runs up to the number.
import React from 'react';
import { interpolate } from 'remotion';
import { Common, FONT, Place, ease, fmtNumber, rand, useInOut } from '../lib/common';
import { useVibe } from '../lib/vibe';

type P = Common & { count: number; unit: string; tag: string; cols: number; rows: number };

export const PostWall: React.FC<P> = (p) => {
    const { frame, durationInFrames: D, inn } = useInOut(p, (D0) => Math.max(10, D0 - (p.exit ?? 8) - 10));
    const L = useVibe(p), classic = L.v.id === 'classic';
    const cols = Math.max(4, Math.round(p.cols || 26)), rows = Math.max(2, Math.round(p.rows || 9));
    const N = cols * rows, tile = 30, gap = 6;
    const W = cols * (tile + gap) - gap;
    const fillEnd = Math.max(10, D - (p.exit ?? 8) - 10);
    const k = interpolate(frame, [p.enter ?? 10, fillEnd], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
    const lit = k * N;
    const shades = ['#e9e4d6', '#c9c3b2', '#a8b3a0', '#8b9a86', L.accent, '#f1efe7', '#6f7d6c'];
    const tiles = React.useMemo(() => Array.from({ length: N }, (_, i) => {
        const c = i % cols, r = Math.floor(i / cols);
        return {
            order: c * rows + r + (rand(i) - 0.5) * rows * 0.8,
            shadeIdx: Math.floor(rand(i + 7) * 7),
        };
    }), [N, cols, rows]);

    return (
        <Place p={p}>
            <div style={{ width: W, ...L.enter(inn) }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12, color: L.bare.color }}>
                    <div style={{ fontFamily: classic ? FONT.mono : L.v.font.label, fontWeight: classic ? 400 : L.v.font.labelWeight, fontSize: 22, letterSpacing: 2, textTransform: 'uppercase', opacity: 0.9, textShadow: L.bare.shadow }}>{p.tag}</div>
                    <div style={{ fontFamily: classic ? FONT.mono : L.v.font.num, fontWeight: classic ? 700 : L.v.font.numWeight, fontSize: 76, lineHeight: 1, fontVariantNumeric: 'tabular-nums', textShadow: L.bare.shadow }}>
                        {fmtNumber(Math.round((p.count || 0) * k))}
                        <span style={{ fontSize: 20, fontWeight: 400, marginLeft: 10, letterSpacing: 2, textTransform: 'uppercase' }}>{p.unit}</span>
                    </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, ${tile}px)`, gap }}>
                    {tiles.map((t, i) => {
                        const on = t.order < lit;
                        const fresh = on && t.order > lit - rows * 1.5;
                        return <div key={i} style={{ width: tile, height: tile, borderRadius: L.r(3),
                            background: on ? shades[t.shadeIdx] : 'rgba(255,255,255,0.08)',
                            outline: fresh ? `2px solid ${L.accent}` : 'none', transform: fresh ? 'scale(1.12)' : 'none' }} />;
                    })}
                </div>
            </div>
        </Place>
    );
};
