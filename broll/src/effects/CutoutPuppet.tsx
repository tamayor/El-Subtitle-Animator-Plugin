// Cutout puppet: a jointed paper cartoon figure (head, torso, arms) with a white cut edge. The mouth opens and the
// head and arms bob with the voice (props._samples when the audio was measured, else a seeded stand-in), or it
// holds a pose.
import React from 'react';
import { spring } from 'remotion';
import { Common, FONT, Place, clamp, envelope, useInOut } from '../lib/common';
import { face, plainClassic, useVibe } from '../lib/vibe';
import { TornFilter } from '../lib/paper';

type P = Common & { pose: string; skin: string; hair: string; speech: string; talk: boolean; _samples?: number[] };

export const CutoutPuppet: React.FC<P> = (p) => {
    const { frame, real: raw, fps } = useInOut(p, () => 12);   // _samples are clip frames
    const s = spring({ frame, fps, config: { damping: 11, stiffness: 170 } });
    const lv = p.talk ? (envelope(p, raw, fps, 2) + envelope(p, raw - 1, fps, 2)) / 2 : 0;
    const slow = Math.sin(raw / 11);
    const pose = String(p.pose || 'talk');
    const armL = pose === 'cheer' ? 150 - slow * 8 : pose === 'point' ? 12 : 18 + lv * -26;
    const armR = pose === 'cheer' ? -150 + slow * 8 : pose === 'point' ? -112 + slow * 4 : pose === 'wave' ? -140 + Math.sin(raw / 3.2) * 22 : -18 + lv * 34;
    const head = slow * 2.5 + lv * 5;
    const skin = p.skin || '#f2c9a0', hair = p.hair || '#3a2a20', shirt = p.accent;
    const bub = spring({ frame: frame - 8, fps, config: { damping: 12, stiffness: 180 } });
    // the puppet is paper (accent shirt only); the speech bubble takes the vibe's card and type
    const L = useVibe(p), C = plainClassic(p, L);
    const bubBg = C ? '#fff' : L.bg;
    return (
        <Place p={p}>
            <div style={{ position: 'relative', width: 520, height: 640, transform: `translateY(${(1 - s) * 500}px) rotate(${(1 - s) * 10}deg)` }}>
                <svg width={520} height={640} viewBox="0 0 520 640" style={{ overflow: 'visible' }}>
                    <defs><TornFilter id="cup" width={9} rough={7} /></defs>
                    <g filter="url(#cup)">
                        <g transform={`rotate(${armL} 180 330)`}><rect x={158} y={318} width={46} height={190} rx={23} fill={shirt} /><circle cx={181} cy={520} r={28} fill={skin} /></g>
                        <g transform={`rotate(${armR} 340 330)`}><rect x={316} y={318} width={46} height={190} rx={23} fill={shirt} /><circle cx={339} cy={520} r={28} fill={skin} /></g>
                        <path d="M170 320 C170 290 350 290 350 320 L372 640 L148 640 Z" fill={shirt} />
                        <path d="M228 300 L260 352 L292 300 Z" fill="#fff" opacity={0.9} />
                        <rect x={238} y={258} width={44} height={56} fill={skin} />
                        <g transform={`rotate(${head} 260 290)`}>
                            <ellipse cx={260} cy={170} rx={112} ry={126} fill={skin} />
                            <path d="M146 160 C136 60 220 24 270 34 C340 30 392 84 374 170 C356 120 300 96 250 100 C200 102 168 122 146 160 Z" fill={hair} />
                            <ellipse cx={220} cy={166} rx={11} ry={frame % 70 < 3 ? 2 : 14} fill="#22201e" />
                            <ellipse cx={300} cy={166} rx={11} ry={frame % 70 < 3 ? 2 : 14} fill="#22201e" />
                            <path d="M200 136 Q220 124 240 134 M280 134 Q300 124 320 136" stroke={hair} strokeWidth={7} fill="none" strokeLinecap="round" />
                            {/* the jaw is a separate piece: it drops as the mouth opens */}
                            <ellipse cx={260} cy={232 + lv * 8} rx={38 - lv * 6} ry={5 + lv * 26} fill="#7a2230" />
                            {lv > 0.25 && <ellipse cx={260} cy={244 + lv * 14} rx={20} ry={lv * 10} fill="#e0707f" />}
                            {!p.talk && <path d="M226 228 Q260 258 294 228" stroke="#7a2230" strokeWidth={8} fill="none" strokeLinecap="round" />}
                        </g>
                    </g>
                </svg>
                {p.speech && (
                    <div style={{ position: 'absolute', left: 360, top: 20, transform: `scale(${bub}) rotate(4deg)`, transformOrigin: 'left bottom', padding: '16px 28px',
                        ...(C ? { background: '#fff', borderRadius: 34, boxShadow: '0 10px 24px rgba(0,0,0,.35)' } : { ...L.card(34), border: 'none' }),
                        ...face(L, 'display', { fontFamily: FONT.sans, fontWeight: 800 }, C, 46), color: C ? '#14161a' : L.ink, whiteSpace: 'nowrap' }}>
                        {p.speech}
                        <div style={{ position: 'absolute', left: 20, bottom: -18, width: 0, height: 0, borderLeft: '10px solid transparent', borderRight: '26px solid transparent', borderTop: `24px solid ${bubBg}` }} />
                    </div>
                )}
            </div>
        </Place>
    );
};
