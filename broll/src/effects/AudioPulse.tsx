// Audio pulse: bars, a ring or an orb moving with the voice. Driven by props._samples (loudness 0..1 per clip frame)
// when the audio was measured, otherwise by a seeded speech-like stand-in.
import React from 'react';
import { Common, FONT, Place, clamp, envelope, rand, useInOut } from '../lib/common';
import { face, plainClassic, useVibe } from '../lib/vibe';

type P = Common & { mode: string; label: string; bars: number; color: string; _samples?: number[] };

export const AudioPulse: React.FC<P> = (p) => {
    const { real: raw, fps, inn } = useInOut(p);   // _samples are clip frames
    const mode = String(p.mode || 'bars');
    const level = (off = 0) => envelope(p, raw - off, fps, 1);
    // a little smoothing so single frames do not flicker
    const lv = (level(0) * 2 + level(1) + level(2)) / 4;
    const color = p.color || '#ffffff';
    const L = useVibe(p), C = plainClassic(p, L), Ld = useVibe(p, true);
    const label = p.label ? <div style={{ marginTop: 22, ...face(L, 'display', { fontFamily: FONT.sans, fontWeight: 700 }, C, 38), color: C ? '#fff' : L.bare.color,
        textShadow: C ? '0 3px 14px rgba(0,0,0,.6)' : L.bare.shadow, textAlign: 'center' }}>{p.label}</div> : null;
    let body: React.ReactNode;
    if (mode === 'ring') {
        const N = 64, R = 150;
        body = (
            <svg width={520} height={520} viewBox="-260 -260 520 520" style={{ filter: 'drop-shadow(0 6px 18px rgba(0,0,0,.45))' }}>
                <circle r={R - 16} fill="none" stroke={color} strokeWidth={4} opacity={0.35} />
                {Array.from({ length: N }, (_, i) => {
                    const a = (i / N) * Math.PI * 2, h = 12 + envelope(p, raw - (i % 16) * 0.7, fps, 1 + (i % 16) * 0.35) * 82 * (0.55 + rand(i) * 0.45);
                    return <line key={i} x1={Math.cos(a) * R} y1={Math.sin(a) * R} x2={Math.cos(a) * (R + h)} y2={Math.sin(a) * (R + h)}
                        stroke={i % 4 === 0 ? p.accent : color} strokeWidth={7} strokeLinecap="round" />;
                })}
            </svg>
        );
    } else if (mode === 'orb') {
        const s = 1 + lv * 0.42;
        body = (
            <div style={{ width: 420, height: 420, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {[1.5, 1.22].map((m, i) => <div key={i} style={{ position: 'absolute', width: 220, height: 220, borderRadius: 220, background: p.accent, opacity: 0.16 + lv * 0.14, transform: `scale(${1 + lv * m * 0.7})` }} />)}
                <div style={{ width: 220, height: 220, borderRadius: 220, transform: `scale(${s})`, boxShadow: `0 0 ${40 + lv * 90}px ${p.accent}`,
                    background: `radial-gradient(circle at 35% 30%, #fff, ${p.accent} 55%, rgba(0,0,0,.25))` }} />
            </div>
        );
    } else {
        const N = Math.max(5, Math.min(48, Math.round(Number(p.bars) || 21)));
        body = (
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, height: 260, padding: '0 34px', ...(C ? { borderRadius: 34, background: 'rgba(16,18,22,.78)', boxShadow: '0 18px 44px rgba(0,0,0,.35)' } : Ld.card(34)) }}>
                {Array.from({ length: N }, (_, i) => {
                    const mid = 1 - Math.abs(i - (N - 1) / 2) / (N / 2) * 0.55;
                    const h = 14 + envelope(p, raw - Math.abs(i - (N - 1) / 2) * 0.8, fps, 1 + i * 0.41) * 200 * mid;
                    return <div key={i} style={{ width: 13, height: h, borderRadius: L.r(13), background: i % 3 === 1 ? p.accent : color }} />;
                })}
            </div>
        );
    }
    return (
        <Place p={p}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: clamp(inn * 1.5), transform: `scale(${0.85 + inn * 0.15})` }}>{body}{label}</div>
        </Place>
    );
};
