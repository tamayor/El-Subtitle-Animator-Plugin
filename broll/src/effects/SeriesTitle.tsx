// Series title: a show's official stamp ("BEFORE 2028") and, when the episode title is spoken, that title under it.
// Calm, investigative motion (eased, no bounce): an episode kicker with a ballot oval that gets shaded, the show word
// in tracked caps, the year rolling up digit by digit like a counter, a ruler drawing under it with year ticks; then
// the title builds word by word and its focus line gets a marker swipe. A soft scrim keeps it readable over footage.
import React from 'react';
import { interpolate } from 'remotion';
import { Common, FONT, Place, clamp, ease, useInOut } from '../lib/common';
import { readable, useVibe } from '../lib/vibe';

type P = Common & { show: string; episode: string; title: string; focus: string; titleAt: number; focusAt: number; mark: string; scrim: boolean };

const k = (f: number, a: number, b: number) => interpolate(f, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });

// One digit rolling from `from` up to `to` (a column of digits sliding up), landing at progress t = 1.
const RollDigit: React.FC<{ from: number; to: number; t: number; h: number }> = ({ from, to, t, h }) => {
    const steps = ((to - from) + 10) % 10;
    const pos = steps * t;
    const list = Array.from({ length: steps + 1 }, (_, i) => (from + i) % 10);
    return (
        <span style={{ display: 'inline-block', height: h, overflow: 'hidden', verticalAlign: 'top' }}>
            <span style={{ display: 'flex', flexDirection: 'column', transform: `translateY(${-pos * h}px)` }}>
                {list.map((d, i) => <span key={i} style={{ height: h, lineHeight: `${h}px` }}>{d}</span>)}
            </span>
        </span>
    );
};

export const SeriesTitle: React.FC<P> = (p) => {
    const { frame, fps, durationInFrames: D, inn } = useInOut(p, (D0) => Math.min(D0, 40));
    const L = useVibe(p);
    const show = String(p.show || 'Before 2028').trim();
    const m = show.match(/^(.*?)(\d{2,4})$/);
    const word = (m ? m[1] : show).trim().toUpperCase();
    const year = m ? m[2] : '';
    const mark = p.mark || '#c7385a';
    const accent = L.accent;

    // stamp: kicker 0-12, word 4-18, year rolls 8-34, ruler 14-40, oval shaded 30-40
    const kick = k(frame, 0, 12), wIn = k(frame, 4, 18), roll = k(frame, 8, 34), rule = k(frame, 14, 40), oval = k(frame, 30, 40);
    const yearFrom = year ? String(Number(year) - 3).padStart(year.length, '0') : '';

    // the title: starts at titleAt (s), word by word 5 frames apart; the focus line at focusAt (s) with a marker swipe
    const tAt = Math.max(0, Math.round((Number(p.titleAt) || D / fps * 0.45) * fps));
    const fAt = Math.max(tAt, Math.round((Number(p.focusAt) || 0) * fps) || tAt + 14);
    const words = String(p.title || '').split(/\s+/).filter(Boolean);
    const focus = String(p.focus || '').trim();
    const hasTitle = words.length > 0 || !!focus;
    const lift = hasTitle ? k(frame, tAt - 6, tAt + 10) : 0;          // the stamp eases up and a little smaller
    const swipe = k(frame, fAt + 4, fAt + 20);
    const H = 150;                                                      // year digit height (design px)

    return (
        <Place p={p}>
            <div style={{ position: 'relative', width: 880, display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: clamp(inn * 1.4) }}>
                {p.scrim !== false && (
                    <div style={{ position: 'absolute', left: -120, right: -120, top: -90, bottom: -90, borderRadius: 400,
                        background: 'radial-gradient(ellipse 60% 55% at 50% 50%, rgba(8,10,9,.62) 0%, rgba(8,10,9,.38) 55%, rgba(8,10,9,0) 100%)' }} />
                )}
                <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center',
                    transform: `translateY(${-lift * 26}px) scale(${1 - lift * 0.14})`, transformOrigin: 'center bottom' }}>
                    {/* kicker: episode + ballot oval */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, opacity: kick, transform: `translateY(${(1 - kick) * 10}px)`, marginBottom: 6 }}>
                        <svg width={46} height={26} viewBox="0 0 46 26">
                            <ellipse cx={23} cy={13} rx={20} ry={10} fill="none" stroke="#fff" strokeOpacity={0.85} strokeWidth={2.5} />
                            <clipPath id="st-oval"><ellipse cx={23} cy={13} rx={18} ry={8} /></clipPath>
                            <rect x={3} y={3} width={40 * oval} height={20} fill={mark} clipPath="url(#st-oval)" />
                        </svg>
                        {p.episode && <span style={{ fontFamily: FONT.mono, fontWeight: 700, fontSize: 26, letterSpacing: 6, color: '#fff', opacity: 0.88 }}>{String(p.episode).toUpperCase()}</span>}
                    </div>
                    {/* show word + rolling year */}
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 26, color: '#fff', textShadow: '0 4px 24px rgba(0,0,0,.45)' }}>
                        <span style={{ fontFamily: FONT.sans, fontWeight: 800, fontSize: 92, letterSpacing: 10 + (1 - wIn) * 18, opacity: wIn,
                            transform: `translateY(${(1 - wIn) * 16}px)`, display: 'inline-block' }}>{word}</span>
                        {year && (
                            <span style={{ fontFamily: FONT.serif, fontSize: H * 1.02, lineHeight: `${H}px`, height: H, display: 'inline-flex', color: '#fff', opacity: clamp(roll * 3) }}>
                                {year.split('').map((d, i) => (
                                    <RollDigit key={i} from={Number(yearFrom[i])} to={Number(d)} h={H} t={k(frame, 8 + i * 3, 34)} />
                                ))}
                            </span>
                        )}
                    </div>
                    {/* ruler with year ticks, the last one in the accent */}
                    <svg width={760} height={30} viewBox="0 0 760 30" style={{ marginTop: 4, overflow: 'visible' }}>
                        <line x1={0} y1={6} x2={760 * rule} y2={6} stroke="#fff" strokeOpacity={0.8} strokeWidth={3} strokeLinecap="round" />
                        {Array.from({ length: 13 }, (_, i) => {
                            const x = (i / 12) * 760, on = rule * 760 >= x;
                            const last = i === 12;
                            return on ? <line key={i} x1={x} y1={6} x2={x} y2={last ? 28 : i % 4 === 0 ? 20 : 14} stroke={last ? mark : '#fff'}
                                strokeOpacity={last ? 1 : 0.7} strokeWidth={last ? 5 : 2.5} strokeLinecap="round" /> : null;
                        })}
                    </svg>
                </div>
                {/* episode title */}
                {hasTitle && (
                    <div style={{ position: 'relative', marginTop: 10, maxWidth: 860, textAlign: 'center', color: '#fff',
                        fontFamily: FONT.serif, fontSize: 64, lineHeight: 1.12, textShadow: '0 3px 18px rgba(0,0,0,.5)' }}>
                        <div style={{ textWrap: 'balance' } as React.CSSProperties}>
                            {words.map((w, i) => {
                                const a = k(frame, tAt + i * 5, tAt + i * 5 + 10);
                                return <span key={i} style={{ display: 'inline-block', opacity: a, transform: `translateY(${(1 - a) * 18}px)`, marginRight: '0.26em' }}>{w}</span>;
                            })}
                        </div>
                        {focus && (() => {
                            const a = k(frame, fAt, fAt + 10);
                            return (
                                <div style={{ marginTop: 8, opacity: a, transform: `translateY(${(1 - a) * 18}px)` }}>
                                    <span style={{ position: 'relative', display: 'inline-block', padding: '2px 22px 8px' }}>
                                        <span style={{ position: 'absolute', inset: 0, background: accent, borderRadius: 10, transform: `skewX(-6deg) scaleX(${swipe})`, transformOrigin: 'left center' }} />
                                        <span style={{ position: 'relative', fontFamily: FONT.sans, fontWeight: 800, fontSize: 60, letterSpacing: 0.5, textShadow: 'none',
                                            color: swipe > 0.5 ? readable(accent) : '#fff' }}>{focus}</span>
                                    </span>
                                </div>
                            );
                        })()}
                    </div>
                )}
            </div>
        </Place>
    );
};
