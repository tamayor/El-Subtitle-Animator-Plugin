// Marker highlight: a clean phrase pill where a highlighter swipe (or redaction bar) sweeps across the focus word.
import React from 'react';
import { interpolate } from 'remotion';
import { Common, FONT, Place, ease, useInOut } from '../lib/common';

type P = Common & { phrase: string; focusWord: string; redact: boolean; dark: boolean };

export const MarkerHighlight: React.FC<P> = (p) => {
    const { frame, durationInFrames: D, inn, out } = useInOut(p, (D0) => Math.max(10, Math.round(D0 * 0.52)));
    const end = Math.max(10, Math.round(D * 0.52));
    const swipe = interpolate(frame, [Math.round(end * 0.25), end], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });

    const phrase = String(p.phrase || 'The secret is timing');
    const focus = String(p.focusWord || '').trim();
    const idx = focus ? phrase.toLowerCase().indexOf(focus.toLowerCase()) : -1;
    const before = idx >= 0 ? phrase.slice(0, idx) : phrase + ' ';
    const hit = idx >= 0 ? phrase.slice(idx, idx + focus.length) : focus;
    const after = idx >= 0 ? phrase.slice(idx + focus.length) : '';

    const bg = p.dark ? '#17191d' : '#fbfaf6';
    const fg = p.dark ? '#f5f6f8' : '#1b1c20';

    return (
        <Place p={p}>
            <div style={{ maxWidth: 820, padding: '24px 36px', borderRadius: 20, background: bg,
                boxShadow: '0 22px 50px rgba(0,0,0,.32)', border: `1px solid ${p.dark ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.08)'}`,
                fontFamily: FONT.sans, fontWeight: 700, fontSize: 44, lineHeight: 1.3, textAlign: 'center', color: fg,
                opacity: out * Math.min(1, inn * 1.4), transform: `translateY(${(1 - inn) * 28}px)` }}>
                <span>{before}</span>
                {hit && (
                    <span style={{ position: 'relative', display: 'inline-block', padding: '0 8px', margin: '0 2px',
                        color: p.redact ? (swipe > 0.5 ? 'transparent' : fg) : (p.dark ? '#111' : fg) }}>
                        <span style={{ position: 'absolute', left: -2, right: -2, top: p.redact ? '6%' : '12%', bottom: p.redact ? '6%' : '8%',
                            background: p.redact ? (p.dark ? '#f5f6f8' : '#141518') : p.accent,
                            borderRadius: p.redact ? 4 : 8, transform: `skewX(-5deg) scaleX(${swipe})`, transformOrigin: 'left center',
                            zIndex: p.redact ? 2 : 0 }} />
                        <span style={{ position: 'relative', zIndex: 1 }}>{hit}</span>
                    </span>
                )}
                <span>{after}</span>
            </div>
        </Place>
    );
};
