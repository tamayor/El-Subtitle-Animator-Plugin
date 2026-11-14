// Orbit: vertical video cards turn round the speaker like a carousel, passing behind and in front, with blur while
// they move. Reads every frame of the footage (props._seq) for the speaker's cut-out; the cards show frames of the
// timeline's own clips (props._thumbs) when there are any.
import React from 'react';
import { spring, useVideoConfig } from 'remotion';
import { Common, Full, clamp, ease, prog, rand, useInOut, useUnit } from '../lib/common';
import { Speaker, seqOf, speakerBox } from '../lib/footage';

type P = Common & { _seq?: unknown; _thumbs?: string[]; cards: number; radius: number; turns: number; cardWidth: number; tiltY: number; blur: number };

const HUES = [208, 28, 142, 338, 268, 48];

export const OrbitCarousel: React.FC<P> = (p) => {
    const { frame, real, fps, durationInFrames: D } = useInOut(p, (D0) => Math.max(10, Math.round(D0 * 0.5)));
    const { width: W, height: H } = useVideoConfig();
    const u = useUnit() * (p.scale || 1);
    const seq = seqOf(p), b = speakerBox(seq);
    const n = Math.max(3, Math.min(14, Math.round(Number(p.cards) || 7)));
    const thumbs = Array.isArray(p._thumbs) ? p._thumbs : [];
    const t = prog(frame, 0, D - 1), turn = ease(t) * (Number(p.turns) || 0.6) * Math.PI * 2;
    const speed = Math.abs(ease(Math.min(1, t + 1 / Math.max(2, D))) - ease(t)) * D;      // 0 at rest, ~1.5 mid-turn
    const cw = (Number(p.cardWidth) || 210) * u, ch = cw * 16 / 9;
    const cx = (seq ? b.cx : clamp(p.x ?? 0.5)) * W, cy = clamp(p.y ?? 0.5) * H;
    const R = clamp(Number(p.radius) || 0.36, 0.1, 0.8) * W;
    const pop = spring({ frame, fps, config: { damping: 14, stiffness: 120 } });
    const cards = Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 + turn, z = Math.cos(a), x = Math.sin(a);
        const sc = (0.62 + 0.38 * (z + 1) / 2) * pop;
        const pic = thumbs.length ? thumbs[i % thumbs.length] : null, hue = HUES[i % HUES.length];
        const el = (
            <div key={i} style={{ position: 'absolute', left: cx + x * R * pop - cw / 2, top: cy - ch / 2 + z * (Number(p.tiltY) || 0) * u + Math.sin(a * 2 + i) * 6 * u, width: cw, height: ch,
                borderRadius: 18 * u, overflow: 'hidden', transform: `perspective(${1400 * u}px) rotateY(${-x * 52}deg) scale(${sc})`,
                background: pic ? `center / cover url(${pic})` : `linear-gradient(165deg, hsl(${hue} 50% 58%), hsl(${(hue + 30) % 360} 44% 30%))`,
                boxShadow: `0 ${18 * u}px ${40 * u}px rgba(0,0,0,.45)`, border: `${3 * u}px solid rgba(255,255,255,.85)`, boxSizing: 'border-box',
                filter: `blur(${(speed * (Number(p.blur) || 0) * Math.abs(z * 0.4 + 0.6) + (z > 0.5 ? (z - 0.5) * 3 : 0)) * u}px) brightness(${0.62 + 0.38 * (z + 1) / 2})`, opacity: clamp(pop * 2) }}>
                {!pic && <div style={{ position: 'absolute', left: '50%', top: '38%', width: cw * 0.34, height: cw * 0.34, marginLeft: -cw * 0.17, borderRadius: cw, background: 'rgba(255,255,255,.3)' }} />}
                <div style={{ position: 'absolute', left: 12 * u, right: cw * 0.4, bottom: 14 * u, height: 7 * u, borderRadius: 7 * u, background: 'rgba(255,255,255,.8)' }} />
                <div style={{ position: 'absolute', right: 12 * u, top: 12 * u, fontSize: 22 * u, lineHeight: 1 }}>{rand(i * 2.2) > 0.5 ? '♥' : '▶'}</div>
            </div>
        );
        return { z, el };
    }).sort((q, r) => q.z - r.z);
    return (
        <Full p={p}>
            {cards.filter(q => q.z < 0).map(q => q.el)}
            <Speaker seq={seq} real={real} />
            {cards.filter(q => q.z >= 0).map(q => q.el)}
        </Full>
    );
};
