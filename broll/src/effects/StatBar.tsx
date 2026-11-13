// Stat bar: an animated percentage / ratio progress bar with a big readout and label.
import React from 'react';
import { interpolate } from 'remotion';
import { Common, FONT, Place, clamp, ease, useInOut } from '../lib/common';

type P = Common & { percent: number; valueText: string; label: string; down: boolean; dark: boolean };

export const StatBar: React.FC<P> = (p) => {
    const { frame, durationInFrames: D, inn, out } = useInOut(p, (D0) => Math.max(10, Math.round(D0 * 0.55)));
    const end = Math.max(10, Math.round(D * 0.55));
    const k = interpolate(frame, [2, end], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
    const target = clamp((Number(p.percent) || 0) / 100, 0, 1);
    const fill = target * k;
    const shownPct = Math.round((Number(p.percent) || 0) * k);

    const bg = p.dark ? 'rgba(22, 24, 28, 0.94)' : 'rgba(251, 250, 247, 0.96)';
    const fg = p.dark ? '#f7f8fa' : '#181a1e';
    const track = p.dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.09)';
    const barColor = p.down ? '#e55353' : p.accent;

    return (
        <Place p={p}>
            <div style={{ width: 660, padding: '26px 32px', borderRadius: 22, background: bg,
                boxShadow: '0 22px 54px rgba(0,0,0,.32)', border: `1px solid ${track}`,
                opacity: out * Math.min(1, inn * 1.4), transform: `translateY(${(1 - inn) * 34}px)` }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
                    <div style={{ fontFamily: FONT.sans, fontWeight: 700, fontSize: 34, color: fg, lineHeight: 1.2 }}>
                        {p.label || 'Share of total'}
                    </div>
                    <div style={{ fontFamily: FONT.sans, fontWeight: 800, fontSize: 54, color: barColor,
                        fontVariantNumeric: 'tabular-nums', lineHeight: 1, flexShrink: 0 }}>
                        {p.valueText && k > 0.92 ? p.valueText : `${shownPct}%`}
                    </div>
                </div>
                <div style={{ width: '100%', height: 26, borderRadius: 999, background: track, overflow: 'hidden' }}>
                    <div style={{ width: `${fill * 100}%`, height: '100%', borderRadius: 999, background: barColor,
                        boxShadow: `0 0 18px ${barColor}55` }} />
                </div>
            </div>
        </Place>
    );
};
