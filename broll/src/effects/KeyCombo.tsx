// Key combo: tactile mechanical / Mac keycaps that press down in sequence.
import React from 'react';
import { spring } from 'remotion';
import { Common, Place, useInOut } from '../lib/common';
import { useVibe } from '../lib/vibe';

type P = Common & { keys: string[]; label: string; dark: boolean };

export const KeyCombo: React.FC<P> = (p) => {
    const keys = (Array.isArray(p.keys) && p.keys.length ? p.keys : ['⌘', 'K']).slice(0, 4);
    const { frame, fps, durationInFrames: D, inn } = useInOut(p, (D0) => Math.max(10, Math.round(D0 * 0.45)));
    const step = Math.max(4, Math.round(D * 0.12));

    const L = useVibe(p);
    const capEdge = L.v.hardShadow ? L.border : L.dark ? '#101216' : '#c9c6bd';

    return (
        <Place p={p}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
                ...L.enter(inn) }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    {keys.map((k, i) => {
                        const pressAt = 6 + i * step;
                        const s = spring({ frame: Math.max(0, frame - pressAt), fps, durationInFrames: 10, config: { ...L.spring, stiffness: Math.max(200, L.spring.stiffness) } });
                        const pressed = frame >= pressAt;
                        const down = pressed ? Math.sin(Math.min(1, s) * Math.PI) * 6 + 3 : 0;
                        return (
                            <React.Fragment key={i}>
                                {i > 0 && <span style={{ ...L.text.num(32, { color: L.bare.color, textShadow: L.bare.shadow }) }}>+</span>}
                                <div style={{ ...L.card(18), minWidth: 94, height: 94, padding: '0 24px',
                                    ...(pressed ? { background: L.accent, borderColor: L.v.hardShadow ? L.border : L.accent } : null),
                                    boxShadow: `0 ${Math.max(2, 10 - down)}px 0 ${capEdge}, 0 18px 36px rgba(0,0,0,.26)`,
                                    transform: `translateY(${down}px)`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    ...L.text.num(k.length > 2 ? 30 : 44, { color: pressed ? L.onAccent : L.ink }) }}>
                                    {k}
                                </div>
                            </React.Fragment>
                        );
                    })}
                </div>
                {p.label && (
                    <div style={{ ...L.card(999, { boxShadow: 'none' }), padding: '6px 16px', ...L.text.label(22, { color: L.ink }) }}>{p.label}</div>
                )}
            </div>
        </Place>
    );
};
