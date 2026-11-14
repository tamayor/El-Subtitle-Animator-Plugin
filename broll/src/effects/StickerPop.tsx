// Sticker pop: an emoji / icon sticker with a white die-cut edge pops in with a bounce and a slight tilt, with an
// optional pill label under it.
import React from 'react';
import { spring } from 'remotion';
import { Common, FONT, Place, clamp, useInOut } from '../lib/common';
import { face, plainClassic, useVibe } from '../lib/vibe';

type P = Common & { icon: string; emoji: string; label: string; tilt: number; disc: boolean };

export const STICKERS: Record<string, string> = {
    lightbulb: '💡', dollar: '💰', warning: '⚠️', rocket: '🚀', fire: '🔥', check: '✅', clock: '⏰', brain: '🧠',
    heart: '❤️', star: '⭐', eyes: '👀', hundred: '💯', chart: '📈', target: '🎯', phone: '📱', camera: '🎥', trophy: '🏆', bell: '🔔'
};

export const StickerPop: React.FC<P> = (p) => {
    const { frame, fps, inn } = useInOut(p, () => 12);
    const pop = spring({ frame, fps, config: { damping: 9, stiffness: 190, mass: 0.7 } });
    const glyph = String(p.emoji || '').trim() || STICKERS[String(p.icon)] || '⭐';
    const tilt = Number(p.tilt) || 0;
    const wob = Math.sin(frame / 9) * 1.6 * clamp((frame - 12) / 10);
    const lab = spring({ frame: frame - 6, fps, config: { damping: 14, stiffness: 170 } });
    const L = useVibe(p), C = plainClassic(p, L);
    return (
        <Place p={p}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: clamp(inn * 3) }}>
                <div style={{ width: 300, height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 300,
                    background: p.disc ? p.accent : 'transparent', border: p.disc ? '14px solid #fff' : 'none',
                    boxShadow: p.disc ? '0 16px 36px rgba(0,0,0,.4)' : 'none',
                    transform: `scale(${pop}) rotate(${tilt * (2 - pop) + wob}deg)` }}>
                    <span style={{ fontSize: p.disc ? 170 : 250, lineHeight: 1, fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", sans-serif',
                        filter: p.disc ? 'none' : 'drop-shadow(0 0 0 #fff) drop-shadow(6px 0 0 #fff) drop-shadow(-6px 0 0 #fff) drop-shadow(0 6px 0 #fff) drop-shadow(0 -6px 0 #fff) drop-shadow(0 14px 18px rgba(0,0,0,.4))' }}>{glyph}</span>
                </div>
                {p.label && (
                    <div style={{ marginTop: p.disc ? 20 : 4, padding: '12px 30px', ...(C ? { borderRadius: 60, background: '#fff', color: '#14161a', boxShadow: '0 10px 26px rgba(0,0,0,.35)' } : { ...L.card(60), color: L.ink }),
                        ...face(L, 'display', { fontFamily: FONT.sans, fontWeight: 800 }, C, 44), transform: `scale(${lab}) rotate(${-tilt * 0.3}deg)`, whiteSpace: 'nowrap' }}>{p.label}</div>
                )}
            </div>
        </Place>
    );
};
