// Stat bar: an animated percentage / ratio progress bar with a big readout and label.
import React from 'react';
import { interpolate } from 'remotion';
import { Common, Place, clamp, ease, useInOut } from '../lib/common';
import { useVibe } from '../lib/vibe';

type P = Common & { percent: number; valueText: string; label: string; down: boolean; dark: boolean };

export const StatBar: React.FC<P> = (p) => {
    const { frame, durationInFrames: D, inn } = useInOut(p, (D0) => Math.max(10, Math.round(D0 * 0.55)));
    const end = Math.max(10, Math.round(D * 0.55));
    const k = interpolate(frame, [2, end], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
    const target = clamp((Number(p.percent) || 0) / 100, 0, 1);
    const fill = target * k;
    const shownPct = Math.round((Number(p.percent) || 0) * k);

    const L = useVibe(p);
    const barColor = p.down ? L.danger : L.accent;

    return (
        <Place p={p}>
            <div style={{ ...L.card(22), width: 660, padding: '26px 32px', ...L.enter(inn) }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
                    <div style={{ ...L.text.body(34, { fontWeight: Math.max(600, L.v.font.bodyWeight), lineHeight: 1.2 }) }}>
                        {p.label || 'Share of total'}
                    </div>
                    <div style={{ ...L.text.num(54, { color: L.dark || barColor !== L.ink ? barColor : L.ink }), flexShrink: 0 }}>
                        {p.valueText && k > 0.92 ? p.valueText : `${shownPct}%`}
                    </div>
                </div>
                <div style={{ width: '100%', height: 26, borderRadius: L.r(999), background: L.track, overflow: 'hidden' }}>
                    <div style={{ width: `${fill * 100}%`, height: '100%', borderRadius: L.r(999), background: barColor }} />
                </div>
            </div>
        </Place>
    );
};
