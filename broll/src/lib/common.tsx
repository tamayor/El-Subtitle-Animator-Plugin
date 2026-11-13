// Shared pieces for every B-roll effect: the common props (x, y, scale, accent, enter, exit), the placing wrapper,
// the in / out envelope and the fonts. Effects are drawn at a 1080-px design size and scaled to the timeline.
import React from 'react';
import { AbsoluteFill, Easing, spring, useCurrentFrame, useVideoConfig } from 'remotion';
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
    delay?: number;    // frame (from the clip start) where the animation In starts; nothing shows before it
    fitIn?: boolean;
    _times?: number[]; // Land on word: the frame (from the clip start) each shown word / item starts coming in (src/main/broll.js)
    _ends?: number[];  // ...and the frame it is fully in (the word lane's matcha head; set by hand when _manual)
    _manual?: boolean;   // the build lands at the end of the In (delay + enter): the B-roll tab's range bar sets it
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
    const real = useCurrentFrame();
    const { fps, durationInFrames: D0 } = useVideoConfig();
    const enter = Math.max(0, p.enter ?? 10), exit = Math.max(0, p.exit ?? 8);
    // Delay: the In starts on frame `delay` (the B-roll tab's range bar: left head = start, right head = end of the In).
    // The effect's own clock and length start there, so its build is paced to the time that is left.
    const delay = Math.max(0, Math.min(D0 - 1, Math.round(Number(p.delay) || 0)));
    const raw = Math.max(0, real - delay), durationInFrames = Math.max(1, D0 - delay);
    const b0 = buildEnd ? Math.max(1, buildEnd(durationInFrames, fps)) : 0;
    const settle = Math.max(0, (Number(p.settle) || 0) - delay);
    // fitIn (no settle): the whole build (count, typing, drawing...) is paced to land on the In's right head
    const fit = p.fitIn && !(settle > 0) ? Math.max(1, Math.round(enter)) : 0;
    const target = settle > 0 ? settle : fit;
    const frame = target > 0 && b0 > 0 ? (raw <= target ? raw * b0 / target : b0 + (raw - target)) : raw;
    const inn = real < delay ? 0 : enter <= 0 ? 1 : spring({ frame: fit ? raw : frame, fps, durationInFrames: Math.max(1, Math.round(enter)), config: { damping: 16, stiffness: 160 } });
    const out = 1;   // no animation out: the finished graphic holds to the clip's last frame (props.exit is ignored)
    return { frame, raw, real, fps, durationInFrames, inn, out, enter, exit, delay };
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
    const hidden = useCurrentFrame() < Math.max(0, Math.round(Number(p.delay) || 0));   // before the In starts
    return (
        <AbsoluteFill style={{ pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', left: clamp(p.x ?? 0.5) * width, top: clamp(p.y ?? 0.5) * height,
                transform: `translate(-50%, -50%) scale(${u})`, transformOrigin: 'center center', ...style, ...(hidden ? { opacity: 0 } : null) }}>
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

// Land on word: the spoken frame of each of the n shown words / items (clip frames), or null when the clip is not
// synced word by word (or the words changed since it was synced).
export function wordTimes(p: Common, n: number): number[] | null {
    const t = Array.isArray(p._times) ? p._times.map(Number) : [];
    return n > 0 && t.length === n && t.every(Number.isFinite) ? t : null;
}

// Each word's [in, end] frames: _times and _ends (the word lane), an end the effect picks when there is none.
export function wordSpans(p: Common, n: number, dflt: (i: number, at: number, next: number) => number): { at: number[]; end: number[] } | null {
    const at = wordTimes(p, n);
    if (!at) return null;
    const e = Array.isArray(p._ends) ? p._ends.map(Number) : [];
    const end = at.map((a, i) => (e.length === n && Number.isFinite(e[i]) && e[i] > a ? e[i] : dflt(i, a, i + 1 < n ? at[i + 1] : a + 20)));
    return { at, end };
}

// Text whose words come in one by one: the i-th word from times[first + i] to ends[first + i] (else 4 frames). Words
// not yet in keep their space, so the layout never jumps.
export const WordsIn: React.FC<{ text: string; times: number[]; frame: number; first?: number; ends?: number[] }> = ({ text, times, frame, first = 0, ends }) => {
    let w = first;
    return (
        <>
            {String(text).split(/(\s+)/).map((t, i) => {
                if (!/\S/.test(t)) return t;
                const wi = Math.min(w++, times.length - 1), at = times[wi];
                const k = clamp((frame - at) / Math.max(1, ends ? ends[wi] - at : 4));
                return <span key={i} style={{ display: 'inline-block', opacity: k, transform: `translateY(${(1 - k) * 10}px)` }}>{t}</span>;
            })}
        </>
    );
};

export const wordCount = (text: string) => String(text || '').split(/\s+/).filter(Boolean).length;
