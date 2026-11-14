// Sticky text: a sticker-style label slaps onto an object in the shot with a slight tilt and a small wobble, and stays
// on it when the shot moves: props._track (src/main/broll-footage.js, the Track Subject tracker) is where the spot under
// the label goes on each clip frame. Without it (preview, Stick to the shot off) the label stays where it is put.
import React from 'react';
import { spring } from 'remotion';
import { Common, FONT, Place, clamp, useInOut } from '../lib/common';
import { face, plainClassic, useVibe } from '../lib/vibe';

type Track = { first: number; anchor: number; pts: number[][] };
type P = Common & { _track?: unknown; text: string; color: string; ink: string; tilt: number; peel: boolean; hand: boolean; follow: boolean };

// How far the spot under the label has moved since the label landed, 0..1 of the frame.
function drift(t: unknown, real: number): [number, number] {
    const tr = t as Track | undefined;
    if (!tr || !Array.isArray(tr.pts) || !tr.pts.length) return [0, 0];
    const at = (i: number) => tr.pts[clamp(Math.round(i), 0, tr.pts.length - 1)];
    const a = at(tr.anchor), b = at(real - (tr.first || 0));
    return [Number(b[0]) - Number(a[0]) || 0, Number(b[1]) - Number(a[1]) || 0];
}

export const StickyText: React.FC<P> = (p) => {
    const { frame, real, raw, fps } = useInOut(p, () => 10);
    const L = useVibe(p), C = plainClassic(p, L);
    const s = spring({ frame, fps, config: { damping: 10, stiffness: 230, mass: 0.7 } });
    const wob = Math.sin(raw / 5) * 2.2 * Math.max(0, 1 - Math.max(0, frame - 8) / 22);
    const color = p.color || '#ffe45c';
    const [dx, dy] = p.follow === false ? [0, 0] : drift(p._track, real);
    // the track is in frame fractions; Place clamps x / y to the frame, so a label carried off the edge stays at it
    const at = { ...p, x: (p.x ?? 0.5) + dx, y: (p.y ?? 0.5) + dy };
    return (
        <Place p={at}>
            <div style={{ position: 'relative', display: 'inline-block', padding: '18px 40px 20px', background: color, color: p.ink || '#15171b', border: '7px solid #fff', borderRadius: L.r(16),
                ...(p.hand ? { fontFamily: FONT.hand, fontWeight: 700, fontSize: 96, letterSpacing: 0 } : face(L, 'display', { fontFamily: FONT.sans, fontWeight: 800, letterSpacing: -1 }, C, 74)),
                lineHeight: 1.05, whiteSpace: 'pre', textAlign: 'center',
                boxShadow: '0 12px 26px rgba(0,0,0,.4)', opacity: clamp(frame / 2), transform: `scale(${s > 0 ? 2.2 - s * 1.2 : 0}) rotate(${(Number(p.tilt) || 0) + wob}deg)` }}>
                {String(p.text || '').replace(/\s*\|\s*/g, '\n')}
                {p.peel && <div style={{ position: 'absolute', right: -7, bottom: -7, width: 44, height: 44, borderRadius: `${L.r(16)}px 0 ${L.r(14)}px 0`, background: 'linear-gradient(135deg, #fff 50%, rgba(0,0,0,.18) 51%, transparent 62%)' }} />}
            </div>
        </Place>
    );
};
