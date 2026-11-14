// Avatar split: one bubble ("You") in the middle splits into a team: small avatar bubbles fly out on lines to a
// fan / ring around it, each with its name. For delegation, a team, sharing the work.
import React from 'react';
import { spring } from 'remotion';
import { Common, Place, clamp, useInOut, wordTimes } from '../lib/common';
import { readable, tint, useVibe } from '../lib/vibe';

type P = Common & { center: string; names: string[]; caption: string; spread: number; ring: boolean; dark: boolean };

const TONES = ['#f2b98a', '#9cc5e8', '#b9d8a0', '#e3a9c9', '#f0d47a', '#b3a7e6', '#8fd3c8', '#e9a08f'];

export const AvatarSplit: React.FC<P> = (p) => {
    const names = (Array.isArray(p.names) && p.names.length ? p.names : ['Sam', 'Ana', 'Lee']).map(String).slice(0, 8);
    const n = names.length;
    const L = useVibe(p);
    const { frame: f0, real, fps, durationInFrames: D, inn } = useInOut(p, (D0) => Math.round(Math.min(D0 * 0.65, 14 + n * 6)));
    const gap = Math.max(3, Math.min(8, Math.floor((D * 0.4) / n)));
    const times = wordTimes(p, n);   // Land on word: each person appears as the name is spoken
    const frame = times ? real : f0;
    const at = (i: number) => (times ? times[i] : 12 + i * gap);
    const R = 250 * clamp(Number(p.spread) || 1, 0.5, 1.6), C = 150, S = 104;
    // a full ring, or a fan under the centre bubble
    const angle = (i: number) => (p.ring ? -90 + (360 / n) * i : n === 1 ? 90 : 90 + 70 - (140 / (n - 1)) * i) * Math.PI / 180;
    const box = R + S;
    const mono = L.accent.toLowerCase() === L.ink.toLowerCase();   // an accent the colour of the text: avatars keep their own tones
    const squeeze = clamp((frame - 8) / 6) * (1 - clamp((frame - 14) / 8));

    return (
        <Place p={p}>
            <div style={{ position: 'relative', width: box * 2, height: box * 2 + (p.caption ? 70 : 0) }}>
                <svg width={box * 2} height={box * 2} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
                    {names.map((_, i) => {
                        const k = frame < at(i) ? 0 : spring({ frame: frame - at(i), fps, config: L.spring });
                        const a = angle(i);
                        return <line key={i} x1={box} y1={box} x2={box + Math.cos(a) * R * k} y2={box + Math.sin(a) * R * k}
                            stroke={L.bare.color} strokeOpacity={0.75 * clamp(k * 2)} strokeWidth={3} strokeDasharray="2 9" strokeLinecap="round" />;
                    })}
                </svg>
                {names.map((name, i) => {
                    const k = frame < at(i) ? 0 : spring({ frame: frame - at(i), fps, config: L.spring });
                    if (k <= 0) return null;
                    const a = angle(i), tone = mono ? TONES[i % TONES.length] : i % 2 ? tint(L.accent, 0.55) : L.accent;
                    return (
                        <div key={i} style={{ position: 'absolute', left: box + Math.cos(a) * R * k, top: box + Math.sin(a) * R * k, width: 0, height: 0,
                            opacity: clamp(k * 2) }}>
                            <div style={{ position: 'absolute', left: -S / 2, top: -S / 2, width: S, height: S, borderRadius: L.r(S), boxSizing: 'border-box',
                                background: tone, border: `${Math.max(3, L.v.borderWidth)}px solid ${L.v.hardShadow ? L.border : '#ffffff'}`, boxShadow: L.shadow,
                                display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${0.4 + 0.6 * k})`,
                                ...L.text.num(40, { color: mono ? '#1b1c1f' : readable(L.accent) }) }}>{name.slice(0, 1).toUpperCase()}</div>
                            <div style={{ position: 'absolute', left: -110, width: 220, top: S / 2 + 8, textAlign: 'center' }}>
                                <span style={{ ...L.card(999, { boxShadow: 'none' }), display: 'inline-block', padding: '3px 14px',
                                    ...L.text.label(21, { color: L.ink, textTransform: 'none', letterSpacing: 0, lineHeight: 1.35 }) }}>{name}</span>
                            </div>
                        </div>
                    );
                })}
                <div style={{ ...L.card(C), position: 'absolute', left: box - C / 2, top: box - C / 2, width: C, height: C, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', ...L.text.display(40), opacity: clamp(inn * 1.6),
                    transform: `scale(${(0.5 + 0.5 * inn) * (1 + squeeze * 0.12)})` }}>{p.center || 'You'}</div>
                {p.caption && (
                    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, textAlign: 'center', opacity: clamp((frame - at(n - 1) - 6) / 8),
                        ...L.text.display(40, { color: L.bare.color, textShadow: L.bare.shadow }) }}>{p.caption}</div>
                )}
            </div>
        </Place>
    );
};
