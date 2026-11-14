// Paper frame: "polaroid" = a taped scrapbook polaroid with a handwritten caption; "newspaper" = a yellowed clipping
// with a halftone photo, serif headline and torn edges; "parallax" = three paper layers drifting at different
// speeds for a 2.5D depth shift.
import React from 'react';
import { Img, spring } from 'remotion';
import { Common, FONT, Place, clamp, useInOut } from '../lib/common';
import { Grain, Halftone, PAPER, PhotoHole, SHADOW, Tape, TextLines, tornClip } from '../lib/paper';

type P = Common & { mode: string; image: string; caption: string; headline: string; paper: string; rotation: number; drift: number };

const Photo: React.FC<{ src: string; style?: React.CSSProperties; gray?: boolean }> = ({ src, style, gray }) => (
    <div style={{ position: 'relative', overflow: 'hidden', background: '#222', ...style }}>
        {src ? <Img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', filter: gray ? 'grayscale(1) contrast(1.25)' : 'none' }} />
            : <PhotoHole style={gray ? { filter: 'grayscale(1) contrast(1.2)' } : undefined} />}
    </div>
);

export const PaperFrame: React.FC<P> = (p) => {
    const { frame, raw, fps, durationInFrames: D } = useInOut(p, () => 12);
    const s = spring({ frame, fps, config: { damping: 12, stiffness: 190, mass: 0.8 } });
    const rot = Number(p.rotation) || 0;
    const mode = String(p.mode || 'polaroid');
    const enter = { opacity: clamp(frame / 2), transform: `scale(${1.5 - s * 0.5}) rotate(${rot + (1 - s) * -12}deg)` };
    if (mode === 'newspaper') {
        return (
            <Place p={p}>
                <div style={{ ...enter, filter: `drop-shadow(${SHADOW.lift.replace(/^0 /, '0px ')})` }}>
                    <div style={{ position: 'relative', width: 640, padding: '34px 36px 40px', background: p.paper || PAPER.news, clipPath: tornClip(4, { left: true, right: true, depth: 2.4 }) }}>
                        <Grain id="pfn" opacity={0.3} />
                        <div style={{ position: 'relative' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '3px double #2a251c', paddingBottom: 6, marginBottom: 14, fontFamily: FONT.serif, fontSize: 20, color: '#2a251c', letterSpacing: 2, textTransform: 'uppercase' }}>
                                <span>{p.caption || 'The Daily'}</span><span>Vol. 12</span>
                            </div>
                            <div style={{ fontFamily: FONT.serif, fontSize: 68, lineHeight: 0.98, color: '#1d1912', marginBottom: 18, letterSpacing: -1 }}>{p.headline}</div>
                            <div style={{ display: 'flex', gap: 20 }}>
                                <div style={{ position: 'relative', flex: '0 0 300px', height: 230 }}>
                                    <Photo src={p.image} gray style={{ width: '100%', height: '100%' }} />
                                    <Halftone size={6} opacity={0.42} />
                                </div>
                                <div style={{ flex: 1, paddingTop: 4 }}><TextLines n={11} gap={11} h={6} seed={3} /></div>
                            </div>
                        </div>
                    </div>
                </div>
            </Place>
        );
    }
    if (mode === 'parallax') {
        // the camera drifts sideways through the clip: far layers move least
        const t = (raw / Math.max(1, D) - 0.5) * (Number(p.drift) || 60);
        const L = (depth: number, extra = ''): React.CSSProperties => ({ position: 'absolute', transform: `translate(${t * depth}px, ${t * depth * 0.25}px) ${extra}` });
        return (
            <Place p={p}>
                <div style={{ position: 'relative', width: 820, height: 620, opacity: clamp(frame / 3), transform: `scale(${0.9 + s * 0.1})` }}>
                    <div style={{ ...L(0.35, 'rotate(-3deg)'), left: 20, top: 30, width: 760, height: 540, filter: 'drop-shadow(0 14px 22px rgba(0,0,0,.35))' }}>
                        <div style={{ position: 'relative', width: '100%', height: '100%', background: p.paper || PAPER.kraft, clipPath: tornClip(7, { left: true, right: true }) }}><Grain id="pfa" opacity={0.3} /></div>
                    </div>
                    <div style={{ ...L(1, 'rotate(2deg)'), left: 120, top: 70, filter: 'drop-shadow(0 18px 26px rgba(0,0,0,.4))' }}>
                        <div style={{ position: 'relative', padding: 18, background: PAPER.white, clipPath: tornClip(2, { depth: 2 }) }}>
                            <Photo src={p.image} style={{ width: 540, height: 400 }} />
                            <Grain id="pfb" opacity={0.14} />
                        </div>
                    </div>
                    <div style={{ ...L(2.1, 'rotate(-7deg)'), left: -20, top: 430, filter: 'drop-shadow(0 22px 26px rgba(0,0,0,.45))' }}>
                        <div style={{ background: p.accent, padding: '14px 34px', fontFamily: FONT.sans, fontWeight: 800, fontSize: 50, color: '#10140f', clipPath: tornClip(9, { left: true, right: true, depth: 6, teeth: 14 }), whiteSpace: 'nowrap' }}>{p.headline || p.caption}</div>
                    </div>
                    <div style={{ ...L(2.6), left: 610, top: 10 }}><Tape left={60} top={30} width={150} angle={24} /></div>
                    <div style={{ ...L(1.6, 'rotate(8deg)'), left: 610, top: 420, width: 190, height: 170, background: PAPER.sticky, boxShadow: SHADOW.soft, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: FONT.hand, fontWeight: 700, fontSize: 46, color: '#3a3210', textAlign: 'center', lineHeight: 1 }}>{p.caption}</div>
                </div>
            </Place>
        );
    }
    return (
        <Place p={p}>
            <div style={{ ...enter, position: 'relative' }}>
                <div style={{ position: 'relative', background: PAPER.white, padding: '26px 26px 0', boxShadow: SHADOW.lift, borderRadius: 4 }}>
                    <Photo src={p.image} style={{ width: 500, height: 500 }} />
                    <div style={{ height: 118, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT.hand, fontWeight: 700, fontSize: 60, color: '#2b2a28', whiteSpace: 'nowrap' }}>{p.caption}</div>
                    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: 4 }}><Grain id="pfp" opacity={0.18} /></div>
                </div>
                <Tape left="50%" top={-4} width={190} angle={-4} color={p.accent + 'd0'} />
            </div>
        </Place>
    );
};
