// Voice note: a chat voice-note bubble pops in and plays; the waveform fills, the timer runs, a caption chip sits under it.
import React from 'react';
import { interpolate } from 'remotion';
import { Common, FONT, Place, rand, useInOut } from '../lib/common';

type P = Common & { caption: string; length: string; dark: boolean };

function secs(s: string) { const m = /^(\d+):(\d{1,2})$/.exec(String(s || '').trim()); return m ? +m[1] * 60 + +m[2] : 12; }
const mmss = (v: number) => Math.floor(v / 60) + ':' + String(Math.floor(v % 60)).padStart(2, '0');

export const VoiceNote: React.FC<P> = (p) => {
    const { frame, durationInFrames: D, inn, out } = useInOut(p, (D0) => (p.enter ?? 10) + 4 + Math.round((D0 - (p.exit ?? 8) - (p.enter ?? 10) - 4) * 0.25));
    const play = interpolate(frame, [(p.enter ?? 10) + 4, D - (p.exit ?? 8)], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    const total = secs(p.length);
    const bars = 34;
    const dk = !!p.dark;
    const bub = dk ? '#1f2a22' : '#ffffff', ink = dk ? '#fff' : '#111', idle = dk ? 'rgba(255,255,255,.3)' : '#c9c9c9';

    return (
        <Place p={p}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: out, transform: `scale(${0.5 + 0.5 * inn})` }}>
                <div style={{ background: bub, borderRadius: 60, padding: '16px 22px 16px 16px', display: 'flex', alignItems: 'center', gap: 18,
                    boxShadow: '0 12px 34px rgba(0,0,0,.32)' }}>
                    <div style={{ width: 74, height: 74, borderRadius: 74, background: '#16301f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {play > 0 && play < 1
                            ? <svg width={30} height={30} viewBox="0 0 24 24"><rect x={5} y={4} width={5} height={16} rx={1} fill="#fff" /><rect x={14} y={4} width={5} height={16} rx={1} fill="#fff" /></svg>
                            : <svg width={32} height={32} viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z" fill="#fff" /></svg>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, height: 70 }}>
                        {Array.from({ length: bars }).map((_, i) => {
                            const on = i / bars < play;
                            const base = 0.25 + rand(i + 3) * 0.75;
                            const live = on && Math.abs(i / bars - play) < 0.06 ? 1 + 0.25 * Math.sin(frame / 2 + i) : 1;
                            return <div key={i} style={{ width: 6, height: 64 * base * live, borderRadius: 4, background: on ? ink : idle }} />;
                        })}
                    </div>
                    <div style={{ fontFamily: FONT.sans, fontWeight: 600, fontSize: 30, color: ink, width: 74, textAlign: 'right' }}>{mmss(total * play)}</div>
                    <div style={{ width: 52, height: 52, borderRadius: 52, background: p.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width={26} height={26} viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7" stroke="#111" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </div>
                </div>
                {p.caption && (
                    <div style={{ marginTop: 14, background: '#fff', color: '#111', fontFamily: FONT.sans, fontWeight: 600, fontSize: 28,
                        padding: '6px 18px', borderRadius: 10, boxShadow: '0 6px 18px rgba(0,0,0,.25)', opacity: Math.min(1, play * 4) }}>{p.caption}</div>
                )}
            </div>
        </Place>
    );
};
