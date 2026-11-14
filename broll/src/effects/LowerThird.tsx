// Lower third: "speaker" = a name and a role tag sliding in behind an accent bar; "source" = a compact citation pill.
// Draws with the clip's vibe (lib/vibe.tsx); plain Classic keeps the look it had before vibes.
import React from 'react';
import { Common, FONT, Place, clamp, ease, prog, useInOut } from '../lib/common';
import { face, plainClassic, useVibe } from '../lib/vibe';

type P = Common & { variant: string; name: string; role: string; source: string; dark: boolean };

export const LowerThird: React.FC<P> = (p) => {
    const { frame, inn } = useInOut(p, () => 16);
    const L = useVibe(p), C = plainClassic(p, L);
    const bg = C ? (p.dark ? 'rgba(16,18,22,.92)' : 'rgba(255,255,255,.97)') : (L.card(0).background as string);
    const fg = C ? (p.dark ? '#fff' : '#14161a') : L.ink;
    const rim = C ? undefined : `${L.v.borderWidth}px solid ${L.border}`;
    const onAcc = C ? '#10140f' : L.onAccent;
    if (String(p.variant) === 'source') {
        return (
            <Place p={p}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 14, padding: '11px 24px 11px 14px', borderRadius: L.r(50), background: bg, border: rim, whiteSpace: 'nowrap',
                    boxShadow: C ? '0 8px 22px rgba(0,0,0,.3)' : L.shadow, fontFamily: C ? FONT.sans : L.v.font.body, opacity: clamp(inn * 1.5), transform: `translateX(${(1 - inn) * -40}px)` }}>
                    <div style={{ padding: '5px 14px', borderRadius: L.r(30), background: p.accent, color: onAcc, ...face(L, 'label', { fontWeight: 800, letterSpacing: 1.5 }, C, 22), textTransform: 'uppercase' }}>Source</div>
                    <div style={{ ...face(L, 'body', { fontWeight: 600 }, C, 28), color: fg }}>{p.source}</div>
                </div>
            </Place>
        );
    }
    const bar = ease(prog(frame, 0, 8)), plate = ease(prog(frame, 3, 14)), role = ease(prog(frame, 9, 18));
    return (
        <Place p={p}>
            <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, fontFamily: FONT.sans, filter: 'drop-shadow(0 12px 26px rgba(0,0,0,.35))' }}>
                <div style={{ width: 12, background: p.accent, borderRadius: L.r(6), transform: `scaleY(${bar})`, transformOrigin: 'center bottom' }} />
                <div style={{ overflow: 'hidden', paddingLeft: 0 }}>
                    <div style={{ transform: `translateX(${(1 - plate) * -102}%)` }}>
                        <div style={{ background: bg, border: rim, borderLeft: 'none', padding: '14px 34px 12px 24px', ...face(L, 'display', { fontWeight: 800 }, C, 58), color: fg, lineHeight: 1.05,
                            whiteSpace: 'nowrap', borderRadius: `0 ${L.r(12)}px ${L.r(12)}px 0` }}>{p.name}</div>
                        {p.role && <div style={{ display: 'inline-block', marginTop: 6, background: p.accent, color: onAcc, padding: '7px 22px 7px 24px', ...face(L, 'label', { fontWeight: 700, letterSpacing: 0.5 }, C, 30),
                            textTransform: C ? undefined : 'none', whiteSpace: 'nowrap', borderRadius: `0 ${L.r(10)}px ${L.r(10)}px 0`, opacity: role, transform: `translateX(${(1 - role) * -30}px)` }}>{p.role}</div>}
                    </div>
                </div>
            </div>
        </Place>
    );
};
