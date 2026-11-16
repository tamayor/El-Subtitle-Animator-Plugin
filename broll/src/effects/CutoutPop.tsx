// Cutout pop: a photo (best: a PNG with the background removed) slaps into the frame with a slight rotation and a
// bounce, as if tossed onto a table. With the torn border it gets an uneven white paper edge and a soft shadow.
import React from 'react';
import { Img, spring } from 'remotion';
import { Common, FONT, Place, clamp, useInOut } from '../lib/common';
import { face, plainClassic, useVibe } from '../lib/vibe';
import { PhotoHole, TornFilter } from '../lib/paper';

type P = Common & { source?: string; removeBg?: boolean; _image?: string; image: string; tornBorder: boolean; border: number; rotation: number; width: number; label: string; bubble?: string; bubbleAt?: number };

export const CutoutPop: React.FC<P> = (p) => {
    const { frame, fps } = useInOut(p, () => 10);
    const s = spring({ frame, fps, config: { damping: 11, stiffness: 210, mass: 0.8 } });
    const rot = Number(p.rotation) || 0, w = Math.max(120, Number(p.width) || 520);
    const lab = spring({ frame: frame - 7, fps, config: { damping: 12, stiffness: 200 } });
    const L = useVibe(p), C = plainClassic(p, L);
    return (
        <Place p={p}>
            <svg width={0} height={0} style={{ position: 'absolute' }}><defs><TornFilter id="cpt" width={Math.max(2, Number(p.border) || 16)} /></defs></svg>
            <div style={{ position: 'relative', opacity: clamp(frame / 2), transform: `scale(${1.7 - s * 0.7}) rotate(${rot + (1 - s) * 14}deg)` }}>
                <div style={{ width: w, filter: p.tornBorder ? 'url(#cpt)' : 'drop-shadow(0 16px 26px rgba(0,0,0,.45))' }}>
                    {(p._image || (p.source !== 'speaker' && p.image))
                        ? <Img src={p._image || p.image} style={{ display: 'block', width: '100%', height: 'auto' }} />
                        : <div style={{ width: w, height: w * 1.15, clipPath: 'ellipse(42% 48% at 50% 52%)' }}><PhotoHole label={p.source === 'speaker' ? 'The speaker' : 'Choose a photo'} /></div>}
                </div>
                {p.label && <div style={{ position: 'absolute', left: '50%', bottom: -34, transform: `translateX(-50%) rotate(${-rot - 3}deg) scale(${lab})`, background: p.accent, color: C ? '#10140f' : L.onAccent,
                    padding: '8px 26px', ...face(L, 'display', { fontFamily: FONT.sans, fontWeight: 800 }, C, 44), whiteSpace: 'nowrap', boxShadow: '0 8px 18px rgba(0,0,0,.35)' }}>{p.label}</div>}
                {/* speech bubble (Before 2028 Ep. 10): cream paper, ink outline, a flat accent block out of register, the
                    tail pointing back at the cut-out's face; pops in at bubbleAt (frames from the clip start) */}
                {p.bubble && frame >= (Number(p.bubbleAt) || 0) && (() => {
                    const b = spring({ frame: frame - (Number(p.bubbleAt) || 0), fps, config: { damping: 12, stiffness: 220, mass: 0.7 } });
                    const wob = Math.sin(Math.floor(frame / 4) * 1.7) * 0.6;
                    return (
                        <div style={{ position: 'absolute', left: w * 0.74, top: w * 0.03, width: w * 0.78, transformOrigin: '0% 100%',
                            transform: `rotate(${-rot + 2 + wob}deg) scale(${0.4 + 0.6 * b})`, opacity: clamp(b * 2) }}>
                            <svg width={w * 0.78} height={w * 0.12} style={{ position: 'absolute', left: 0, bottom: -w * 0.1, overflow: 'visible' }}>
                                <polygon points={`${w * 0.12},0 ${w * 0.26},0 ${-w * 0.04},${w * 0.12}`} fill={p.accent} transform="translate(9 8)" />
                                <polygon points={`${w * 0.12},-4 ${w * 0.26},-4 ${-w * 0.04},${w * 0.12}`} fill="#fbfaf6" stroke="#1c2738" strokeWidth={4} strokeLinejoin="round" />
                            </svg>
                            <div style={{ position: 'relative', background: '#fbfaf6', border: '4px solid #1c2738', borderRadius: 26, padding: '18px 24px',
                                boxShadow: `10px 9px 0 ${p.accent}`, color: '#1c2738', textAlign: 'center',
                                ...face(L, 'quote', { fontFamily: FONT.garamondItalic, fontWeight: 600 }, C, 44), lineHeight: 1.12 }}>{p.bubble}</div>
                        </div>
                    );
                })()}
            </div>
        </Place>
    );
};
