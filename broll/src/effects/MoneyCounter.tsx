// Money counter: a big number counts up with a marker swipe behind it and a label under it.
import React from 'react';
import { interpolate } from 'remotion';
import { Common, Place, ease, fmtNumber, useInOut } from '../lib/common';
import { useVibe } from '../lib/vibe';

type P = Common & { prefix: string; value: number; suffix: string; decimals: number; label: string; color: string; from?: number };

export const MoneyCounter: React.FC<P> = (p) => {
    const { frame, durationInFrames: D, inn } = useInOut(p, (D0) => Math.max(8, Math.round(D0 * 0.6)));
    const end = Math.max(8, Math.round(D * 0.6));
    const k = interpolate(frame, [2, end], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
    const swipe = interpolate(frame, [4, end * 0.7], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
    const land = frame > end ? Math.max(0, 1 - (frame - end) / 8) : 0;
    const L = useVibe(p);
    const dec = Math.max(0, Math.min(3, Math.round(p.decimals || 0)));
    const text = (p.prefix || '') + fmtNumber((Number(p.from) || 0) + ((p.value || 0) - (Number(p.from) || 0)) * k, dec) + (p.suffix || '');
    // the box is sized for the final value so the layout does not jump as it counts
    const final = (p.prefix || '') + fmtNumber(p.value || 0, dec) + (p.suffix || '');

    return (
        <Place p={p}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', ...L.enter(inn, 'up', `scale(${1 + land * 0.06})`) }}>
                <div style={{ position: 'relative', ...L.text.num(220), whiteSpace: 'nowrap' }}>
                    <div style={{ position: 'absolute', left: -24, right: -24, top: '22%', bottom: '8%', background: L.accent,
                        transform: `skewX(-8deg) scaleX(${swipe})`, transformOrigin: 'left center', borderRadius: L.r(10), opacity: 0.95 }} />
                    <div style={{ visibility: 'hidden' }}>{final}</div>
                    <div style={{ position: 'absolute', inset: 0, textAlign: 'center', color: p.color || L.bare.color,
                        textShadow: L.bare.shadow }}>{text}</div>
                </div>
                {p.label && (
                    <div style={{ marginTop: 18, ...L.text.body(52, { color: L.bare.color, fontWeight: Math.max(600, L.v.font.bodyWeight) }),
                        textShadow: L.bare.shadow, opacity: k }}>{p.label}</div>
                )}
            </div>
        </Place>
    );
};
