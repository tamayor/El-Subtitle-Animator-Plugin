// Depth scatter: a giant word sits behind and in front of the speaker; its letters fly apart at different depths, the
// near ones blurred. Reads every frame of the footage (props._seq): the letters behind are drawn under the speaker's
// cut-out, the ones in front over it.
import React from 'react';
import { spring, useVideoConfig } from 'remotion';
import { Common, FONT, Full, clamp, ease, prog, rand, useInOut, useUnit } from '../lib/common';
import { face, plainClassic, useVibe } from '../lib/vibe';
import { Speaker, seqOf } from '../lib/footage';

type P = Common & { _seq?: unknown; text: string; color: string; spread: number; front: number; blur: number; seed: number; hold: number };

export const DepthScatter: React.FC<P> = (p) => {
    const { frame, real, fps, durationInFrames: D } = useInOut(p, (D0) => Math.max(10, Math.round(D0 * 0.3)));
    const { width: W, height: H } = useVideoConfig();
    const u = useUnit() * (p.scale || 1);
    const seq = seqOf(p);
    const L = useVibe(p), C = plainClassic(p, L);
    const word = face(L, 'display', { fontFamily: FONT.sans, fontWeight: 800 }, C);
    const letters = [...String(p.text || '').toUpperCase()].filter(ch => ch.trim());
    const n = Math.max(1, letters.length), seed = Number(p.seed) || 1;
    const size = Math.min(H * 0.5, (W * 1.06) / (n * 0.62));
    const pop = spring({ frame, fps, config: { damping: 13, stiffness: 150 } });
    // together for `hold` of the clip, then they fly
    const startFly = Math.round(D * clamp(Number(p.hold) || 0.3, 0, 0.9));
    const k = ease(prog(frame, startFly, D - 1));
    const share = clamp(Number(p.front) || 0.4);
    const piece = (ch: string, i: number) => {
        const r = (q: number) => rand(seed * 9.7 + i * 4.3 + q);
        const near = r(1) < share;                                   // in front of the speaker
        const depth = near ? 0.35 + r(2) * 0.65 : -(0.2 + r(2) * 0.8);
        const x = W * (p.x ?? 0.5) + (i - (n - 1) / 2) * size * 0.62;
        const fly = (Number(p.spread) || 1) * k;
        const dx = (i - (n - 1) / 2) / Math.max(1, n / 2) * W * 0.2 * fly * (1 + depth * 0.6) + (r(3) - 0.5) * W * 0.1 * fly;
        const dy = (r(4) - 0.5) * H * 0.3 * fly * (1 + Math.abs(depth));
        const sc = pop * (1 + depth * 0.9 * k);
        const el = (
            <div key={i} style={{ position: 'absolute', left: x + dx, top: H * (p.y ?? 0.4) + dy, transform: `translate(-50%, -50%) scale(${sc}) rotate(${(r(5) - 0.5) * 50 * k}deg)`,
                ...word, fontSize: size, lineHeight: 1, color: p.color || '#ffffff', letterSpacing: -size * 0.03,
                filter: near ? `blur(${depth * (Number(p.blur) || 0) * (0.25 + k * 0.75) * u}px)` : 'none', opacity: clamp(pop * 2) * (near ? 0.96 : 1),
                textShadow: near ? 'none' : `0 ${6 * u}px ${30 * u}px rgba(0,0,0,.35)` }}>{ch}</div>
        );
        return { near, depth, el };
    };
    const all = letters.map(piece).sort((a, b) => a.depth - b.depth);
    return (
        <Full p={p}>
            {all.filter(q => !q.near).map(q => q.el)}
            <Speaker seq={seq} real={real} />
            {all.filter(q => q.near).map(q => q.el)}
        </Full>
    );
};
