// Notification stack: notifications drop in one after another (newest on top, the older ones slide down), then
// (collapse) pile into one card with a "×N" badge. A line is "Title | text".
import React from 'react';
import { interpolate, spring } from 'remotion';
import { Common, Place, clamp, ease, useInOut, wordTimes } from '../lib/common';
import { useVibe } from '../lib/vibe';

type P = Common & { app: string; items: string[]; collapse: boolean; time: string };

export const NotificationStack: React.FC<P> = (p) => {
    const items = (Array.isArray(p.items) && p.items.length ? p.items : ['Brief #1 | Client call at 4']).map(String).slice(0, 5);
    const n = items.length;
    const L = useVibe(p);
    const { frame: f0, real, fps, durationInFrames: D } = useInOut(p, (D0) => Math.round(Math.min(D0 * 0.6, 8 + n * 12)));
    const gap = Math.max(6, Math.min(14, Math.floor((D * 0.55) / n)));
    // Land on word: each notification arrives as its line is spoken
    const times = wordTimes(p, n);
    const frame = times ? real : f0;
    const at = (i: number) => (times ? times[i] : 2 + i * gap);
    const lastIn = at(n - 1) + 12;
    const pile = p.collapse && n > 1 ? interpolate(frame, [lastIn + 8, lastIn + 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease }) : 0;
    const W = 640, H = 112, G = 14;
    const ins = items.map((_, i) => (frame < at(i) ? 0 : spring({ frame: frame - at(i), fps, config: L.spring })));

    return (
        <Place p={p}>
            <div style={{ position: 'relative', width: W, height: H + (n - 1) * (H + G) }}>
                {items.map((raw, i) => {
                    const k = ins[i];
                    if (k <= 0) return null;
                    const [title, text] = raw.split('|').map((s) => s.trim());
                    // row from the top: every newer notification pushes this one down by one
                    let row = 0;
                    for (let j = i + 1; j < n; j++) row += clamp(ins[j]);
                    const open = row * (H + G), shut = Math.min(row, 2.4) * 12;
                    const y = open + (shut - open) * pile;
                    const back = pile * Math.min(row, 3);
                    return (
                        <div key={i} style={{ ...L.card(26), position: 'absolute', left: 0, top: 0, width: W, height: H, padding: '0 22px',
                            display: 'flex', alignItems: 'center', gap: 16, zIndex: 10 + i,
                            opacity: clamp(k * 1.6) * (1 - clamp(back - 2)),
                            transform: `translateY(${y - (1 - k) * (L.v.motion.rise + 30)}px) scale(${(L.v.motion.pop + (1 - L.v.motion.pop) * k) * (1 - back * 0.045)})` }}>
                            <div style={{ width: 58, height: 58, borderRadius: L.r(16), background: L.accent, flex: 'none', display: 'flex', alignItems: 'center',
                                justifyContent: 'center', ...L.text.num(26, { color: L.onAccent }) }}>{(p.app || title || '?').slice(0, 1).toUpperCase()}</div>
                            <div style={{ flex: 1, minWidth: 0, opacity: 1 - clamp(back) * 0.9 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                                    <div style={{ ...L.text.body(27, { fontWeight: Math.max(700, L.v.font.bodyWeight), lineHeight: 1.2 }), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
                                    <div style={{ ...L.text.label(18, { textTransform: 'none', letterSpacing: 0 }), flex: 'none' }}>{p.time || 'now'}</div>
                                </div>
                                {text && <div style={{ ...L.text.body(24, { color: L.dim, lineHeight: 1.25 }), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>{text}</div>}
                            </div>
                        </div>
                    );
                })}
                {pile > 0.5 && (
                    <div style={{ position: 'absolute', right: -18, top: -18, zIndex: 40, minWidth: 54, height: 54, padding: '0 12px', boxSizing: 'border-box',
                        borderRadius: L.r(54), background: L.danger, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        ...L.text.num(26, { color: '#ffffff' }), transform: `scale(${spring({ frame: frame - (lastIn + 14), fps, config: { ...L.spring, damping: Math.min(12, L.spring.damping) } })})` }}>×{n}</div>
                )}
            </div>
        </Place>
    );
};
