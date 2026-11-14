// Phone mockup: a phone floats in beside the speaker with a web page inside; the page scrolls fast (with motion
// blur) and settles on a readable screen. A screenshot can be used as the page.
import React from 'react';
import { Img, spring } from 'remotion';
import { Common, FONT, Place, clamp, ease, prog, useInOut } from '../lib/common';
import { TextLines } from '../lib/paper';

type P = Common & { url: string; title: string; lines: string[]; image: string; tilt: number; dark: boolean };

export const PhoneMockup: React.FC<P> = (p) => {
    const { frame, raw, fps, durationInFrames: D } = useInOut(p, (D0) => Math.max(14, Math.round(D0 * 0.5)));
    const end = Math.max(14, Math.round(D * 0.5));
    const s = spring({ frame, fps, config: { damping: 14, stiffness: 150 } });
    const sc = ease(prog(frame, 5, end));
    const scrollLen = 1500, y = -scrollLen * (1 - sc);
    const speed = Math.abs(ease(prog(frame + 1, 5, end)) - sc) * scrollLen;
    const float = Math.sin(raw / 16) * 6;
    const bg = p.dark ? '#111317' : '#ffffff', fg = p.dark ? '#f4f5f7' : '#14161a', dim = p.dark ? 'rgba(255,255,255,.2)' : 'rgba(0,0,0,.14)';
    const lines = (p.lines || []).map(String).filter(Boolean).slice(0, 4);
    const W = 420, Hh = 860;
    return (
        <Place p={p}>
            <div style={{ width: W, height: Hh, borderRadius: 64, background: '#0b0c0e', padding: 14, boxSizing: 'border-box', boxShadow: '0 40px 80px rgba(0,0,0,.5), inset 0 0 0 3px #3a3d44',
                opacity: clamp(s * 2), transform: `translateY(${(1 - s) * 260 + float}px) rotate(${(Number(p.tilt) || 0) + (1 - s) * 10}deg)` }}>
                <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: 50, overflow: 'hidden', background: bg, fontFamily: FONT.sans }}>
                    <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 108, background: bg, zIndex: 2, borderBottom: `1px solid ${dim}` }}>
                        <div style={{ position: 'absolute', left: '50%', top: 12, width: 110, height: 30, marginLeft: -55, borderRadius: 30, background: '#0b0c0e' }} />
                        <div style={{ position: 'absolute', left: 22, right: 22, top: 56, height: 40, borderRadius: 40, background: dim, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 20, fontWeight: 600, color: fg, whiteSpace: 'nowrap', overflow: 'hidden' }}>🔒 {p.url}</div>
                    </div>
                    <div style={{ position: 'absolute', left: 0, right: 0, top: 108, transform: `translateY(${y}px)`, filter: `blur(${Math.min(14, speed * 0.12)}px)` }}>
                        {/* what scrolls past */}
                        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: scrollLen, transform: `translateY(${scrollLen}px)` }}>
                            {Array.from({ length: 5 }, (_, i) => (
                                <div key={i} style={{ padding: '22px 24px' }}>
                                    <div style={{ height: 170, borderRadius: 18, background: `linear-gradient(135deg, ${p.accent}${i % 2 ? '55' : 'aa'}, ${dim})`, marginBottom: 16 }} />
                                    <TextLines n={3} color={dim} gap={12} h={10} seed={i} />
                                </div>
                            ))}
                        </div>
                        {/* the screen it settles on */}
                        {p.image ? <Img src={p.image} style={{ width: '100%', height: Hh - 28 - 108, objectFit: 'cover', objectPosition: 'top center', display: 'block' }} /> : (
                            <div style={{ padding: '26px 26px' }}>
                                <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 2, color: p.accent, textTransform: 'uppercase', filter: 'brightness(.8)', marginBottom: 10 }}>Article</div>
                                <div style={{ fontWeight: 800, fontSize: 44, lineHeight: 1.06, color: fg, letterSpacing: -1, marginBottom: 20 }}>{p.title}</div>
                                <div style={{ height: 210, borderRadius: 20, background: `linear-gradient(135deg, ${p.accent}, ${p.dark ? '#2a2d34' : '#e9e6dc'})`, marginBottom: 22 }} />
                                {lines.map((l, i) => <div key={i} style={{ fontSize: 25, lineHeight: 1.3, color: fg, opacity: 0.85, marginBottom: 14 }}>{l}</div>)}
                                <TextLines n={5} color={dim} gap={13} h={10} seed={9} />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </Place>
    );
};
