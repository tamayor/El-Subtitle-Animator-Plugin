// Checklist card: a titled list whose boxes tick themselves one by one (the tick is drawn, the line can strike
// through), with a "done / total" counter. `done` = how many get ticked.
import React from 'react';
import { spring } from 'remotion';
import { Common, Place, clamp, prog, useInOut, wordTimes } from '../lib/common';
import { useVibe } from '../lib/vibe';

type P = Common & { title: string; items: string[]; done: number; strike: boolean; counter: boolean; dark: boolean };

export const ChecklistCard: React.FC<P> = (p) => {
    const items = (Array.isArray(p.items) && p.items.length ? p.items : ['First thing']).map(String).slice(0, 7);
    const n = items.length;
    const done = Math.max(0, Math.min(n, Number.isFinite(Number(p.done)) && Number(p.done) >= 0 ? Math.round(Number(p.done)) : n));
    const L = useVibe(p);
    const { frame: f0, real, fps, durationInFrames: D, inn } = useInOut(p, (D0) => Math.round(Math.min(D0 * 0.7, 12 + n * 9)));
    const gap = Math.max(5, Math.min(12, Math.floor((D * 0.6) / Math.max(1, done))));
    // Land on word: each box is ticked as its line is spoken
    const times = wordTimes(p, done);
    const frame = times ? real : f0;
    const tickAt = (i: number) => (times ? times[i] : 10 + i * gap);
    const ticked = items.reduce((c, _, i) => c + (i < done && frame >= tickAt(i) + 3 ? 1 : 0), 0);

    return (
        <Place p={p}>
            <div style={{ ...L.card(28), width: 600, padding: '26px 30px 24px', ...L.enter(inn) }}>
                {(p.title || p.counter) && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 14, marginBottom: 16 }}>
                        <div style={{ ...L.text.display(34) }}>{p.title}</div>
                        {p.counter && <div style={{ ...L.text.num(24, { color: L.dim }), flex: 'none' }}>{ticked}/{n}</div>}
                    </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {items.map((t, i) => {
                        const rowIn = spring({ frame: f0 - 3 - i * Math.max(1, L.stagger - 1), fps, config: L.spring });
                        const on = i < done ? prog(frame, tickAt(i), tickAt(i) + 6) : 0;
                        const pop = i < done && frame >= tickAt(i) ? spring({ frame: frame - tickAt(i), fps, config: { ...L.spring, damping: Math.min(11, L.spring.damping) } }) : 0;
                        return (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, ...L.enter(rowIn, 'left') }}>
                                <div style={{ width: 40, height: 40, flex: 'none', borderRadius: L.r(12), boxSizing: 'border-box',
                                    border: `${Math.max(2.5, L.v.borderWidth)}px solid ${on > 0 ? L.accent : L.dim}`, background: on > 0 ? L.accent : 'transparent',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${on > 0 ? 0.8 + pop * 0.2 : 1})` }}>
                                    <svg width={24} height={24} viewBox="0 0 24 24">
                                        <path d="M5 12.5l4.6 4.6L19 7.5" fill="none" stroke={L.onAccent} strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round"
                                            pathLength={1} strokeDasharray={1} strokeDashoffset={1 - clamp(on)} />
                                    </svg>
                                </div>
                                <div style={{ position: 'relative', ...L.text.body(30, { color: on > 0.5 && p.strike ? L.dim : L.ink }) }}>
                                    {t}
                                    {p.strike && <span style={{ position: 'absolute', left: -2, right: -2, top: '54%', height: 3, borderRadius: 2, background: L.dim,
                                        transform: `scaleX(${clamp(on)})`, transformOrigin: 'left center' }} />}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </Place>
    );
};
