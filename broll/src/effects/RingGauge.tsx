// Ring gauge: a circular ring fills to a percentage with a ticking readout in the middle and a label under it.
import React from 'react';
import { interpolate } from 'remotion';
import { Common, FONT, Place, clamp, ease, useInOut } from '../lib/common';
import { face, plainClassic, useVibe } from '../lib/vibe';

type P = Common & { percent: number; valueText: string; label: string; thickness: number; card: boolean; dark: boolean };

export const RingGauge: React.FC<P> = (p) => {
    const { frame, durationInFrames: D, inn } = useInOut(p, (D0) => Math.max(10, Math.round(D0 * 0.55)));
    const end = Math.max(10, Math.round(D * 0.55));
    const k = interpolate(frame, [2, end], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
    const pct = clamp((Number(p.percent) || 0) / 100);
    const R = 150, T = Math.max(8, Number(p.thickness) || 30), C = 2 * Math.PI * R, S = (R + T) * 2;
    const L = useVibe(p), CL = plainClassic(p, L);
    // on a card: the vibe's surface; without one the ring sits on the footage (the vibe's bare text colour)
    const fg = CL ? (p.card && !p.dark ? '#181a1e' : '#fff') : p.card ? L.ink : L.bare.color;
    const track = CL ? (p.card && !p.dark ? 'rgba(0,0,0,.1)' : 'rgba(255,255,255,.22)') : p.card ? L.track : 'rgba(255,255,255,.22)';
    // "9/10"-style text is shown as given once landed; a plain percentage ticks up
    const custom = String(p.valueText || '').trim();
    const readout = custom && !/^\d+(\.\d+)?%$/.test(custom) ? custom : Math.round((Number(p.percent) || 0) * k) + '%';
    const land = frame > end ? Math.max(0, 1 - (frame - end) / 8) : 0;
    const shadow = p.card ? 'none' : CL ? '0 4px 18px rgba(0,0,0,.55)' : L.bare.shadow;
    return (
        <Place p={p}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, padding: p.card ? '34px 44px 30px' : 0,
                ...(p.card && !CL ? L.card(34) : { borderRadius: 34, background: p.card ? (p.dark ? 'rgba(22,24,28,.94)' : 'rgba(251,250,247,.96)') : 'transparent',
                    boxShadow: p.card ? '0 22px 54px rgba(0,0,0,.32)' : 'none' }),
                opacity: Math.min(1, inn * 1.5), transform: `scale(${0.8 + inn * 0.2 + land * 0.04})` }}>
                <div style={{ position: 'relative', width: S, height: S }}>
                    <svg width={S} height={S} style={{ transform: 'rotate(-90deg)', filter: p.card ? 'none' : 'drop-shadow(0 6px 16px rgba(0,0,0,.4))' }}>
                        <circle cx={S / 2} cy={S / 2} r={R} fill="none" stroke={track} strokeWidth={T} />
                        <circle cx={S / 2} cy={S / 2} r={R} fill="none" stroke={p.accent} strokeWidth={T} strokeLinecap="round"
                            strokeDasharray={C} strokeDashoffset={C * (1 - pct * k)} />
                    </svg>
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        ...face(L, 'num', { fontFamily: FONT.sans, fontWeight: 800, letterSpacing: -3 }, CL, readout.length > 4 ? 78 : 96), color: fg, fontVariantNumeric: 'tabular-nums', textShadow: shadow }}>{readout}</div>
                </div>
                {p.label && <div style={{ ...face(L, 'body', { fontFamily: FONT.sans, fontWeight: 700 }, CL, 44), color: fg, textShadow: shadow, opacity: k, maxWidth: 560, textAlign: 'center', lineHeight: 1.15 }}>{p.label}</div>}
            </div>
        </Place>
    );
};
