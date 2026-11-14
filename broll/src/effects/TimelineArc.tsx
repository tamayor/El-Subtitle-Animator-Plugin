// Timeline arc: an arc is drawn left to right through its points ("2024 | Started"), each point pops with its year
// and note, and a photo card can sit over a point. The current point is filled with the accent.
import React from 'react';
import { Img, interpolate, spring } from 'remotion';
import { Common, Place, clamp, ease, useInOut, wordTimes } from '../lib/common';
import { PhotoHole } from '../lib/paper';
import { useVibe } from '../lib/vibe';

type P = Common & { points: string[]; active: number; photo1: string; photo2: string; photo3: string; photoHolders: boolean; bend: number; dark: boolean };

export const TimelineArc: React.FC<P> = (p) => {
    const points = (Array.isArray(p.points) && p.points.length ? p.points : ['2024', '2025', '2026']).map(String).slice(0, 6);
    const n = points.length;
    const L = useVibe(p);
    const { frame: f0, real, fps, durationInFrames: D, inn } = useInOut(p, (D0) => Math.round(Math.min(D0 * 0.65, 14 + n * 9)));
    const drawEnd = Math.max(12, Math.round(Math.min(D * 0.6, 10 + n * 9)));
    const times = wordTimes(p, n);   // Land on word: the arc reaches each point as its year is spoken
    const frame = times ? real : f0;
    const W = 820, bend = 150 * clamp(Number(p.bend) || 1, 0, 2), PAD = 60;
    const act = Math.max(0, Math.min(n, Math.round(Number(p.active) || n)));   // 0 = none
    const photos = [p.photo1, p.photo2, p.photo3].map((s) => String(s || ''));
    const anyPhoto = photos.some(Boolean) || !!p.photoHolders;
    const PH = anyPhoto ? 200 : 0, top = PH + 96;
    // a quadratic arc from the left end to the right end, highest in the middle
    const pt = (t: number) => ({ x: PAD + (W - PAD * 2) * t, y: top + bend - 4 * bend * t * (1 - t) });
    const tOf = (i: number) => (n === 1 ? 0.5 : i / (n - 1));
    const at = (i: number) => (times ? times[i] : 4 + (drawEnd - 4) * tOf(i));
    // how far the line has been drawn (0..1 along t)
    const head = times
        ? (() => { let h = 0; for (let i = 0; i < n; i++) { const a = at(i), b = i + 1 < n ? at(i + 1) : a + 1; if (frame >= a) h = tOf(i) + (i + 1 < n ? (tOf(i + 1) - tOf(i)) * clamp((frame - a) / Math.max(1, b - a)) : 0); } return h; })()
        : interpolate(frame, [4, drawEnd], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
    const a = pt(0), b = pt(1), ctrl = { x: W / 2, y: top + bend - 2 * bend };
    const H = top + bend + 110;

    return (
        <Place p={p}>
            <div style={{ position: 'relative', width: W, height: H, opacity: clamp(inn * 1.6) }}>
                <svg width={W} height={H} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
                    <path d={`M ${a.x} ${a.y} Q ${ctrl.x} ${ctrl.y} ${b.x} ${b.y}`} fill="none" stroke={L.bare.color} strokeOpacity={0.28} strokeWidth={5}
                        strokeLinecap="round" strokeDasharray="1 14" />
                    <path d={`M ${a.x} ${a.y} Q ${ctrl.x} ${ctrl.y} ${b.x} ${b.y}`} fill="none" stroke={L.bare.color} strokeWidth={6} strokeLinecap="round"
                        pathLength={1} strokeDasharray={1} strokeDashoffset={1 - clamp(head)} style={{ filter: 'drop-shadow(0 3px 10px rgba(0,0,0,.35))' }} />
                </svg>
                {points.map((raw, i) => {
                    const [year, note] = raw.split('|').map((s) => s.trim());
                    const k = frame < at(i) ? 0 : spring({ frame: frame - at(i), fps, config: L.spring });
                    if (k <= 0) return null;
                    const q = pt(tOf(i)), on = i + 1 === act, src = photos[i] || '';
                    return (
                        <div key={i} style={{ position: 'absolute', left: q.x, top: q.y, width: 0, height: 0 }}>
                            <div style={{ position: 'absolute', left: -17, top: -17, width: 34, height: 34, borderRadius: L.r(34), boxSizing: 'border-box',
                                background: on ? L.accent : L.bare.color, border: `5px solid ${L.bare.color}`, boxShadow: '0 4px 14px rgba(0,0,0,.35)',
                                transform: `scale(${k * (on ? 1.25 : 1)})` }} />
                            <div style={{ position: 'absolute', left: -150, width: 300, top: 30, textAlign: 'center', ...L.enter(k, 'down') }}>
                                <span style={{ ...L.card(18), display: 'inline-block', padding: note ? '8px 18px 9px' : '6px 18px',
                                    ...(on ? { background: L.accent, borderColor: L.v.hardShadow ? L.border : L.accent } : null) }}>
                                    <div style={{ ...L.text.num(34, { color: on ? L.onAccent : L.ink, lineHeight: 1.1 }) }}>{year}</div>
                                    {note && <div style={{ ...L.text.label(19, { color: on ? L.onAccent : L.dim, textTransform: 'none', letterSpacing: 0 }), marginTop: 3, whiteSpace: 'nowrap' }}>{note}</div>}
                                </span>
                            </div>
                            {(src || p.photoHolders) && i < 3 && (
                                <div style={{ ...L.card(18), position: 'absolute', left: -92, top: -(PH + 44), width: 184, height: PH, padding: 8, overflow: 'hidden',
                                    opacity: clamp(k * 1.6), transform: `translateY(${(1 - k) * 26}px) rotate(${(i - 1) * 4 * k}deg) scale(${0.7 + 0.3 * k})` }}>
                                    <div style={{ width: '100%', height: '100%', borderRadius: L.r(11), overflow: 'hidden' }}>
                                        {src ? <Img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <PhotoHole label="" />}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </Place>
    );
};
