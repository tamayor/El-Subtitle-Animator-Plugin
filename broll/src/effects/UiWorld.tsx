// UI world: glass interface panels float around the speaker: a prompt box typing a request, a progress bar that runs
// to 100% and ticks, a timeline strip and a small "live preview" card. The middle of the frame stays clear.
import React from 'react';
import { spring, useVideoConfig } from 'remotion';
import { Common, FONT, Full, clamp, ease, prog, rand, typed, useInOut, useUnit } from '../lib/common';
import { face, plainClassic, useVibe } from '../lib/vibe';

type P = Common & { prompt: string; task: string; doneText: string; card: string; spread: number; tint: string };

export const UiWorld: React.FC<P> = (p) => {
    const prompt = String(p.prompt || '');
    const { frame, raw, fps, durationInFrames: D } = useInOut(p, (D0, f) => Math.min(Math.round(D0 * 0.7), Math.round(prompt.length / 16 * f) + 34));
    const { width: W, height: H } = useVideoConfig();
    const u = useUnit() * (p.scale || 1);
    const typeEnd = 6 + Math.round((prompt.length / 16) * fps);
    const end = Math.min(Math.round(D * 0.7), typeEnd + 28);
    const pct = ease(prog(frame, Math.min(typeEnd, end - 12), end));
    const sp = clamp(Number(p.spread) || 1, 0.5, 1.4);
    // panels are narrowed and pulled in on narrow (9:16) frames so none hangs over the side
    const fit = (w: number) => Math.min(w * u, W * 0.9);
    const at = (x: number, y: number, w: number) => ({ left: Math.max(fit(w) / 2 + 16 * u, Math.min(W - fit(w) / 2 - 16 * u, (0.5 + (x - 0.5) * sp) * W)), top: (0.5 + (y - 0.5) * sp) * H });
    const tint = p.tint || '#ffffff';
    // the glass keeps its own Tint field (the panels float over the footage); the vibe gives the type and the corners
    const L = useVibe(p), C = plainClassic(p, L);
    const glass = (i: number, w: number): React.CSSProperties => {
        const s = spring({ frame: frame - i * 4, fps, config: { damping: 15, stiffness: 150 } });
        return { position: 'absolute', width: fit(w), marginLeft: -fit(w) / 2, background: `linear-gradient(145deg, ${tint}3d, ${tint}1f)`, border: `${1.5 * u}px solid ${tint}66`, borderRadius: L.r(26) * u,
            backdropFilter: 'blur(20px)', boxShadow: `0 ${18 * u}px ${44 * u}px rgba(0,0,0,.34), inset 0 ${1 * u}px 0 ${tint}55`, padding: `${20 * u}px ${24 * u}px`, boxSizing: 'border-box',
            fontFamily: C ? FONT.sans : L.v.font.body, color: '#fff', opacity: clamp(s * 1.6), transform: `translateY(${-50 + (1 - s) * 30 + Math.sin(raw / 18 + i * 1.7) * 1.4}%) scale(${0.9 + s * 0.1})` };
    };
    const lab: React.CSSProperties = { ...face(L, 'label', { fontWeight: 700, letterSpacing: 2 * u }, C, 17 * u), textTransform: 'uppercase', opacity: 0.72, marginBottom: 10 * u };
    const caret = Math.floor(raw / 8) % 2 === 0 && frame < typeEnd + 6;
    const done = pct >= 1;
    return (
        <Full p={p}>
            <div style={{ ...glass(0, 470), ...at(0.24, 0.2, 470) }}>
                <div style={lab}>Prompt</div>
                <div style={{ fontSize: 32 * u, fontWeight: 600, minHeight: 40 * u }}>{typed(prompt, frame, 6, fps, 16)}{caret ? <span style={{ fontWeight: 300 }}>|</span> : null}</div>
            </div>
            <div style={{ ...glass(1, 420), ...at(0.78, 0.3, 420) }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 * u }}>
                    <div style={{ fontSize: 28 * u, fontWeight: 700 }}>{done ? (p.doneText || 'Done') : (p.task || 'Working…')}</div>
                    <div style={{ fontSize: 28 * u, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: p.accent }}>{done ? '✓' : Math.round(pct * 100) + '%'}</div>
                </div>
                <div style={{ height: 14 * u, borderRadius: 14 * u, background: 'rgba(255,255,255,.2)', overflow: 'hidden' }}><div style={{ width: `${pct * 100}%`, height: '100%', background: p.accent, borderRadius: 14 * u }} /></div>
            </div>
            <div style={{ ...glass(2, 620), ...at(0.5, 0.88, 620) }}>
                <div style={lab}>Timeline</div>
                {[0, 1].map(r => (
                    <div key={r} style={{ display: 'flex', gap: 5 * u, marginBottom: 6 * u, height: 30 * u }}>
                        {Array.from({ length: 6 }, (_, i) => <div key={i} style={{ flex: 1 + rand(r * 9 + i) * 2.4, borderRadius: 7 * u, background: [p.accent, '#7fb7ff', '#ffb86b', '#f07b8e'][(i + r) % 4], opacity: 0.55 + rand(i + r * 3) * 0.45 }} />)}
                    </div>
                ))}
                <div style={{ position: 'absolute', top: 44 * u, bottom: 14 * u, width: 3 * u, background: '#fff', left: `${8 + pct * 84}%`, boxShadow: '0 0 8px rgba(255,255,255,.8)' }} />
            </div>
            <div style={{ ...glass(3, 300), ...at(0.17, 0.66, 300) }}>
                <div style={lab}>{p.card || 'Live preview'}</div>
                <div style={{ height: 150 * u, borderRadius: 16 * u, background: `linear-gradient(135deg, ${p.accent}aa, rgba(255,255,255,.14))`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ width: 0, height: 0, borderLeft: `${34 * u}px solid #fff`, borderTop: `${22 * u}px solid transparent`, borderBottom: `${22 * u}px solid transparent`, marginLeft: 8 * u }} />
                </div>
            </div>
        </Full>
    );
};
