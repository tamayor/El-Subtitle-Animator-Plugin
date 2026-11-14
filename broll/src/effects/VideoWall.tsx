// Wall of videos: the frame fills with a grid of vertical video thumbnails, a big counter pops in over it, then the
// grid fades away. For scale and social proof ("I made 46 of these").
import React from 'react';
import { spring, useVideoConfig } from 'remotion';
import { Common, FONT, Full, clamp, ease, fmtNumber, prog, rand, useInOut, useUnit } from '../lib/common';
import { face, plainClassic, useVibe } from '../lib/vibe';

type P = Common & { _thumbs?: string[]; realClips?: boolean; count: number; label: string; columns: number; dim: number; fade: boolean };

const HUES = [208, 28, 142, 338, 268, 48, 188];

export const VideoWall: React.FC<P> = (p) => {
    const { frame, raw, fps, durationInFrames: D } = useInOut(p, (D0) => Math.max(12, Math.round(D0 * 0.45)));
    const L = useVibe(p), C = plainClassic(p, L);
    const { width: W, height: H } = useVideoConfig();
    const u = useUnit();
    const end = Math.max(12, Math.round(D * 0.45));
    const cols = Math.max(4, Math.min(16, Math.round(Number(p.columns) || 9)));
    const gap = 8 * u, cw = (W - gap * (cols + 1)) / cols, ch = cw * 16 / 9, rows = Math.ceil((H + ch) / (ch + gap));
    const fadeFrom = Math.max(end + 8, D - Math.round(fps * 0.5));
    const fade = p.fade ? 1 - prog(raw, fadeFrom, D - 2) : 1;
    const pop = spring({ frame: frame - Math.round(end * 0.55), fps, config: { damping: 10, stiffness: 190, mass: 0.8 } });
    const count = Math.max(0, Number(p.count) || 0);
    const shown = Math.round(count * ease(prog(frame, end * 0.55, end)));
    const drift = raw * 0.6 * u;
    const thumbs = Array.isArray(p._thumbs) ? p._thumbs : [];
    return (
        <Full p={p} style={{ opacity: fade }}>
            <div style={{ position: 'absolute', inset: 0, background: `rgba(8,9,12,${clamp(Number(p.dim) || 0, 0, 1) * clamp(frame / 6)})` }} />
            {Array.from({ length: cols * rows }, (_, i) => {
                const c = i % cols, r = Math.floor(i / cols);
                const order = rand(i * 1.93);                                  // they fill in at random
                const k = clamp((frame - order * end * 0.7) / 6);
                const pic = thumbs.length ? thumbs[Math.floor(rand(i * 7.31) * thumbs.length)] : null;
                const hue = HUES[Math.floor(rand(i * 3.7) * HUES.length)], l = 30 + rand(i * 5.1) * 26;
                return (
                    <div key={i} style={{ position: 'absolute', left: gap + c * (cw + gap), top: gap + r * (ch + gap) - (c % 2 ? ch * 0.4 : 0) - drift * (c % 2 ? 1 : -1) * 0.3 - (c % 2 ? 0 : ch * 0.2), width: cw, height: ch, borderRadius: 10 * u, overflow: 'hidden',
                        background: pic ? `center / cover url(${pic})` : `linear-gradient(${160 + rand(i) * 40}deg, hsl(${hue} 46% ${l + 14}%), hsl(${(hue + 30) % 360} 40% ${l - 12}%))`, opacity: k, transform: `scale(${0.8 + k * 0.2})` }}>
                        {pic ? <div style={{ position: 'absolute', left: 6 * u, right: cw * 0.4, bottom: 8 * u, height: 5 * u, borderRadius: 5 * u, background: 'rgba(255,255,255,.75)' }} /> : <>
                        <div style={{ position: 'absolute', left: '50%', top: '34%', width: cw * 0.36, height: cw * 0.36, marginLeft: -cw * 0.18, borderRadius: cw, background: 'rgba(255,255,255,.3)' }} />
                        <div style={{ position: 'absolute', left: '22%', right: '22%', top: '54%', bottom: 0, borderRadius: `${cw * 0.3}px ${cw * 0.3}px 0 0`, background: 'rgba(255,255,255,.22)' }} />
                        <div style={{ position: 'absolute', left: 6 * u, right: cw * 0.4, bottom: 8 * u, height: 5 * u, borderRadius: 5 * u, background: 'rgba(255,255,255,.75)' }} /></>}
                    </div>
                );
            })}
            <div style={{ position: 'absolute', left: clamp(p.x ?? 0.5) * W, top: clamp(p.y ?? 0.5) * H, transform: `translate(-50%, -50%) scale(${pop * (p.scale || 1)})`, textAlign: 'center', fontFamily: C ? FONT.sans : L.v.font.body }}>
                <div style={{ ...face(L, 'num', { fontWeight: 800, letterSpacing: -12 * u }, C, 380 * u), lineHeight: 0.9, color: C ? '#fff' : L.bare.color, fontVariantNumeric: 'tabular-nums', textShadow: `0 ${10 * u}px ${50 * u}px rgba(0,0,0,.7)` }}>{fmtNumber(shown)}</div>
                {p.label && <div style={{ display: 'inline-block', marginTop: 14 * u, padding: `${8 * u}px ${28 * u}px`, borderRadius: L.r(50) * u, background: p.accent, color: C ? '#10140f' : L.onAccent, ...face(L, 'display', { fontWeight: 800 }, C, 50 * u), whiteSpace: 'nowrap' }}>{p.label}</div>}
            </div>
        </Full>
    );
};
