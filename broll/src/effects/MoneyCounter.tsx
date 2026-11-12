// Money counter: a big number counts up with a marker swipe behind it and a label under it.
import React from 'react';
import { interpolate } from 'remotion';
import { Common, FONT, Place, ease, fmtNumber, useInOut } from '../lib/common';

type P = Common & { prefix: string; value: number; suffix: string; decimals: number; label: string; color: string };

export const MoneyCounter: React.FC<P> = (p) => {
    const { frame, durationInFrames: D, inn, out } = useInOut(p, (D0) => Math.max(8, Math.round(D0 * 0.6)));
    const end = Math.max(8, Math.round(D * 0.6));
    const k = interpolate(frame, [2, end], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
    const swipe = interpolate(frame, [4, end * 0.7], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
    const land = frame > end ? Math.max(0, 1 - (frame - end) / 8) : 0;
    const dec = Math.max(0, Math.min(3, Math.round(p.decimals || 0)));
    const text = (p.prefix || '') + fmtNumber((p.value || 0) * k, dec) + (p.suffix || '');
    // the box is sized for the final value so the layout does not jump as it counts
    const final = (p.prefix || '') + fmtNumber(p.value || 0, dec) + (p.suffix || '');

    return (
        <Place p={p}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: out * Math.min(1, inn * 1.5),
                transform: `translateY(${(1 - inn) * 40}px) scale(${1 + land * 0.06})` }}>
                <div style={{ position: 'relative', fontFamily: FONT.sans, fontWeight: 800, fontSize: 220, lineHeight: 1,
                    fontVariantNumeric: 'tabular-nums', letterSpacing: -6 }}>
                    <div style={{ position: 'absolute', left: -24, right: -24, top: '22%', bottom: '8%', background: p.accent,
                        transform: `skewX(-8deg) scaleX(${swipe})`, transformOrigin: 'left center', borderRadius: 10, opacity: 0.95 }} />
                    <div style={{ visibility: 'hidden' }}>{final}</div>
                    <div style={{ position: 'absolute', inset: 0, textAlign: 'center', color: p.color || '#fff',
                        textShadow: '0 6px 24px rgba(0,0,0,.45)' }}>{text}</div>
                </div>
                {p.label && (
                    <div style={{ marginTop: 18, fontFamily: FONT.sans, fontWeight: 600, fontSize: 52, color: '#fff',
                        textShadow: '0 3px 14px rgba(0,0,0,.6)', opacity: k }}>{p.label}</div>
                )}
            </div>
        </Place>
    );
};
