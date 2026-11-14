// Stamp verdict: a claim card with an animated MYTH / FACT stamp that slams onto it.
import React from 'react';
import { interpolate, spring } from 'remotion';
import { Common, Place, useInOut } from '../lib/common';
import { useVibe } from '../lib/vibe';

type P = Common & { claim: string; verdict: string; isTrue: boolean; dark: boolean };

export const StampVerdict: React.FC<P> = (p) => {
    const { frame, fps, durationInFrames: D, inn } = useInOut(p, (D0) => Math.max(8, Math.round(D0 * 0.25)) + 12);
    const slamAt = Math.max(8, Math.round(D * 0.25));
    const slam = spring({ frame: Math.max(0, frame - slamAt), fps, durationInFrames: 12, config: { damping: 11, stiffness: 220 } });
    const stampScale = interpolate(slam, [0, 1], [2.4, 1]);
    const shake = frame >= slamAt && frame < slamAt + 6 ? Math.sin((frame - slamAt) * 2.5) * (6 - (frame - slamAt)) : 0;

    const L = useVibe(p);
    const stampColor = p.isTrue ? (L.accent === L.ink ? '#3fb950' : L.accent) : L.danger;

    return (
        <Place p={p}>
            <div style={{ ...L.card(20), position: 'relative', width: 640, padding: '28px 34px',
                ...L.enter(inn, 'up', `translate(${shake}px, ${shake * 0.5}px)`) }}>
                <div style={{ ...L.text.display(34, { lineHeight: 1.25 }), textAlign: 'center' }}>
                    {p.claim || 'More hashtags = more views'}
                </div>
                {frame >= slamAt && (
                    <div style={{ position: 'absolute', right: -16, top: -22, padding: '8px 20px', borderRadius: L.r(12),
                        border: `5px solid ${stampColor}`, background: L.bg,
                        ...L.text.num(36, { color: stampColor, letterSpacing: '0.05em', lineHeight: 1.2 }), textTransform: 'uppercase',
                        transform: `rotate(-10deg) scale(${stampScale})`, opacity: Math.min(1, slam * 2) }}>
                        {p.isTrue ? '✓ ' : '✕ '}{p.verdict || (p.isTrue ? 'FACT' : 'MYTH')}
                    </div>
                )}
            </div>
        </Place>
    );
};
