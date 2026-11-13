// Key combo: tactile mechanical / Mac keycaps that press down in sequence.
import React from 'react';
import { spring } from 'remotion';
import { Common, FONT, Place, useInOut } from '../lib/common';

type P = Common & { keys: string[]; label: string; dark: boolean };

export const KeyCombo: React.FC<P> = (p) => {
    const keys = (Array.isArray(p.keys) && p.keys.length ? p.keys : ['⌘', 'K']).slice(0, 4);
    const { frame, fps, durationInFrames: D, inn, out } = useInOut(p, (D0) => Math.max(10, Math.round(D0 * 0.45)));
    const step = Math.max(4, Math.round(D * 0.12));

    const capBg = p.dark ? '#23262d' : '#f7f6f2';
    const capEdge = p.dark ? '#101216' : '#c9c6bd';
    const capFg = p.dark ? '#f5f6f8' : '#1b1d21';

    return (
        <Place p={p}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
                opacity: out * Math.min(1, inn * 1.4), transform: `translateY(${(1 - inn) * 26}px)` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    {keys.map((k, i) => {
                        const pressAt = 6 + i * step;
                        const s = spring({ frame: Math.max(0, frame - pressAt), fps, durationInFrames: 10, config: { damping: 14, stiffness: 220 } });
                        const pressed = frame >= pressAt;
                        const down = pressed ? Math.sin(Math.min(1, s) * Math.PI) * 6 + 3 : 0;
                        return (
                            <React.Fragment key={i}>
                                {i > 0 && <span style={{ fontFamily: FONT.sans, fontWeight: 700, fontSize: 32, color: '#fff', textShadow: '0 3px 12px rgba(0,0,0,.5)' }}>+</span>}
                                <div style={{ minWidth: 94, height: 94, padding: '0 24px', borderRadius: 18,
                                    background: pressed ? p.accent : capBg,
                                    color: pressed ? '#111' : capFg,
                                    border: `2px solid ${pressed ? p.accent : capEdge}`,
                                    boxShadow: `0 ${Math.max(2, 10 - down)}px 0 ${capEdge}, 0 18px 36px rgba(0,0,0,.32)`,
                                    transform: `translateY(${down}px)`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontFamily: FONT.sans, fontWeight: 800, fontSize: k.length > 2 ? 30 : 44 }}>
                                    {k}
                                </div>
                            </React.Fragment>
                        );
                    })}
                </div>
                {p.label && (
                    <div style={{ padding: '6px 16px', borderRadius: 999, background: 'rgba(0,0,0,.62)', color: '#fff',
                        fontFamily: FONT.sans, fontWeight: 600, fontSize: 22 }}>{p.label}</div>
                )}
            </div>
        </Place>
    );
};
