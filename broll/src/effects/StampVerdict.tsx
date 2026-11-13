// Stamp verdict: a claim card with an animated MYTH / FACT stamp that slams onto it.
import React from 'react';
import { interpolate, spring } from 'remotion';
import { Common, FONT, Place, useInOut } from '../lib/common';

type P = Common & { claim: string; verdict: string; isTrue: boolean; dark: boolean };

export const StampVerdict: React.FC<P> = (p) => {
    const { frame, fps, durationInFrames: D, inn, out } = useInOut(p, (D0) => Math.max(8, Math.round(D0 * 0.25)) + 12);
    const slamAt = Math.max(8, Math.round(D * 0.25));
    const slam = spring({ frame: Math.max(0, frame - slamAt), fps, durationInFrames: 12, config: { damping: 11, stiffness: 220 } });
    const stampScale = interpolate(slam, [0, 1], [2.4, 1]);
    const shake = frame >= slamAt && frame < slamAt + 6 ? Math.sin((frame - slamAt) * 2.5) * (6 - (frame - slamAt)) : 0;

    const bg = p.dark ? '#181a1f' : '#fcfbf7';
    const fg = p.dark ? '#f5f6f8' : '#181a1e';
    const stampColor = p.isTrue ? (p.accent || '#3fb950') : '#e04f4f';

    return (
        <Place p={p}>
            <div style={{ position: 'relative', width: 640, padding: '28px 34px', borderRadius: 20, background: bg,
                boxShadow: '0 22px 54px rgba(0,0,0,.32)', border: `1px solid ${p.dark ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.1)'}`,
                opacity: out * Math.min(1, inn * 1.4), transform: `translate(${shake}px, ${(1 - inn) * 30 + shake * 0.5}px)` }}>
                <div style={{ fontFamily: FONT.sans, fontWeight: 700, fontSize: 34, lineHeight: 1.25, color: fg, textAlign: 'center' }}>
                    {p.claim || 'More hashtags = more views'}
                </div>
                {frame >= slamAt && (
                    <div style={{ position: 'absolute', right: -16, top: -22, padding: '8px 20px', borderRadius: 12,
                        border: `5px solid ${stampColor}`, color: stampColor, background: bg,
                        fontFamily: FONT.sans, fontWeight: 800, fontSize: 36, letterSpacing: 2, textTransform: 'uppercase',
                        transform: `rotate(-10deg) scale(${stampScale})`, opacity: Math.min(1, slam * 2),
                        boxShadow: '0 10px 24px rgba(0,0,0,.22)' }}>
                        {p.isTrue ? '✓ ' : '✕ '}{p.verdict || (p.isTrue ? 'FACT' : 'MYTH')}
                    </div>
                )}
            </div>
        </Place>
    );
};
