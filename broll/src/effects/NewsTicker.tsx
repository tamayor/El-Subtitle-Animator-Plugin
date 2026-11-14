// News ticker: a breaking-news bar across the frame with a pulsing badge, the headline, and a ticker line scrolling
// under it.
import React from 'react';
import { useVideoConfig } from 'remotion';
import { Common, FONT, Full, clamp, ease, prog, useInOut, useUnit } from '../lib/common';
import { face, plainClassic, useVibe } from '../lib/vibe';

type P = Common & { badge: string; headline: string; ticker: string[]; color: string; speed: number };

export const NewsTicker: React.FC<P> = (p) => {
    const { frame, raw, fps } = useInOut(p, () => 14);
    const { width, height } = useVideoConfig();
    const u = useUnit() * (p.scale || 1);
    const red = p.color || '#d21f2b';
    const slide = ease(prog(frame, 0, 10)), head = ease(prog(frame, 6, 16));
    const items = (p.ticker || []).map(String).filter(Boolean);
    const line = (items.length ? items : [p.headline]).join('   •   ') + '   •   ';
    const off = (raw / fps) * (Number(p.speed) || 160) * u;
    const lineW = Math.max(1, line.length * 15.5 * u);
    const pulse = 0.55 + 0.45 * Math.abs(Math.sin(raw / 7));
    const barH = 96 * u, tickH = 50 * u;
    const L = useVibe(p), C = plainClassic(p, L);   // the bar keeps its news red (the Bar colour field); the vibe gives the type
    return (
        <Full p={p}>
            <div style={{ position: 'absolute', left: 0, right: 0, top: clamp(p.y ?? 0.82) * height - (barH + tickH) / 2, fontFamily: FONT.sans,
                transform: `translateY(${(1 - slide) * (barH + tickH + 40 * u)}px)`, boxShadow: `0 ${-6 * u}px ${30 * u}px rgba(0,0,0,.35)` }}>
                <div style={{ height: barH, background: red, display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', gap: 12 * u, padding: `0 ${28 * u}px`, background: '#fff', color: red,
                        ...face(L, 'label', { fontWeight: 800, letterSpacing: 1.5 * u }, C, 38 * u), textTransform: 'uppercase', flex: 'none' }}>
                        <div style={{ width: 18 * u, height: 18 * u, borderRadius: 18 * u, background: red, opacity: pulse }} />{p.badge || 'Breaking'}
                    </div>
                    <div style={{ padding: `0 ${28 * u}px`, color: '#fff', ...face(L, 'display', { fontWeight: 800 }, C, 46 * u), whiteSpace: 'nowrap', opacity: head,
                        transform: `translateX(${(1 - head) * 60 * u}px)`, maxWidth: width, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.headline}</div>
                </div>
                <div style={{ height: tickH, background: '#14161a', overflow: 'hidden', position: 'relative' }}>
                    <div style={{ position: 'absolute', top: 0, left: -(off % lineW), height: '100%', display: 'flex', alignItems: 'center', whiteSpace: 'pre', color: '#f2f2f2',
                        fontWeight: 600, fontSize: 26 * u, fontFamily: FONT.mono }}>
                        {line.repeat(Math.ceil(width / lineW) + 2)}
                    </div>
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 8 * u, background: p.accent }} />
                </div>
            </div>
        </Full>
    );
};
