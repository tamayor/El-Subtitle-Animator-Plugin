// Post wall: a grid of tiles fills in, tile by tile, while the counter runs up to the number. With face pictures
// (face1..face4) every tile is one of them instead of a colour square: the same faces repeated ("seen 100 times").
import React from 'react';
import { Img, interpolate } from 'remotion';
import { Common, FONT, Place, ease, fmtNumber, rand, useInOut } from '../lib/common';
import { useVibe } from '../lib/vibe';

type P = Common & { count: number; unit: string; tag: string; cols: number; rows: number; face1?: string; face2?: string; face3?: string; face4?: string };

export const PostWall: React.FC<P> = (p) => {
    const { frame, durationInFrames: D, inn } = useInOut(p, (D0) => Math.max(10, D0 - (p.exit ?? 8) - 10));
    const L = useVibe(p), classic = L.v.id === 'classic';
    const cols = Math.max(4, Math.round(p.cols || 26)), rows = Math.max(2, Math.round(p.rows || 9));
    const faces = [p.face1, p.face2, p.face3, p.face4].filter((f): f is string => !!f);
    const N = cols * rows, tile = faces.length ? 56 : 30, gap = faces.length ? 8 : 6;
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
            face: Math.floor(rand(i + 13) * 4),
            tilt: (rand(i + 29) - 0.5) * 22,
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
                        if (faces.length) {
                            // a face sticker pops in (bigger while fresh), slightly tilted; an empty slot until then
                            return <div key={i} style={{ width: tile, height: tile, borderRadius: L.r(6), background: on ? 'transparent' : 'rgba(255,255,255,0.07)', position: 'relative' }}>
                                {on && <Img src={faces[t.face % faces.length]} style={{ position: 'absolute', inset: -4, width: tile + 8, height: tile + 8, objectFit: 'contain',
                                    transform: `rotate(${t.tilt}deg) scale(${fresh ? 1.25 : 1})`, filter: 'drop-shadow(0 3px 4px rgba(0,0,0,.45))' }} />}
                            </div>;
                        }
                        return <div key={i} style={{ width: tile, height: tile, borderRadius: L.r(3),
                            background: on ? shades[t.shadeIdx] : 'rgba(255,255,255,0.08)',
                            outline: fresh ? `2px solid ${L.accent}` : 'none', transform: fresh ? 'scale(1.12)' : 'none' }} />;
                    })}
                </div>
            </div>
        </Place>
    );
};
