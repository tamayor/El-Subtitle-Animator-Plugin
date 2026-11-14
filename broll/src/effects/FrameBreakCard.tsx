// Frame break: the video shrinks into a social post card (username, Follow, heart / comment / share, caption) on a
// dark backdrop with flying debris, and the speaker's head breaks out over the card's top edge. Reads every frame of
// the footage (props._seq): the full frames for the picture in the card, the cut-out for the head over the edge.
import React from 'react';
import { useVideoConfig } from 'remotion';
import { Common, FONT, Full, clamp, ease, prog, rand, useInOut, useUnit } from '../lib/common';
import { Footage, Speaker, seqOf, speakerBox } from '../lib/footage';

type P = Common & { _seq?: unknown; username: string; caption: string; likes: string; follow: boolean; size: number; poke: number; backdrop: string; debris: number; dark: boolean };

export const FrameBreakCard: React.FC<P> = (p) => {
    const { frame, real, raw, durationInFrames: D } = useInOut(p, (D0) => Math.max(10, Math.round(D0 * 0.4)));
    const { width: W, height: H } = useVideoConfig();
    const u = useUnit();
    const seq = seqOf(p), b = speakerBox(seq);
    const end = Math.max(10, Math.round(D * 0.4));
    const k = ease(prog(frame, 0, end));
    const sEnd = clamp(Number(p.size) || 0.62, 0.3, 0.95), s = 1 + (sEnd - 1) * k;
    // the scaled frame, centred on (x, y); the card's picture starts `poke` under the top of the head
    const fw = W * s, fh = H * s, ox = clamp(p.x ?? 0.5) * W - fw / 2 + (0.5 - b.cx) * fw * k * 0.6, oy = clamp(p.y ?? 0.46) * H - fh / 2;
    const cut = clamp(b.top + clamp(Number(p.poke) || 0.1, 0, 0.3), 0, 0.9) * k;       // share of the frame hidden above the card's edge
    const top = oy + cut * fh, ph = fh * (1 - cut), foot = 168 * u * k, r = 28 * u * k;
    const bg = p.dark ? '#16181c' : '#ffffff', fg = p.dark ? '#f4f5f7' : '#14161a', dim = p.dark ? 'rgba(255,255,255,.6)' : 'rgba(0,0,0,.55)';
    const nDeb = Math.max(0, Math.min(40, Math.round(Number(p.debris) || 14)));
    const inPic: React.CSSProperties = { position: 'absolute', left: 0, top: -cut * fh, width: fw, height: fh };
    return (
        <Full p={p}>
            <div style={{ position: 'absolute', inset: 0, background: p.backdrop || '#101114', opacity: clamp(k * 1.6) }} />
            {Array.from({ length: nDeb }, (_, i) => {
                const a = rand(i * 3.3) * Math.PI * 2, d = (0.25 + rand(i * 1.9) * 0.6) * Math.max(W, H) * (0.3 + k * 0.7) + raw * (0.4 + rand(i) * 1.2) * u;
                const sz = (8 + rand(i * 5.1) * 26) * u;
                return <div key={i} style={{ position: 'absolute', left: W / 2 + Math.cos(a) * d, top: H / 2 + Math.sin(a) * d * 0.8, width: sz, height: sz * (0.4 + rand(i * 7.7)),
                    background: i % 3 ? 'rgba(255,255,255,.75)' : p.accent, transform: `rotate(${rand(i * 2.7) * 360 + raw * (rand(i * 4.1) - 0.5) * 9}deg)`, opacity: clamp(k * 2) * 0.9, borderRadius: 2 * u }} />;
            })}
            {/* the card: its body, then the picture, then the speaker again, free to rise over the top edge */}
            <div style={{ position: 'absolute', left: ox - 14 * u * k, top: top - 14 * u * k, width: fw + 28 * u * k, height: ph + foot + 14 * u * k, background: bg, borderRadius: r + 10 * u * k,
                boxShadow: `0 ${30 * u}px ${70 * u}px rgba(0,0,0,.55)`, opacity: clamp(k * 3) }} />
            <div style={{ position: 'absolute', left: ox, top, width: fw, height: ph, overflow: 'hidden', borderRadius: r }}>
                <div style={inPic}><Footage seq={seq} real={real} /></div>
            </div>
            <div style={{ position: 'absolute', left: ox, top, width: fw, height: ph, clipPath: `inset(${-H}px 0px 0px 0px round 0 0 ${r}px ${r}px)` }}>
                <div style={inPic}><Speaker seq={seq} real={real} /></div>
            </div>
            <div style={{ position: 'absolute', left: ox + 20 * u, top: top + 18 * u, display: 'flex', alignItems: 'center', gap: 12 * u, opacity: prog(frame, end - 4, end + 4), fontFamily: FONT.sans }}>
                <div style={{ width: 54 * u, height: 54 * u, borderRadius: 54 * u, background: p.accent, border: `${3 * u}px solid #fff`, boxSizing: 'border-box' }} />
                <div style={{ fontWeight: 700, fontSize: 28 * u, color: '#fff', textShadow: '0 2px 8px rgba(0,0,0,.6)' }}>{p.username}</div>
                {p.follow && <div style={{ padding: `${5 * u}px ${16 * u}px`, borderRadius: 10 * u, border: `${2 * u}px solid #fff`, color: '#fff', fontWeight: 700, fontSize: 22 * u }}>Follow</div>}
            </div>
            <div style={{ position: 'absolute', left: ox + 8 * u, top: top + ph + 12 * u, width: fw - 16 * u, opacity: prog(frame, end - 2, end + 6), fontFamily: FONT.sans, color: fg }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 22 * u, fontSize: 40 * u, lineHeight: 1 }}>
                    <span style={{ color: '#e0245e' }}>♥</span><span>💬</span><span>➤</span><span style={{ flex: 1 }} />
                    <span style={{ fontSize: 24 * u, fontWeight: 700, color: dim }}>{p.likes}</span>
                </div>
                <div style={{ marginTop: 12 * u, fontSize: 28 * u, lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><b>{p.username}</b> {p.caption}</div>
            </div>
        </Full>
    );
};
