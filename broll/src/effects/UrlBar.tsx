// URL bar: a clean browser address pill that types out the domain or link CTA with an open-link arrow.
import React from 'react';
import { spring } from 'remotion';
import { Common, FONT, Place, typed, useInOut } from '../lib/common';

type P = Common & { url: string; cta: string; dark: boolean };

export const UrlBar: React.FC<P> = (p) => {
    const url = String(p.url || 'example.com');
    const { frame, fps, durationInFrames: D, inn, out } = useInOut(p, (_D0, fps0) => Math.max(14, Math.round(url.length / 24 * fps0 + 6)));
    const shown = typed(url, frame, 4, fps, 24);
    const done = shown.length >= url.length;
    const pop = spring({ frame: Math.max(0, frame - Math.round(D * 0.4)), fps, durationInFrames: 12, config: { damping: 14, stiffness: 180 } });

    const bg = p.dark ? 'rgba(24, 26, 31, 0.95)' : 'rgba(252, 251, 248, 0.97)';
    const fg = p.dark ? '#f5f6f8' : '#181a1e';
    const border = p.dark ? 'rgba(255,255,255,.16)' : 'rgba(0,0,0,.1)';

    return (
        <Place p={p}>
            <div style={{ minWidth: 520, maxWidth: 820, padding: '14px 18px 14px 22px', borderRadius: 999, background: bg,
                border: `2px solid ${border}`, boxShadow: '0 20px 48px rgba(0,0,0,.32)',
                display: 'flex', alignItems: 'center', gap: 14,
                opacity: out * Math.min(1, inn * 1.4), transform: `translateY(${(1 - inn) * 28}px)` }}>
                <div style={{ width: 16, height: 16, borderRadius: 999, background: p.accent, flexShrink: 0 }} />
                <div style={{ flex: 1, fontFamily: FONT.mono, fontWeight: 700, fontSize: 32, color: fg,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {shown}{!done && <span style={{ opacity: frame % 14 < 7 ? 1 : 0, color: p.accent }}>|</span>}
                </div>
                <div style={{ padding: '8px 18px', borderRadius: 999, background: p.accent, color: '#111',
                    fontFamily: FONT.sans, fontWeight: 800, fontSize: 22, flexShrink: 0,
                    transform: `scale(${0.85 + pop * 0.15})` }}>
                    {p.cta || 'Visit'} ↗
                </div>
            </div>
        </Place>
    );
};
