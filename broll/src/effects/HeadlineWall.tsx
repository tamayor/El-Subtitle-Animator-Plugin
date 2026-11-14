// Headline wall: torn newspaper clippings and sticky notes pop in around the edges of the frame like a collage,
// leaving the middle (the speaker) clear.
import React from 'react';
import { spring, useVideoConfig } from 'remotion';
import { Common, FONT, Full, clamp, rand, useInOut, useUnit, wordTimes } from '../lib/common';
import { Grain, PAPER, TextLines, Tape, tornClip } from '../lib/paper';

type P = Common & { headlines: string[]; notes: string[]; spread: number };

// where the pieces go (frame shares, centre of each piece), around a clear middle
const SLOTS = [[0.2, 0.2, -6], [0.8, 0.24, 5], [0.17, 0.62, 4], [0.83, 0.66, -4], [0.3, 0.86, -3], [0.72, 0.9, 6], [0.5, 0.1, 2]];
const NOTE_SLOTS = [[0.36, 0.34, 7], [0.66, 0.42, -8], [0.6, 0.74, 5], [0.38, 0.7, -5]];

export const HeadlineWall: React.FC<P> = (p) => {
    const heads = (p.headlines || []).map(String).filter(Boolean).slice(0, SLOTS.length);
    const notes = (p.notes || []).map(String).filter(Boolean).slice(0, NOTE_SLOTS.length);
    const total = heads.length + notes.length;
    const { frame, real, fps, durationInFrames: D } = useInOut(p, (D0) => Math.min(Math.round(D0 * 0.6), 4 + total * 4) + 8);
    const { width: W, height: H } = useVideoConfig();
    const u = useUnit() * (p.scale || 1);
    const build = Math.min(Math.round(D * 0.6), 4 + total * 4);
    const times = wordTimes(p, heads.length);
    const spread = clamp(Number(p.spread) || 1, 0.5, 1.4);
    // a piece never hangs over the frame's side (narrow 9:16 frames)
    const pos = (s: number[], w: number) => ({ left: Math.max(w / 2 + 14 * u, Math.min(W - w / 2 - 14 * u, (0.5 + (s[0] - 0.5) * spread) * W)), top: (0.5 + (s[1] - 0.5) * spread) * H });
    return (
        <Full p={p}>
            {heads.map((h, i) => {
                const at = times ? times[i] : 2 + (i / Math.max(1, total)) * build;
                const s = spring({ frame: (times ? real : frame) - at, fps, config: { damping: 12, stiffness: 200, mass: 0.7 } });
                const sl = SLOTS[i], w = Math.min((360 + rand(i * 2.3) * 110) * u, W * 0.46);
                return (
                    <div key={i} style={{ position: 'absolute', ...pos(sl, w), width: w, marginLeft: -w / 2, transform: `translateY(-50%) scale(${s > 0 ? 1.6 - s * 0.6 : 0}) rotate(${sl[2] + (1 - s) * 16}deg)`,
                        opacity: clamp(s * 3), filter: `drop-shadow(0 ${10 * u}px ${14 * u}px rgba(0,0,0,.42))` }}>
                        <div style={{ position: 'relative', background: i % 3 === 1 ? PAPER.white : PAPER.news, padding: `${20 * u}px ${22 * u}px ${24 * u}px`, clipPath: tornClip(i + 2, { left: i % 2 === 0, right: i % 2 === 1, depth: 3.2 }) }}>
                            <Grain id={'hwg' + i} opacity={0.28} seed={i + 1} />
                            <div style={{ position: 'relative' }}>
                                <div style={{ fontFamily: FONT.sans, fontWeight: 700, fontSize: 13 * u, letterSpacing: 2 * u, color: '#8a2a20', textTransform: 'uppercase', marginBottom: 6 * u }}>{['Breaking', 'Report', 'Opinion', 'Exclusive', 'Latest'][i % 5]}</div>
                                <div style={{ fontFamily: FONT.serif, fontSize: (h.length > 34 ? 34 : 42) * u, lineHeight: 1, color: '#1d1912', marginBottom: 12 * u }}>{h}</div>
                                <TextLines n={3} gap={7 * u} h={4 * u} seed={i} />
                            </div>
                        </div>
                    </div>
                );
            })}
            {notes.map((t, i) => {
                const at = 2 + ((heads.length + i) / Math.max(1, total)) * build;
                const s = spring({ frame: frame - at, fps, config: { damping: 11, stiffness: 220, mass: 0.6 } });
                const sl = NOTE_SLOTS[i], w = 190 * u;
                return (
                    <div key={'n' + i} style={{ position: 'absolute', ...pos(sl, w), width: w, height: w * 0.92, marginLeft: -w / 2, marginTop: -w / 2, background: i % 2 ? '#ffb3d1' : PAPER.sticky,
                        transform: `scale(${s}) rotate(${sl[2]}deg)`, boxShadow: `0 ${8 * u}px ${16 * u}px rgba(0,0,0,.35)`, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
                        fontFamily: FONT.hand, fontWeight: 700, fontSize: 44 * u, lineHeight: 0.95, color: '#2c2710', padding: 10 * u, boxSizing: 'border-box' }}>
                        {t}
                        <Tape left="50%" top={0} width={70 * u} angle={-4} color={`${p.accent}cc`} />
                    </div>
                );
            })}
        </Full>
    );
};
