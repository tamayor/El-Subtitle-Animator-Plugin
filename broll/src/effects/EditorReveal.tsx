// Pull-back reveal: the frame turns out to be the viewer of a video editor: the editor's panels (an effects checklist
// ticking off, a timeline with coloured clips and a waveform) pull back into view around a see-through viewer window.
// The footage shows through the window; shrink it with Effect presets > Transform to sit inside.
import React from 'react';
import { useVideoConfig } from 'remotion';
import { Common, FONT, Full, clamp, ease, prog, rand, useInOut, useUnit } from '../lib/common';
import { Footage, seqOf } from '../lib/footage';

type P = Common & { footage?: boolean; _seq?: unknown; title: string; checklist: string[]; viewer: number; tilt: number; pullFrom: number };

const CLIP = ['#7fb7ff', '#8ccf8e', '#ffb86b', '#f07b8e', '#c9a2ff'];

export const EditorReveal: React.FC<P> = (p) => {
    const items = (p.checklist || []).map(String).filter(Boolean).slice(0, 6);
    const { frame, raw, real, fps, durationInFrames: D } = useInOut(p, (D0) => Math.max(12, Math.round(D0 * 0.5)));
    const seq = p.footage === false ? null : seqOf(p);
    const { width: W, height: H } = useVideoConfig();
    const u = useUnit();
    const end = Math.max(12, Math.round(D * 0.5));
    const k = ease(prog(frame, 0, end));
    const from = Math.max(1.05, Number(p.pullFrom) || 2.4);
    const z = from + (1 - from) * k;
    // the viewer window: `viewer` of the frame's width, at (x, y)
    const vw = clamp(Number(p.viewer) || 0.52, 0.2, 0.9) * W, vh = vw * H / W;
    const vx = clamp(p.x ?? 0.56) * W - vw / 2, vy = clamp(p.y ?? 0.36) * H - vh / 2;
    const panel = '#1b1d22', line = 'rgba(255,255,255,.09)', dim = 'rgba(255,255,255,.55)';
    const tlTop = vy + vh + 14 * u, bar = 46 * u;
    const box = (s: React.CSSProperties): React.CSSProperties => ({ position: 'absolute', background: panel, boxSizing: 'border-box', ...s });
    const play = clamp(raw / Math.max(1, D));
    return (
        <Full p={p} style={{ opacity: clamp(frame / 3) }}>
            <div style={{ position: 'absolute', inset: 0, transformOrigin: `${vx + vw / 2}px ${vy + vh / 2}px`, transform: `scale(${z}) rotate(${(Number(p.tilt) || 0) * k}deg)`, fontFamily: FONT.sans, color: '#fff' }}>
                {/* the editor's body around the viewer (four pieces, so the viewer stays see-through) */}
                <div style={box({ left: -W, top: -H, width: W * 3, height: H + vy })} />
                <div style={box({ left: -W, top: vy, width: W + vx, height: vh })} />
                <div style={box({ left: vx + vw, top: vy, width: W * 2, height: vh })} />
                <div style={box({ left: -W, top: vy + vh, width: W * 3, height: H * 2 })} />
                {/* the footage, shrunk into the viewer (without it the viewer is a window onto the clip below) */}
                {seq && <div style={{ position: 'absolute', left: vx, top: vy, width: vw, height: vh, overflow: 'hidden', background: '#000' }}><Footage seq={seq} real={real} /></div>}
                <div style={{ position: 'absolute', left: vx - 3 * u, top: vy - 3 * u, width: vw + 6 * u, height: vh + 6 * u, border: `${3 * u}px solid #0c0d10`, borderRadius: 6 * u, boxSizing: 'border-box', boxShadow: `0 0 0 ${1 * u}px ${line}` }} />
                {/* top bar */}
                <div style={{ position: 'absolute', left: 0, right: 0, top: Math.max(0, vy - bar - 16 * u), height: bar, display: 'flex', alignItems: 'center', gap: 10 * u, padding: `0 ${22 * u}px`, borderBottom: `1px solid ${line}` }}>
                    {['#ff5f57', '#febc2e', '#28c840'].map(c => <div key={c} style={{ width: 14 * u, height: 14 * u, borderRadius: 14 * u, background: c }} />)}
                    <div style={{ marginLeft: 14 * u, fontSize: 20 * u, fontWeight: 600, color: dim }}>{p.title}</div>
                </div>
                {/* effects checklist */}
                <div style={{ position: 'absolute', left: 22 * u, top: vy, width: Math.max(0, vx - 44 * u), height: vh, overflow: 'hidden' }}>
                    <div style={{ fontSize: 17 * u, fontWeight: 700, letterSpacing: 2 * u, color: dim, textTransform: 'uppercase', marginBottom: 12 * u }}>Effects</div>
                    {items.map((it, i) => {
                        const on = frame > end * 0.5 + i * Math.max(4, (D - end) / (items.length + 2));
                        return (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 * u, padding: `${9 * u}px ${12 * u}px`, marginBottom: 6 * u, borderRadius: 10 * u, background: on ? 'rgba(255,255,255,.07)' : 'transparent' }}>
                                <div style={{ width: 24 * u, height: 24 * u, borderRadius: 7 * u, flex: 'none', background: on ? p.accent : 'transparent', border: `${2 * u}px solid ${on ? p.accent : dim}`, boxSizing: 'border-box', color: '#10140f',
                                    fontSize: 17 * u, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{on ? '✓' : ''}</div>
                                <div style={{ fontSize: 22 * u, fontWeight: 600, color: on ? '#fff' : dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it}</div>
                            </div>
                        );
                    })}
                </div>
                {/* timeline */}
                <div style={{ position: 'absolute', left: 22 * u, right: 22 * u, top: tlTop }}>
                    {[0, 1, 2].map(r => (
                        <div key={r} style={{ display: 'flex', gap: 4 * u, height: 40 * u, marginBottom: 6 * u }}>
                            {Array.from({ length: 7 }, (_, i) => <div key={i} style={{ flex: 0.6 + rand(r * 13 + i) * 2.6, borderRadius: 7 * u, background: CLIP[(i + r * 2) % 5], opacity: 0.5 + rand(r + i * 3) * 0.45 }} />)}
                        </div>
                    ))}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2.5 * u, height: 60 * u, background: 'rgba(140,207,142,.1)', borderRadius: 7 * u, padding: `0 ${6 * u}px`, overflow: 'hidden' }}>
                        {Array.from({ length: 150 }, (_, i) => <div key={i} style={{ flex: 1, height: `${12 + Math.abs(Math.sin(i * 0.37) * Math.sin(i * 0.11)) * 80 * (0.5 + rand(i) * 0.5)}%`, background: p.accent, borderRadius: 2 * u, opacity: 0.8 }} />)}
                    </div>
                    <div style={{ position: 'absolute', top: -8 * u, bottom: -8 * u, left: `${6 + play * 80}%`, width: 3 * u, background: '#ff5f57' }}>
                        <div style={{ position: 'absolute', left: -7 * u, top: -4 * u, width: 17 * u, height: 14 * u, background: '#ff5f57', borderRadius: `${3 * u}px ${3 * u}px ${8 * u}px ${8 * u}px` }} />
                    </div>
                </div>
            </div>
        </Full>
    );
};
