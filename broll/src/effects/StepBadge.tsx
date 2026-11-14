// Step badge: "step" = a quiet "Step 1 of 4" pill with progress dots; "countdown" = a big number in a sweeping ring
// with the point next to it; "list" = numbered items sliding in one after another up to the current one.
import React from 'react';
import { spring } from 'remotion';
import { Common, FONT, Place, clamp, ease, prog, useInOut, wordTimes } from '../lib/common';
import { face, plainClassic, useVibe } from '../lib/vibe';

type P = Common & { mode: string; number: number; total: number; text: string; items: string[]; word: string; dark: boolean };

export const StepBadge: React.FC<P> = (p) => {
    const { frame, real, fps, durationInFrames: D, inn } = useInOut(p, (D0) => Math.max(10, Math.round(D0 * 0.4)));
    const mode = String(p.mode || 'step');
    const num = Math.max(1, Math.round(Number(p.number) || 1)), total = Math.max(num, Math.round(Number(p.total) || 0));
    const L = useVibe(p), CL = plainClassic(p, L);
    const bg = CL ? (p.dark ? 'rgba(18,20,24,.9)' : 'rgba(255,255,255,.96)') : L.bg, fg = CL ? (p.dark ? '#fff' : '#15171b') : L.ink, dim = CL ? (p.dark ? 'rgba(255,255,255,.6)' : 'rgba(0,0,0,.5)') : L.dim;
    const onAcc = CL ? '#10140f' : L.onAccent, family = CL ? FONT.sans : L.v.font.body;
    // a card: the look it had under plain Classic, the vibe's card otherwise
    const card = (r: number, shadow: string): React.CSSProperties => (CL ? { borderRadius: r, background: bg, boxShadow: shadow } : L.card(r));
    if (mode === 'list') {
        const items = (p.items || []).map(String).filter(Boolean).slice(0, 7);
        const shown = Math.min(items.length, Math.max(1, num));
        const times = wordTimes(p, shown);
        const span = Math.max(10, Math.round(D * 0.6));
        return (
            <Place p={p}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: 640, fontFamily: family }}>
                    {items.slice(0, shown).map((it, i) => {
                        const at = times ? times[i] : 2 + (i / shown) * span;
                        const s = spring({ frame: (times ? real : frame) - at, fps, config: { damping: 15, stiffness: 170 } });
                        const cur = i === shown - 1;
                        return (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '14px 24px 14px 14px', ...card(22, '0 12px 30px rgba(0,0,0,.3)'), opacity: clamp(s * 1.6) * (cur ? 1 : 0.82), transform: `translateX(${(1 - s) * -80}px)` }}>
                                <div style={{ width: 62, height: 62, borderRadius: 62, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    background: cur ? p.accent : 'transparent', border: cur ? 'none' : `3px solid ${dim}`, color: cur ? onAcc : dim, ...face(L, 'num', { fontWeight: 800 }, CL, 34) }}>{i + 1}</div>
                                <div style={{ fontWeight: cur ? 800 : 600, fontSize: 36, color: fg, lineHeight: 1.15 }}>{it}</div>
                            </div>
                        );
                    })}
                </div>
            </Place>
        );
    }
    if (mode === 'countdown') {
        const R = 96, C = 2 * Math.PI * R, sweep = ease(prog(frame, 0, Math.max(10, Math.round(D * 0.4))));
        const pop = spring({ frame, fps, config: { damping: 10, stiffness: 180 } });
        return (
            <Place p={p}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 30, opacity: clamp(inn * 2), fontFamily: family }}>
                    <div style={{ position: 'relative', width: 230, height: 230, flex: 'none', transform: `scale(${pop})` }}>
                        <svg width={230} height={230} style={{ transform: 'rotate(-90deg)', filter: 'drop-shadow(0 10px 22px rgba(0,0,0,.4))' }}>
                            <circle cx={115} cy={115} r={R} fill={bg} />
                            <circle cx={115} cy={115} r={R} fill="none" stroke={p.accent} strokeWidth={16} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - sweep)} />
                        </svg>
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', ...face(L, 'num', { fontWeight: 800, letterSpacing: -4 }, CL, 124), color: fg }}>{num}</div>
                    </div>
                    {p.text && <div style={{ maxWidth: 560, ...face(L, 'display', { fontWeight: 800 }, CL, 60), color: CL ? '#fff' : L.bare.color, lineHeight: 1.08, textShadow: CL ? '0 4px 18px rgba(0,0,0,.6)' : L.bare.shadow,
                        opacity: prog(frame, 6, 14), transform: `translateX(${(1 - ease(prog(frame, 6, 16))) * 30}px)` }}>{p.text}</div>}
                </div>
            </Place>
        );
    }
    return (
        <Place p={p}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 18, padding: '14px 26px', ...card(60, '0 10px 26px rgba(0,0,0,.28)'),
                opacity: clamp(inn * 1.4), transform: `translateY(${(1 - inn) * 18}px)`, fontFamily: family, whiteSpace: 'nowrap' }}>
                <div style={{ fontWeight: 700, fontSize: 32, color: fg }}>
                    <span style={{ color: dim, fontWeight: 600 }}>{p.word || 'Step'} </span>{num}{total > 1 ? <span style={{ color: dim, fontWeight: 600 }}> of {total}</span> : null}
                </div>
                {total > 1 && total <= 10 && (
                    <div style={{ display: 'flex', gap: 7 }}>
                        {Array.from({ length: total }, (_, i) => <div key={i} style={{ width: i === num - 1 ? 30 : 12, height: 12, borderRadius: 12,
                            background: i < num ? p.accent : CL ? (p.dark ? 'rgba(255,255,255,.22)' : 'rgba(0,0,0,.14)') : L.track }} />)}
                    </div>
                )}
                {p.text && <div style={{ fontWeight: 600, fontSize: 30, color: dim, paddingLeft: 16, borderLeft: `2px solid ${CL ? (p.dark ? 'rgba(255,255,255,.2)' : 'rgba(0,0,0,.12)') : L.border}` }}>{p.text}</div>}
            </div>
        </Place>
    );
};
