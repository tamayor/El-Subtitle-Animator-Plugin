// Shared pieces for every B-roll effect: the common props (x, y, scale, accent, enter, exit), the placing wrapper,
// the in / out envelope and the fonts. Effects are drawn at a 1080-px design size and scaled to the timeline.
import React from 'react';
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadCaveat } from '@remotion/google-fonts/Caveat';
import { loadFont as loadSerif } from '@remotion/google-fonts/InstrumentSerif';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';

export const FONT = {
    sans: loadInter('normal', { weights: ['400', '500', '600', '700', '800'], subsets: ['latin'] }).fontFamily,
    hand: loadCaveat('normal', { weights: ['400', '700'], subsets: ['latin'] }).fontFamily,
    serif: loadSerif('normal', { subsets: ['latin'] }).fontFamily,
    serifItalic: loadSerif('italic', { subsets: ['latin'] }).fontFamily,
    mono: loadMono('normal', { weights: ['400', '700'], subsets: ['latin'] }).fontFamily
};

export type Common = {
    x: number; y: number; scale: number; accent: string; enter: number; exit: number;
    settle?: number;   // frame (from the clip start) where the build has fully landed; 0 = the effect's own pace
    // set by the renderer from the timeline
    _w?: number; _h?: number; _fps?: number; _frames?: number;
};

export const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const ease = Easing.bezier(0.22, 1, 0.36, 1);

// The in / out envelope and the effect's clock.
// `buildEnd(D, fps)` is the frame where the effect's build has landed at its own pace (the comment posted, the number
// counted, the word drawn). With props.settle > 0 the clock is warped so that moment falls exactly on frame `settle`
// (Sync to words puts it on the spoken word): the build is sped up or slowed down, everything after it runs at normal
// speed. `frame` is that warped clock; `raw` is the real frame. The exit fade always uses real frames.
export function useInOut(p: Common, buildEnd?: (D: number, fps: number) => number) {
    const raw = useCurrentFrame();
    const { fps, durationInFrames } = useVideoConfig();
    const enter = Math.max(0, p.enter ?? 10), exit = Math.max(0, p.exit ?? 8);
    const b0 = buildEnd ? Math.max(1, buildEnd(durationInFrames, fps)) : 0;
    const settle = Math.max(0, Number(p.settle) || 0);
    const frame = settle > 0 && b0 > 0 ? (raw <= settle ? raw * b0 / settle : b0 + (raw - settle)) : raw;
    const inn = enter <= 0 ? 1 : spring({ frame, fps, durationInFrames: Math.max(1, Math.round(enter)), config: { damping: 16, stiffness: 160 } });
    const out = exit <= 0 ? 1 : interpolate(raw, [durationInFrames - exit, durationInFrames], [1, 0],
        { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic) });
    return { frame, raw, fps, durationInFrames, inn, out, enter, exit };
}

// The design unit: 1 = one pixel of a 1080-px-short-side frame.
export function useUnit() {
    const { width, height } = useVideoConfig();
    return Math.min(width, height) / 1080;
}

// Puts its children with their centre at (x, y) of the frame, scaled by the design unit × scale.
export const Place: React.FC<{ p: Common; children: React.ReactNode; style?: React.CSSProperties }> = ({ p, children, style }) => {
    const { width, height } = useVideoConfig();
    const u = useUnit() * (p.scale || 1);
    return (
        <AbsoluteFill style={{ pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', left: clamp(p.x ?? 0.5) * width, top: clamp(p.y ?? 0.5) * height,
                transform: `translate(-50%, -50%) scale(${u})`, transformOrigin: 'center center', ...style }}>
                {children}
            </div>
        </AbsoluteFill>
    );
};

// Typed-out text: the first n characters at frame `f` when typing `cps` characters per second from `start`.
export function typed(text: string, frame: number, start: number, fps: number, cps = 14) {
    const n = Math.floor(Math.max(0, frame - start) / fps * cps);
    return text.slice(0, Math.min(text.length, n));
}

export const fmtNumber = (v: number, decimals = 0) =>
    v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

// A small seeded random, so every render of the same props looks the same.
export function rand(seed: number) {
    const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return x - Math.floor(x);
}
