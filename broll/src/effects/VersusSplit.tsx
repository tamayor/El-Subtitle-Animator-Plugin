// Versus split: two side-by-side cards (or a replacement comparison) with an animated VS / arrow badge.
import React from 'react';
import { interpolate, spring } from 'remotion';
import { Common, Place, ease, useInOut } from '../lib/common';
import { useVibe } from '../lib/vibe';

type P = Common & { left: string; right: string; strikeLeft: boolean; leftColor: string; dark: boolean };

export const VersusSplit: React.FC<P> = (p) => {
    const { frame, fps, durationInFrames: D, inn } = useInOut(p, (D0) => Math.max(12, Math.round(D0 * 0.55)));
    const buildEnd = Math.max(12, Math.round(D * 0.55));
    const L0 = useVibe(p).spring;
    const rightIn = spring({ frame: Math.max(0, frame - 6), fps, durationInFrames: 14, config: L0 });
    const strike = interpolate(frame, [Math.round(buildEnd * 0.45), buildEnd], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });

    const L = useVibe(p);

    return (
        <Place p={p}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18, ...L.enter(inn) }}>
                {/* Left card */}
                <div style={{ ...L.card(20), position: 'relative', minWidth: 250, maxWidth: 360, padding: '24px 28px',
                    ...L.text.display(38, { lineHeight: 1.15, color: p.strikeLeft ? L.dim : L.ink }), textAlign: 'center',
                    opacity: p.strikeLeft ? 1 - strike * 0.25 : 1 }}>
                    <span style={{ position: 'relative', display: 'inline-block' }}>
                        {p.left || 'Old way'}
                        {p.strikeLeft && (
                            <span style={{ position: 'absolute', left: -6, right: -6, top: '52%', height: 6, borderRadius: 4,
                                background: p.leftColor || L.danger, transform: `scaleX(${strike})`, transformOrigin: 'left center' }} />
                        )}
                    </span>
                </div>

                {/* Center badge */}
                <div style={{ width: 64, height: 64, borderRadius: L.r(999), background: L.accent,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    ...L.text.num(p.strikeLeft ? 30 : 24, { color: L.onAccent }), transform: `scale(${0.6 + rightIn * 0.4})` }}>
                    {p.strikeLeft ? '→' : 'VS'}
                </div>

                {/* Right card */}
                <div style={{ ...L.card(20, { borderColor: L.accent, borderWidth: Math.max(3, L.v.borderWidth) }), minWidth: 250, maxWidth: 360, padding: '24px 28px',
                    ...L.text.display(40, { lineHeight: 1.15 }), textAlign: 'center', ...L.enter(rightIn, 'right') }}>
                    {p.right || 'New way'}
                </div>
            </div>
        </Place>
    );
};
