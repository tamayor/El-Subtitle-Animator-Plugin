// Chapter list: the "In this video" side list. The highlight slides from the previous item to the current one and the
// counter ticks, so a clip per chapter reads as one list running through the video.
import React from 'react';
import { interpolate } from 'remotion';
import { Common, FONT, Place, ease, useInOut } from '../lib/common';

type P = Common & { title: string; items: string[]; active: number; total: number; footer: string; panel: string };

export const ChapterList: React.FC<P> = (p) => {
    const { frame, inn, out } = useInOut(p, () => 14);
    const items = (p.items && p.items.length ? p.items : ['Item']).slice(0, 30);
    const act = Math.max(1, Math.min(items.length, Math.round(p.active || 1)));
    const total = Math.round(p.total || 0) || items.length;
    const move = interpolate(frame, [2, 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
    const rowH = 40;
    const hl = (act - 2 + move) * rowH;   // from the previous row to this one
    const pad = (n: number) => String(n).padStart(2, '0');
    const enter = p.enter ?? 10;

    return (
        <Place p={p}>
            <div style={{ width: 340, background: p.panel || '#1f3a2c', borderRadius: 16, padding: '16px 12px 14px',
                border: '1.5px solid rgba(255,255,255,.12)', boxShadow: '0 16px 40px rgba(0,0,0,.4)', opacity: out,
                transform: enter > 0 ? `translateX(${(1 - inn) * 80}px)` : 'none', fontFamily: FONT.sans }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: FONT.mono, fontSize: 14, letterSpacing: 2.5,
                    color: 'rgba(255,255,255,.65)', textTransform: 'uppercase', padding: '0 8px 10px' }}>
                    <span>{p.title}</span><span style={{ color: p.accent }}>{pad(act)} / {pad(total)}</span>
                </div>
                <div style={{ position: 'relative' }}>
                    <div style={{ position: 'absolute', left: 0, right: 0, top: Math.max(0, hl), height: rowH - 4, borderRadius: 7, background: '#fff' }} />
                    {items.map((t, i) => {
                        const on = i + 1 === act && move > 0.5;
                        return (
                            <div key={i} style={{ position: 'relative', height: rowH, display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px',
                                marginBottom: 0, color: on ? '#14251b' : '#fff', fontSize: 21, fontWeight: on ? 600 : 500 }}>
                                <span style={{ fontFamily: FONT.mono, fontSize: 12, opacity: 0.55, width: 18 }}>{pad(i + 1)}</span>{t}
                            </div>
                        );
                    })}
                </div>
                {p.footer && (
                    <div style={{ marginTop: 12, display: 'inline-block', background: p.accent, color: '#14251b', fontWeight: 800,
                        fontSize: 19, padding: '7px 12px', borderRadius: 7 }}>{p.footer}</div>
                )}
            </div>
        </Place>
    );
};
