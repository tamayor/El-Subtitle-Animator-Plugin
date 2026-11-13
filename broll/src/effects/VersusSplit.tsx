// Versus split: two side-by-side cards (or a replacement comparison) with an animated VS / arrow badge.
import React from 'react';
import { interpolate, spring } from 'remotion';
import { Common, FONT, Place, ease, useInOut } from '../lib/common';

type P = Common & { left: string; right: string; strikeLeft: boolean; leftColor: string; dark: boolean };

export const VersusSplit: React.FC<P> = (p) => {
    const { frame, fps, durationInFrames: D, inn, out } = useInOut(p, (D0) => Math.max(12, Math.round(D0 * 0.55)));
    const buildEnd = Math.max(12, Math.round(D * 0.55));
    const rightIn = spring({ frame: Math.max(0, frame - 6), fps, durationInFrames: 14, config: { damping: 14, stiffness: 160 } });
    const strike = interpolate(frame, [Math.round(buildEnd * 0.45), buildEnd], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });

    const bg = p.dark ? '#17191c' : '#fbfaf7';
    const fg = p.dark ? '#f5f6f8' : '#1b1d21';
    const dim = p.dark ? 'rgba(255,255,255,.65)' : 'rgba(27,29,33,.65)';
    const border = p.dark ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.1)';

    return (
        <Place p={p}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18, opacity: out * Math.min(1, inn * 1.4),
                transform: `translateY(${(1 - inn) * 32}px) scale(${0.92 + inn * 0.08})` }}>
                {/* Left card */}
                <div style={{ position: 'relative', minWidth: 250, maxWidth: 360, padding: '24px 28px', borderRadius: 20,
                    background: bg, border: `2px solid ${border}`, boxShadow: '0 18px 42px rgba(0,0,0,.28)',
                    fontFamily: FONT.sans, fontWeight: 700, fontSize: 38, lineHeight: 1.15, textAlign: 'center',
                    color: p.strikeLeft ? dim : fg, opacity: p.strikeLeft ? 1 - strike * 0.25 : 1 }}>
                    <span style={{ position: 'relative', display: 'inline-block' }}>
                        {p.left || 'Old way'}
                        {p.strikeLeft && (
                            <span style={{ position: 'absolute', left: -6, right: -6, top: '52%', height: 6, borderRadius: 4,
                                background: p.leftColor || '#e05252', transform: `scaleX(${strike})`, transformOrigin: 'left center' }} />
                        )}
                    </span>
                </div>

                {/* Center badge */}
                <div style={{ width: 64, height: 64, borderRadius: 999, background: p.accent, color: '#111',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    fontFamily: FONT.sans, fontWeight: 800, fontSize: p.strikeLeft ? 30 : 24, letterSpacing: -0.5,
                    boxShadow: '0 10px 26px rgba(0,0,0,.3)', transform: `scale(${0.6 + rightIn * 0.4})` }}>
                    {p.strikeLeft ? '→' : 'VS'}
                </div>

                {/* Right card */}
                <div style={{ minWidth: 250, maxWidth: 360, padding: '24px 28px', borderRadius: 20,
                    background: bg, border: `3px solid ${p.accent}`, boxShadow: '0 22px 48px rgba(0,0,0,.32)',
                    fontFamily: FONT.sans, fontWeight: 800, fontSize: 40, lineHeight: 1.15, textAlign: 'center', color: fg,
                    opacity: rightIn, transform: `translateX(${(1 - rightIn) * 28}px) scale(${0.94 + rightIn * 0.06})` }}>
                    {p.right || 'New way'}
                </div>
            </div>
        </Place>
    );
};
