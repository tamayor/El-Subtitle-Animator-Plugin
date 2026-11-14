// Paper pieces shared by the cutout / scrapbook effects: the torn white border (an SVG filter on anything with alpha),
// paper grain, halftone dots, masking tape, torn-edge clip paths and the drop shadows.
import React from 'react';
import { rand } from './common';

export const SHADOW = {
    soft: '0 10px 26px rgba(0,0,0,.28)',
    lift: '0 22px 48px rgba(0,0,0,.38)',
    flat: '0 3px 8px rgba(0,0,0,.3)'
};
export const PAPER = { white: '#f7f4ec', news: '#e9dfc4', kraft: '#c9a878', grid: '#f2f0e6', sticky: '#ffe45c' };

// An uneven thick paper border with a soft shadow around whatever has alpha: style={{ filter: `url(#${id})` }}.
export const TornFilter: React.FC<{ id: string; width?: number; color?: string; seed?: number; rough?: number; shadow?: boolean }> =
    ({ id, width = 16, color = '#fbfaf6', seed = 3, rough = 14, shadow = true }) => (
        <filter id={id} x="-25%" y="-25%" width="150%" height="150%" colorInterpolationFilters="sRGB">
            <feMorphology in="SourceAlpha" operator="dilate" radius={width} result="fat" />
            <feTurbulence type="fractalNoise" baseFrequency={0.035} numOctaves={3} seed={seed} result="noise" />
            <feDisplacementMap in="fat" in2="noise" scale={rough} xChannelSelector="R" yChannelSelector="G" result="torn" />
            <feFlood floodColor={color} result="col" />
            <feComposite in="col" in2="torn" operator="in" result="border" />
            {shadow && <feDropShadow in="border" dx={0} dy={10} stdDeviation={12} floodColor="#000" floodOpacity={0.38} result="sh" />}
            <feMerge>{shadow && <feMergeNode in="sh" />}<feMergeNode in="border" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
    );

// Fine paper grain over its parent (which must be position: relative and clip its corners itself).
export const Grain: React.FC<{ id: string; opacity?: number; seed?: number }> = ({ id, opacity = 0.16, seed = 2 }) => (
    <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, mixBlendMode: 'multiply', opacity, pointerEvents: 'none' }}>
        <filter id={id}><feTurbulence type="fractalNoise" baseFrequency={0.9} numOctaves={2} seed={seed} /><feColorMatrix type="saturate" values="0" /></filter>
        <rect width="100%" height="100%" filter={`url(#${id})`} />
    </svg>
);

// Newsprint halftone dots over its parent.
export const Halftone: React.FC<{ size?: number; opacity?: number; color?: string }> = ({ size = 7, opacity = 0.5, color = '#1a1712' }) => (
    <div style={{ position: 'absolute', inset: 0, opacity, mixBlendMode: 'multiply', pointerEvents: 'none',
        backgroundImage: `radial-gradient(${color} 32%, transparent 36%)`, backgroundSize: `${size}px ${size}px` }} />
);

// A strip of translucent masking tape, centred on (left, top) of its parent.
export const Tape: React.FC<{ left: number | string; top: number | string; width?: number; angle?: number; color?: string }> =
    ({ left, top, width = 130, angle = -6, color = 'rgba(255, 226, 120, .82)' }) => (
        <div style={{ position: 'absolute', left, top, width, height: 38, marginLeft: -width / 2, marginTop: -19, background: color,
            transform: `rotate(${angle}deg)`, boxShadow: '0 2px 5px rgba(0,0,0,.18)',
            clipPath: 'polygon(0 8%, 3% 0, 6% 10%, 9% 0, 100% 0, 97% 12%, 100% 24%, 97% 38%, 100% 52%, 97% 66%, 100% 80%, 97% 100%, 3% 100%, 0 88%, 3% 74%, 0 60%, 3% 46%, 0 32%, 3% 20%)' }} />
    );

// A CSS clip-path with torn edges (percent coordinates): top / bottom / sides are jagged where asked.
export function tornClip(seed = 1, o: { top?: boolean; bottom?: boolean; left?: boolean; right?: boolean; depth?: number; teeth?: number } = {}) {
    const { top = true, bottom = true, left = false, right = false, depth = 3, teeth = 22 } = o;
    const pts: string[] = [];
    const r = (i: number) => rand(seed * 3.3 + i * 1.7) * depth;
    for (let i = 0; i <= teeth; i++) pts.push(`${(i / teeth) * 100}% ${top ? r(i) : 0}%`);
    for (let i = 1; i < teeth; i++) pts.push(`${100 - (right ? r(i + 40) * 0.6 : 0)}% ${(i / teeth) * 100}%`);
    for (let i = teeth; i >= 0; i--) pts.push(`${(i / teeth) * 100}% ${100 - (bottom ? r(i + 80) : 0)}%`);
    for (let i = teeth - 1; i > 0; i--) pts.push(`${left ? r(i + 120) * 0.6 : 0}% ${(i / teeth) * 100}%`);
    return `polygon(${pts.join(', ')})`;
}

// Grey "body text" lines for clippings and pages.
export const TextLines: React.FC<{ n: number; color?: string; gap?: number; h?: number; seed?: number }> = ({ n, color = 'rgba(40,34,24,.34)', gap = 9, h = 5, seed = 1 }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap }}>
        {Array.from({ length: n }, (_, i) => <div key={i} style={{ height: h, borderRadius: h, background: color, width: `${i === n - 1 ? 46 + rand(seed + i) * 30 : 88 + rand(seed + i) * 12}%` }} />)}
    </div>
);

// What an effect shows where a photo goes when none was chosen.
export const PhotoHole: React.FC<{ label?: string; style?: React.CSSProperties }> = ({ label = 'Photo', style }) => (
    <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg, #8fa7b8, #c9b79c 55%, #e3c9a4)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,.85)', fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: 30, ...style }}>{label}</div>
);
