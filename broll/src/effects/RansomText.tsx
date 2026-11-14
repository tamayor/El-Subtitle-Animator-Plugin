// Ransom text: every letter (or word) is its own cut-out: a random font, angle and paper swatch, as if snipped from
// different magazines, slapped down one after another.
import React from 'react';
import { spring } from 'remotion';
import { loadFont as loadAnton } from '@remotion/google-fonts/Anton';
import { loadFont as loadPlayfair } from '@remotion/google-fonts/PlayfairDisplay';
import { loadFont as loadElite } from '@remotion/google-fonts/SpecialElite';
import { loadFont as loadMarker } from '@remotion/google-fonts/PermanentMarker';
import { Common, FONT, Place, clamp, rand, useInOut, wordTimes } from '../lib/common';

const FONTS = [
    { f: loadAnton('normal', { weights: ['400'], subsets: ['latin'] }).fontFamily, w: 400 },
    { f: loadPlayfair('normal', { weights: ['900'], subsets: ['latin'] }).fontFamily, w: 900 },
    { f: loadElite('normal', { weights: ['400'], subsets: ['latin'] }).fontFamily, w: 400 },
    { f: loadMarker('normal', { weights: ['400'], subsets: ['latin'] }).fontFamily, w: 400 },
    { f: FONT.sans, w: 800 }, { f: FONT.serif, w: 400 }, { f: FONT.mono, w: 700 }
];
const SWATCH: [string, string][] = [['#f7f4ec', '#14161a'], ['#14161a', '#f7f4ec'], ['#e8402f', '#fff'], ['#ffd84a', '#14161a'], ['#e9dfc4', '#2a251c'],
    ['#2f6fe0', '#fff'], ['#f5a8c4', '#14161a'], ['#ffffff', '#c8201c']];

type P = Common & { text: string; byWord: boolean; size: number; seed: number; useAccent: boolean };

export const RansomText: React.FC<P> = (p) => {
    const text = String(p.text || '');
    const words = text.split(/\s+/).filter(Boolean);
    const pieces = words.reduce((n, w) => n + (p.byWord ? 1 : w.length), 0);
    const { frame, real, fps, durationInFrames: D } = useInOut(p, (D0) => Math.min(Math.round(D0 * 0.6), 4 + pieces * 2) + 6);
    const build = Math.min(Math.round(D * 0.6), 4 + pieces * 2);
    const times = wordTimes(p, words.length);
    const size = Math.max(40, Number(p.size) || 120), seed = Number(p.seed) || 1;
    let n = 0;
    const piece = (label: string, key: string, at: number, clock: number) => {
        const i = n++, r = (k: number) => rand(seed * 11.3 + i * 5.7 + k);
        const font = FONTS[Math.floor(r(1) * FONTS.length)];
        const sw = p.useAccent && r(6) < 0.22 ? [p.accent, '#14161a'] : SWATCH[Math.floor(r(2) * SWATCH.length)];
        const s = spring({ frame: clock - at, fps, config: { damping: 11, stiffness: 240, mass: 0.6 } });
        return (
            <span key={key} style={{ display: 'inline-block', fontFamily: font.f, fontWeight: font.w, fontSize: size * (0.82 + r(3) * 0.36), lineHeight: 1, color: sw[1], background: sw[0],
                padding: `${size * 0.07}px ${size * (p.byWord ? 0.16 : 0.12)}px ${size * 0.04}px`, margin: `0 ${size * 0.025}px`, textTransform: r(4) < 0.7 ? 'uppercase' : 'none',
                transform: `translateY(${(r(7) - 0.5) * size * 0.16}px) rotate(${(r(5) - 0.5) * 16 + (1 - s) * 30}deg) scale(${s > 0 ? 1.8 - s * 0.8 : 0})`,
                boxShadow: '0 5px 10px rgba(0,0,0,.4)', opacity: clamp(s * 4), clipPath: `polygon(${r(8) * 4}% ${r(9) * 5}%, ${100 - r(10) * 4}% ${r(11) * 4}%, ${100 - r(12) * 3}% ${100 - r(13) * 5}%, ${r(14) * 4}% ${100 - r(15) * 4}%)` }}>{label}</span>
        );
    };
    let done = 0;
    return (
        <Place p={p}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: `${size * 0.18}px ${size * 0.3}px`, maxWidth: 1500, width: 'max-content' }}>
                {words.map((w, wi) => {
                    if (p.byWord) { const at = times ? times[wi] : 2 + (done++ / Math.max(1, pieces)) * build; return piece(w, 'w' + wi, at, times ? real : frame); }
                    return (
                        <span key={wi} style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
                            {[...w].map((ch, ci) => { const at = times ? times[wi] + ci * 1.5 : 2 + (done++ / Math.max(1, pieces)) * build; return piece(ch, wi + '-' + ci, at, times ? real : frame); })}
                        </span>
                    );
                })}
            </div>
        </Place>
    );
};
