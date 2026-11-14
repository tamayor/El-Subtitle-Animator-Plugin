// Doodle icon: a simple icon draws on in outline, then a colour wash or pencil hatching fills it in.
import React from 'react';
import { Common, FONT, Place, clamp, ease, prog, useInOut } from '../lib/common';
import { Hatch, ICONS, Wobble, boilSeed, draw } from '../lib/doodle';

type P = Common & { icon: string; fillMode: string; ink: string; label: string; boil: boolean };

export const DoodleIcon: React.FC<P> = (p) => {
    const { frame, raw, fps, durationInFrames: D } = useInOut(p, (D0, f) => Math.max(12, Math.min(Math.round(D0 * 0.6), Math.round(f * 1.1))));
    const end = Math.max(12, Math.min(Math.round(D * 0.6), Math.round(fps * 1.1)));
    const paths = ICONS[String(p.icon)] || ICONS.lightbulb;
    const outline = prog(frame, 1, end * 0.6), fill = ease(prog(frame, end * 0.6, end));
    const ink = p.ink || '#ffffff';
    const seed = p.boil ? 1 + (boilSeed(raw, 4) % 3) : 1;
    const mode = String(p.fillMode || 'wash');
    const S = 420;
    return (
        <Place p={p}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <svg width={S} height={S} viewBox="-8 -8 116 116" style={{ overflow: 'visible', filter: 'drop-shadow(0 6px 10px rgba(0,0,0,.4))' }}>
                    <defs>
                        <Wobble id="diw" seed={seed} amount={1.6} freq={0.09} />
                        <Hatch id="dih" color={p.accent} gap={5} width={2.2} />
                        {/* the fill sweeps in from the bottom-left */}
                        <clipPath id="dic"><rect x={-20} y={-20} width={140} height={140} transform={`translate(${-140 * (1 - fill)} ${140 * (1 - fill)})`} /></clipPath>
                    </defs>
                    <g filter="url(#diw)">
                        {mode !== 'none' && paths.filter(d => /Z\s*$/.test(d)).map((d, i) => (
                            <path key={'f' + i} d={d} fill={mode === 'hatch' ? 'url(#dih)' : p.accent} opacity={mode === 'hatch' ? 1 : 0.88} clipPath="url(#dic)" transform="translate(2.5 2.5)" />
                        ))}
                        {paths.map((d, i) => {
                            const a = i / paths.length, b = (i + 1) / paths.length;
                            return <path key={i} d={d} stroke={ink} strokeWidth={4.4} {...draw(clamp((outline - a * 0.7) / (b - a * 0.7)))} />;
                        })}
                    </g>
                </svg>
                {p.label && <div style={{ marginTop: 4, fontFamily: FONT.hand, fontWeight: 700, fontSize: 96, color: ink, textShadow: '0 3px 10px rgba(0,0,0,.55)', transform: 'rotate(-3deg)',
                    opacity: prog(frame, end * 0.5, end), whiteSpace: 'nowrap' }}>{p.label}</div>}
            </div>
        </Place>
    );
};
