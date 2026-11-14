// Year timeline: a horizontal date scrubber that rolls to the target year and pops a milestone pin.
import React from 'react';
import { interpolate } from 'remotion';
import { Common, FONT, Place, ease, useInOut } from '../lib/common';
import { useVibe } from '../lib/vibe';

type P = Common & { year: number; caption: string; dark: boolean };

export const YearTimeline: React.FC<P> = (p) => {
    const { frame, durationInFrames: D, inn } = useInOut(p, (D0) => Math.max(12, Math.round(D0 * 0.55)));
    const end = Math.max(12, Math.round(D * 0.55));
    const target = Math.round(Number(p.year) || 2024);
    const k = interpolate(frame, [2, end], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
    const startYear = target - 8;
    const curYear = Math.round(startYear + (target - startYear) * k);
    const ticks = Array.from({ length: 13 }, (_, i) => target - 6 + i);

    const L = useVibe(p);
    const dim = L.dark ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.3)';

    return (
        <Place p={p}>
            <div style={{ ...L.card(22), width: 700, padding: '24px 32px', overflow: 'hidden', ...L.enter(inn) }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
                    <div style={{ ...L.text.num(54, { color: L.accent }) }}>
                        {curYear}
                    </div>
                    {p.caption && (
                        <div style={{ ...L.text.body(26), opacity: k,
                            maxWidth: 440, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.caption}
                        </div>
                    )}
                </div>
                <div style={{ position: 'relative', height: 48, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
                    borderBottom: `3px solid ${dim}`, paddingBottom: 6 }}>
                    <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 4, borderRadius: 2,
                        background: L.accent, transform: 'translateX(-50%)' }} />
                    {ticks.map((y) => {
                        const active = y === target && k > 0.9;
                        return (
                            <div key={y} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                                transform: `translateX(${(1 - k) * 90}px)`, opacity: active ? 1 : 0.6 }}>
                                <span style={{ fontFamily: FONT.mono, fontSize: 15, fontWeight: active ? 700 : 400, color: active ? L.accent : dim }}>{y}</span>
                                <span style={{ width: 2, height: y % 5 === 0 ? 18 : 10, background: active ? L.accent : dim, borderRadius: 1 }} />
                            </div>
                        );
                    })}
                </div>
            </div>
        </Place>
    );
};
