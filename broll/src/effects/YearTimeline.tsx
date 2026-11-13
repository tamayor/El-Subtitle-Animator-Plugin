// Year timeline: a horizontal date scrubber that rolls to the target year and pops a milestone pin.
import React from 'react';
import { interpolate } from 'remotion';
import { Common, FONT, Place, ease, useInOut } from '../lib/common';

type P = Common & { year: number; caption: string; dark: boolean };

export const YearTimeline: React.FC<P> = (p) => {
    const { frame, durationInFrames: D, inn, out } = useInOut(p, (D0) => Math.max(12, Math.round(D0 * 0.55)));
    const end = Math.max(12, Math.round(D * 0.55));
    const target = Math.round(Number(p.year) || 2024);
    const k = interpolate(frame, [2, end], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
    const startYear = target - 8;
    const curYear = Math.round(startYear + (target - startYear) * k);
    const ticks = Array.from({ length: 13 }, (_, i) => target - 6 + i);

    const bg = p.dark ? 'rgba(22, 24, 29, 0.94)' : 'rgba(252, 250, 246, 0.96)';
    const fg = p.dark ? '#f5f6f8' : '#181a1e';
    const dim = p.dark ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.3)';

    return (
        <Place p={p}>
            <div style={{ width: 700, padding: '24px 32px', borderRadius: 22, background: bg,
                boxShadow: '0 22px 52px rgba(0,0,0,.32)', border: `1px solid ${p.dark ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.08)'}`,
                opacity: out * Math.min(1, inn * 1.4), transform: `translateY(${(1 - inn) * 30}px)`, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
                    <div style={{ fontFamily: FONT.mono, fontWeight: 700, fontSize: 54, color: p.accent, lineHeight: 1 }}>
                        {curYear}
                    </div>
                    {p.caption && (
                        <div style={{ fontFamily: FONT.sans, fontWeight: 600, fontSize: 26, color: fg, opacity: k,
                            maxWidth: 440, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.caption}
                        </div>
                    )}
                </div>
                <div style={{ position: 'relative', height: 48, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
                    borderBottom: `3px solid ${dim}`, paddingBottom: 6 }}>
                    <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 4, borderRadius: 2,
                        background: p.accent, transform: 'translateX(-50%)' }} />
                    {ticks.map((y) => {
                        const active = y === target && k > 0.9;
                        return (
                            <div key={y} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                                transform: `translateX(${(1 - k) * 90}px)`, opacity: active ? 1 : 0.6 }}>
                                <span style={{ fontFamily: FONT.mono, fontSize: 15, fontWeight: active ? 700 : 400, color: active ? p.accent : dim }}>{y}</span>
                                <span style={{ width: 2, height: y % 5 === 0 ? 18 : 10, background: active ? p.accent : dim, borderRadius: 1 }} />
                            </div>
                        );
                    })}
                </div>
            </div>
        </Place>
    );
};
