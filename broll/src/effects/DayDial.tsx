// Day dial: a printed clock dial spins in, the word repeats round its rim between the hour numbers, a hand sweeps
// and the italic title is written beside it.
import React from 'react';
import { interpolate } from 'remotion';
import { Common, FONT, Place, typed, useInOut } from '../lib/common';

type P = Common & { word: string; title: string; hours: number; paper: string; ink: string };

export const DayDial: React.FC<P> = (p) => {
    const { frame, fps, durationInFrames: D, inn, out } = useInOut(p, (_D, f) => (p.enter ?? 10) + Math.ceil(String(p.title || '').length / 10 * f) + 2);
    const H = Math.max(4, Math.min(24, Math.round(p.hours || 12)));
    const R = 440;
    const spin = interpolate(inn, [0, 1], [-70, 0]) + frame * 0.25;
    const hand = interpolate(frame, [0, D], [-30, 300]);
    const title = typed(String(p.title || ''), frame, (p.enter ?? 10), fps, 10);
    const ink = p.ink || '#2a2620';

    return (
        <Place p={p}>
            <div style={{ position: 'relative', width: R * 2, height: R * 2, opacity: out, transform: `scale(${0.6 + 0.4 * inn})` }}>
                <svg width={R * 2} height={R * 2} viewBox={`${-R} ${-R} ${R * 2} ${R * 2}`} style={{ overflow: 'visible',
                    filter: 'drop-shadow(0 18px 40px rgba(0,0,0,.35))', opacity: Math.min(1, inn * 1.4) }}>
                    <circle r={R} fill={p.paper || '#efe8d8'} />
                    <circle r={R - 16} fill="none" stroke={ink} strokeWidth={2} />
                    <circle r={R - 120} fill="none" stroke={ink} strokeWidth={1} opacity={0.5} />
                    <g transform={`rotate(${spin})`}>
                        {Array.from({ length: H * 5 }).map((_, i) => {
                            const a = (i / (H * 5)) * 360, major = i % 5 === 0;
                            return <line key={'t' + i} x1={0} y1={-(R - 16)} x2={0} y2={-(R - (major ? 44 : 30))} stroke={ink}
                                strokeWidth={major ? 4 : 1.5} transform={`rotate(${a})`} />;
                        })}
                        {Array.from({ length: H }).map((_, i) => {
                            const a = ((i + 1) / H) * 360;
                            const mid = a - 180 / H;
                            return (
                                <g key={'h' + i}>
                                    <line x1={0} y1={-(R - 120)} x2={0} y2={-(R - 50)} stroke={ink} strokeWidth={1} opacity={0.5} transform={`rotate(${a})`} />
                                    <text transform={`rotate(${a}) translate(0 ${-(R - 92)}) rotate(${-a - spin})`} textAnchor="middle" dominantBaseline="central"
                                        fontFamily={FONT.serif} fontSize={64} fill={ink}>{i + 1}</text>
                                    <text transform={`rotate(${mid}) translate(0 ${-(R - 86)}) rotate(90)`} textAnchor="middle" dominantBaseline="central"
                                        fontFamily={FONT.serifItalic} fontStyle="italic" fontSize={44} fill={ink}>{p.word}</text>
                                </g>
                            );
                        })}
                    </g>
                    <line x1={0} y1={0} x2={0} y2={-(R - 60)} stroke={ink} strokeWidth={3} transform={`rotate(${hand})`} />
                    <line x1={0} y1={0} x2={0} y2={-(R - 200)} stroke={ink} strokeWidth={7} strokeLinecap="round" transform={`rotate(${hand / 12 + 40})`} />
                    <circle r={12} fill={p.accent} stroke={ink} strokeWidth={3} />
                </svg>
                {title && (
                    <div style={{ position: 'absolute', left: -60, top: -40, fontFamily: FONT.serifItalic, fontStyle: 'italic', fontSize: 150,
                        color: ink, transform: 'rotate(-12deg)', textShadow: `0 0 18px ${p.paper || '#efe8d8'}` }}>{title}</div>
                )}
            </div>
        </Place>
    );
};
