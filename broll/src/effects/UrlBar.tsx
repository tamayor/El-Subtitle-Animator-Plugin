// URL bar: a clean browser address pill that types out the domain or link CTA with an open-link arrow.
import React from 'react';
import { spring } from 'remotion';
import { Common, FONT, Place, typed, useInOut } from '../lib/common';
import { useVibe } from '../lib/vibe';

type P = Common & { url: string; cta: string; dark: boolean };

export const UrlBar: React.FC<P> = (p) => {
    const url = String(p.url || 'example.com');
    const { frame, fps, durationInFrames: D, inn } = useInOut(p, (_D0, fps0) => Math.max(14, Math.round(url.length / 24 * fps0 + 6)));
    const shown = typed(url, frame, 4, fps, 24);
    const done = shown.length >= url.length;
    const pop = spring({ frame: Math.max(0, frame - Math.round(D * 0.4)), fps, durationInFrames: 12, config: useVibe(p).spring });

    const L = useVibe(p);

    return (
        <Place p={p}>
            <div style={{ ...L.card(999), minWidth: 520, maxWidth: 820, padding: '14px 18px 14px 22px',
                display: 'flex', alignItems: 'center', gap: 14, ...L.enter(inn) }}>
                <div style={{ width: 16, height: 16, borderRadius: L.r(999), background: L.accent, flexShrink: 0 }} />
                <div style={{ flex: 1, fontFamily: FONT.mono, fontWeight: 700, fontSize: 32, color: L.ink,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {shown}{!done && <span style={{ opacity: frame % 14 < 7 ? 1 : 0, color: L.accent }}>|</span>}
                </div>
                <div style={{ padding: '8px 18px', borderRadius: L.r(999), background: L.accent,
                    ...L.text.label(22, { color: L.onAccent, lineHeight: 1.3 }), flexShrink: 0,
                    transform: `scale(${0.85 + pop * 0.15})` }}>
                    {p.cta || 'Visit'} ↗
                </div>
            </div>
        </Place>
    );
};
