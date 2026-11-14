// Before + after: a bright vertical divider sweeps across the frame with "before" / "after" labels.
//   A footage look (Flat / Washed out / Black & white): the "before" side is the clip's own frames (props._seq.full)
//     with that look; the "after" side is left clear, so the real clip and its grade show there. Two real grades.
//   Tint: the side the divider has passed gets a colour tint (the overlay alone, nothing read from the footage).
// Without the footage (a preview off the timeline) the footage looks fall back to the tint.
import React from 'react';
import { useVideoConfig } from 'remotion';
import { Common, FONT, Full, clamp, ease, prog, useInOut, useUnit } from '../lib/common';
import { Footage, seqOf } from '../lib/footage';
import { face, plainClassic, useVibe } from '../lib/vibe';

type P = Common & { _seq?: unknown; look: string; before: string; after: string; tint: string; strength: number; from: number; to: number; reverse: boolean };

// CSS filters for the "before" side: what the footage looked like before the grade
const LOOKS: Record<string, string> = {
    'Flat (log)': 'contrast(0.7) saturate(0.5) brightness(1.1)',
    'Washed out': 'contrast(0.82) saturate(0.32) brightness(1.14) sepia(0.14)',
    'Black & white': 'grayscale(1) contrast(1.06)'
};

export const BeforeAfterWipe: React.FC<P> = (p) => {
    const { frame, real, durationInFrames: D } = useInOut(p, (D0) => Math.max(10, Math.round(D0 * 0.6)));
    const { width: W, height: H } = useVideoConfig();
    const u = useUnit() * (p.scale || 1);
    const L = useVibe(p), C = plainClassic(p, L);
    const end = Math.max(10, Math.round(D * 0.6));
    const k = ease(prog(frame, 3, end));
    const a = clamp(p.from ?? 0.05), b = clamp(p.to ?? 0.62);
    const x = (a + (b - a) * k) * W;
    const on = clamp(frame / 4);
    const seq = seqOf(p);
    const filter = LOOKS[String(p.look || 'Flat (log)')];
    const real2 = !!(filter && seq && seq.full);
    const tag = (text: string, side: 'l' | 'r'): React.CSSProperties => ({ position: 'absolute', top: clamp(p.y ?? 0.12) * H, [side === 'l' ? 'right' : 'left']: 22 * u, padding: `${8 * u}px ${20 * u}px`,
        borderRadius: L.r(40) * u, background: side === 'l' ? L.accent : 'rgba(16,18,22,.8)', color: side === 'l' ? (C ? '#10140f' : L.onAccent) : '#fff',
        ...face(L, 'label', { fontFamily: FONT.sans, fontWeight: 800, letterSpacing: 2 * u }, C, 30 * u), textTransform: 'uppercase', whiteSpace: 'nowrap', boxShadow: `0 ${6 * u}px ${16 * u}px rgba(0,0,0,.35)` } as React.CSSProperties);
    // the "after" side is the one the divider has passed: left, or right with reverse
    const afterSide: React.CSSProperties = p.reverse ? { left: x, right: 0 } : { left: 0, width: x };
    const beforeClip = p.reverse ? `inset(0 ${Math.max(0, W - x)}px 0 0)` : `inset(0 0 0 ${x}px)`;
    return (
        <Full p={p} style={{ opacity: on }}>
            {real2 ? (
                <div style={{ position: 'absolute', inset: 0, clipPath: beforeClip }}>
                    <Footage seq={seq} real={real} style={{ filter }} />
                    {p.look === 'Flat (log)' && <div style={{ position: 'absolute', inset: 0, background: 'rgb(60,60,62)', opacity: 0.12 }} />}
                </div>
            ) : (
                <>
                    <div style={{ position: 'absolute', top: 0, bottom: 0, ...afterSide, background: p.tint || '#ffb45c', opacity: clamp(Number(p.strength) || 0, 0, 0.6), mixBlendMode: 'soft-light' }} />
                    <div style={{ position: 'absolute', top: 0, bottom: 0, ...afterSide, background: `linear-gradient(180deg, ${p.tint || '#ffb45c'}, transparent 70%)`, opacity: clamp(Number(p.strength) || 0, 0, 0.6) * 0.5 }} />
                </>
            )}
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: x - 3 * u, width: 6 * u, background: '#fff', boxShadow: `0 0 ${26 * u}px ${6 * u}px rgba(255,255,255,.75)` }}>
                <div style={{ position: 'absolute', top: '50%', left: '50%', width: 74 * u, height: 74 * u, margin: `${-37 * u}px 0 0 ${-37 * u}px`, borderRadius: 74 * u, background: '#fff', boxShadow: `0 ${6 * u}px ${18 * u}px rgba(0,0,0,.4)`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT.sans, fontWeight: 800, fontSize: 30 * u, color: '#14161a' }}>‹›</div>
                <div style={tag(p.reverse ? p.before : p.after, 'l')}>{p.reverse ? p.before : p.after}</div>
                <div style={tag(p.reverse ? p.after : p.before, 'r')}>{p.reverse ? p.after : p.before}</div>
            </div>
        </Full>
    );
};
