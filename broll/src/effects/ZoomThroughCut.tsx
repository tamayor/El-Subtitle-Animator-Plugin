// Zoom-through cut: the headline rushes at the camera with radial streaks and a yellow glow until it fills the frame,
// the frame flashes, and it clears. Put the flash on the cut: it hides the change of shot underneath.
import React from 'react';
import { useVideoConfig } from 'remotion';
import { Common, FONT, Full, clamp, prog, rand, useInOut, useUnit } from '../lib/common';
import { face, plainClassic, useVibe } from '../lib/vibe';

type P = Common & { text: string; glow: string; streaks: number; flash: boolean };

export const ZoomThroughCut: React.FC<P> = (p) => {
    const { frame, durationInFrames: D } = useInOut(p, (D0) => Math.max(8, Math.round(D0 * 0.55)));
    const { width: W, height: H } = useVideoConfig();
    const u = useUnit();
    const peak = Math.max(8, Math.round(D * 0.55));
    const k = prog(frame, 0, peak), z = Math.pow(k, 3.2);          // slow start, then it rushes
    const scale = (0.9 + z * 34) * (p.scale || 1);
    const after = prog(frame, peak, peak + 7);
    const glow = p.glow || '#ffd84a';
    const cx = clamp(p.x ?? 0.5) * W, cy = clamp(p.y ?? 0.5) * H;
    const n = Math.max(0, Math.min(80, Math.round(Number(p.streaks) || 36)));
    const gone = frame >= peak + 7;
    const L = useVibe(p), C = plainClassic(p, L);
    const word = face(L, 'display', { fontFamily: FONT.sans, fontWeight: 800 }, C);
    return (
        <Full p={p} style={gone ? { opacity: 0 } : undefined}>
            <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(circle at ${cx}px ${cy}px, ${glow} 0%, transparent ${10 + z * 90}%)`, opacity: clamp(k * 1.2) * 0.75 * (1 - after) }} />
            <svg width={W} height={H} style={{ position: 'absolute', inset: 0, opacity: clamp(k * 2) * (1 - after) }}>
                {Array.from({ length: n }, (_, i) => {
                    const a = (i / n) * Math.PI * 2 + rand(i) * 0.2, r0 = (0.16 + rand(i * 3.3) * 0.2 + z * 0.3) * Math.max(W, H), len = (0.08 + rand(i * 1.9) * 0.2 + z * 0.5) * Math.max(W, H);
                    return <line key={i} x1={cx + Math.cos(a) * r0} y1={cy + Math.sin(a) * r0} x2={cx + Math.cos(a) * (r0 + len)} y2={cy + Math.sin(a) * (r0 + len)}
                        stroke={i % 3 ? '#fff' : glow} strokeWidth={(2 + rand(i * 7.7) * 5) * u} strokeLinecap="round" opacity={0.35 + rand(i * 5.1) * 0.5} />;
                })}
            </svg>
            {/* the zoom blur: a few trailing copies of the text */}
            {frame < peak + 2 && [0.82, 0.9, 1].map((m, i) => (
                <div key={i} style={{ position: 'absolute', left: cx, top: cy, transform: `translate(-50%, -50%) scale(${scale * m})`, ...word, fontSize: 130 * u,
                    color: i === 2 ? '#fff' : glow, opacity: (i === 2 ? 1 : 0.35) * clamp(k * 4) * (1 - prog(frame, peak - 3, peak + 1)), whiteSpace: 'nowrap', letterSpacing: -3 * u,
                    textShadow: `0 0 ${30 * u}px ${glow}`, filter: `blur(${z * (i === 2 ? 1.5 : 5) * u}px)` }}>{p.text}</div>
            ))}
            {p.flash && <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(circle at ${cx}px ${cy}px, #fff 0%, ${glow} 120%)`, opacity: prog(frame, peak - 4, peak) * (1 - after) }} />}
        </Full>
    );
};
