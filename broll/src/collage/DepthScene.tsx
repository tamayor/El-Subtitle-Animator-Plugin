// Depth scene (visual "depth"): one picture split into layers at different depths, a camera that trucks / pushes a
// little so the layers slide past each other (parallax), paper strips whose text types on with the spoken words,
// and ambient motion picked for the picture's own story (e.g. press flashes behind someone walking free on bail).
// Hard cut in and out: the scene is there on its first frame. Layer positions are design px on the 1080-wide canvas.
//
// beat fields:
//   layers:  [{ src, x, y, w, z, blur?, fade?: [top, bottom] px, anim?: {type:'dance'|'breathe'|'sway', ...},
//              lit?: true (catches the flashes), eyes?: [[cx, cy, w, h, deg]] (0..1 of the image),
//              ar (image height / width, for the eye bars), at?, paper?, rot? }]
//   strips:  [{ x, y, z, size?, rot?, words: [[text, frameFromBeatStart], ...] }]
//   camera:  [[frame, x, y, zoom], ...]  (x/y design px the camera has moved; layers move by x * z)
//   frame:   {x, y, w, h}  (user, Ep. 04 notes: "no need to use blur all the time, the vhs border use it but animate the
//            image inside") the picture's window, in the film-strip border on the dark backdrop: every layer and ambient
//            moves inside it (clipped), paper layers + strips sit outside it, still, so they never run off the frame
//   ambient: [{ type, area: [x, y, w, h], z, ... }]  motion that belongs to the picture's own story:
//     flashes  press camera flashes (from?, gap?: [min, max], seed?), lighting the `lit` layers
//     siren    police lights: red / blue glows pulsing at the area's edges (colors?, period?)
//     rain     falling streaks over the area (density?, slant?) + rings spreading on `ripples` points [[x, y], ...]
//     sweep    a band of light crossing the area over the beat (from?, to? 0..1, width?, bars? = shadows of N bars, color?)
//     blink    a small screen light at [x, y] (area x, y) blinking (every?, color?, r?)
import React from 'react';
import { Easing, Img, interpolate } from 'remotion';
import { type Brand } from './brand';
import { FONT, rand } from '../lib/common';
import { settleScale, FilmBorder } from './cards';

export type DepthLayer = {
    src: string; x: number; y: number; w: number; z: number; blur?: number; fade?: [number, number];
    anim?: { type: 'dance' | 'breathe' | 'sway'; period?: number; amp?: number; hop?: number };
    lit?: boolean; eyes?: number[][]; ar?: number; at?: number; paper?: boolean; rot?: number; eyeText?: string;
    dim?: number;   // brightness (0.5 = half): a far plate sinks back
    order?: number; // draw order when it must differ from the depth (vertigo: subject at z 0, drawn on top of the plate)
};
export type DepthStrip = { x: number; y: number; z: number; size?: number; rot?: number; align?: 'center'; words: [string, number][] };
export type DepthAmbient = { type: 'flashes' | 'siren' | 'rain' | 'sweep' | 'blink'; area: number[]; z: number; from?: number; gap?: [number, number]; seed?: number;
    colors?: string[]; period?: number; density?: number; slant?: number; ripples?: number[][]; to?: number; width?: number; bars?: number;
    color?: string; every?: number; r?: number; opacity?: number };
export type DepthBeat = { layers?: DepthLayer[]; strips?: DepthStrip[]; camera?: number[][]; ambient?: DepthAmbient[];
    frame?: { x: number; y: number; w: number; h: number } };

const inOut = Easing.inOut(Easing.cubic);
const PAPER = '#f3ede0', INK = '#1c2738';

// Camera at frame t: eased between keys (a person's move: accelerate, glide, land), never a constant drift.
function cameraAt(keys: number[][] | undefined, t: number) {
    const k = keys && keys.length ? keys : [[0, 0, 0, 1]];
    if (t <= k[0][0]) return k[0];
    for (let i = 1; i < k.length; i++) {
        if (t <= k[i][0]) {
            const p = inOut((t - k[i - 1][0]) / Math.max(1, k[i][0] - k[i - 1][0]));
            return k[i].map((v, j) => k[i - 1][j] + (v - k[i - 1][j]) * p);
        }
    }
    return k[k.length - 1];
}

// The flash times of a press-flash ambient: seeded, uneven gaps (no metronome).
function flashTimes(a: DepthAmbient, D: number) {
    const out: { at: number; x: number; y: number; r: number }[] = [];
    const [g0, g1] = a.gap || [5, 13];
    let f = a.from ?? 3, i = 0;
    const s = a.seed ?? 7;
    while (f < D && i < 60) {
        out.push({ at: f, x: a.area[0] + rand(s * 31 + i * 7.1) * a.area[2], y: a.area[1] + rand(s * 17 + i * 3.7) * a.area[3], r: 110 + rand(s + i * 13.3) * 120 });
        f += Math.round(g0 + rand(s * 5 + i * 11.9) * (g1 - g0));
        i++;
    }
    return out;
}
const flashLevel = (fl: { at: number }[], t: number) => fl.reduce((m, f) => Math.max(m, t === f.at ? 1 : t === f.at + 1 ? 0.4 : 0), 0);

// The black bar over the eyes with its word on it (user, Ep. 04: instead of the meme stickers).
const EyeBar: React.FC<{ e: number[]; w: number; h: number; text: string }> = ({ e, w, h, text }) => {
    const [cx, cy, bw, bh, deg = 0] = e;
    const W = bw * w, Hh = bh * h;
    // the bar covers the eyes and grows past them to fit its word (never clipped)
    return <div style={{ position: 'absolute', left: cx * w, top: cy * h, minWidth: W, height: Hh, padding: `0 ${Hh * 0.35}px`, boxSizing: 'border-box',
        background: '#0b0b0b', transform: `translate(-50%, -50%) rotate(${deg}deg)`, display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 2px 6px rgba(0,0,0,.35)' }}>
        <span style={{ color: '#fff', fontFamily: FONT.arial, fontWeight: 700, fontSize: Hh * 0.56, letterSpacing: Hh * 0.04,
            whiteSpace: 'nowrap', lineHeight: 1 }}>{text}</span>
    </div>;
};

// Puppet motion of a cut-out, on twos (stop motion), pivoting at its feet.
function animOf(a: DepthLayer['anim'], t: number, seed: number) {
    if (!a) return '';
    const s = Math.floor(t / 2) * 2, P = a.period || 16, amp = a.amp ?? 3.5;
    const ph = (s / P) * Math.PI * 2 + seed;
    if (a.type === 'dance') {
        const hop = -Math.abs(Math.sin(ph)) * (a.hop ?? 14);
        const side = Math.sin(ph / 2) * 10;
        return `translate(${side}px, ${hop}px) rotate(${Math.sin(ph) * amp}deg) scaleY(${1 + 0.02 * Math.cos(ph * 2)})`;
    }
    if (a.type === 'sway') return `rotate(${Math.sin(ph) * amp}deg)`;
    return `scale(${1 + 0.008 * Math.sin(ph)})`;   // breathe
}

// A strip of paper whose sentence types on: each word on its spoken frame, its letters over a few frames, the strip
// growing with the text. Torn ends, a hair of tilt.
const PaperStrip: React.FC<{ s: DepthStrip; t: number; seed: number }> = ({ s, t, seed }) => {
    const size = s.size || 60;
    let text = '';
    s.words.forEach(([w, at], i) => {
        if (t < at) return;
        const next = s.words[i + 1]?.[1] ?? at + 8;
        const n = Math.max(1, Math.min(w.length, Math.ceil(((t - at + 1) / Math.max(2, Math.min(5, next - at))) * w.length)));
        text += (i ? ' ' : '') + w.slice(0, n);
    });
    if (!text) return null;
    const j = (k: number) => (rand(seed * 13 + k) - 0.5) * 6;
    const torn = `polygon(0% ${2 + j(1)}%, 2% 0%, 98% ${1 + j(2) / 3}%, 100% ${6 + j(3)}%, 99% 50%, 100% ${94 + j(4)}%, 97% 100%, 3% ${99 + j(5) / 3}%, 0% ${95 + j(6)}%, 1% 50%)`;
    // align 'center': x is the strip's centre (it grows both ways as the words type on, staying centred)
    return <div style={{ position: 'absolute', left: s.x, top: s.y, transform: `${s.align === 'center' ? 'translateX(-50%) ' : ''}rotate(${s.rot ?? 0}deg)`,
        filter: 'drop-shadow(0 6px 10px rgba(0,0,0,.45))' }}>
        <div style={{ background: PAPER, clipPath: torn, padding: `${size * 0.14}px ${size * 0.34}px ${size * 0.2}px`,
            fontFamily: FONT.garamondItalic, fontStyle: 'italic', fontWeight: 500, fontSize: size, color: INK, whiteSpace: 'nowrap', lineHeight: 1.1 }}>{text}</div>
    </div>;
};

// The non-flash ambients. Everything steps on twos like the puppets (rain included), so it reads drawn, not simulated.
function ambientOf(a: DepthAmbient, t0: number, D: number, k: number, b: Brand): React.ReactNode {
    const t = Math.floor(t0 / 2) * 2, [ax, ay, aw, ah] = a.area, s = (a.seed ?? 3) + k * 17;
    const box = (c: React.ReactNode, extra: React.CSSProperties = {}) =>
        <div style={{ position: 'absolute', left: ax, top: ay, width: aw, height: ah, overflow: 'hidden', ...extra }}>{c}</div>;
    if (a.type === 'siren') {
        // two lights turning: each glow swells and dies on its own phase, red then blue, never in lockstep
        const [c1, c2] = a.colors || [b.labelBg || '#c7385a', '#3f7f45'];   // the brand's strawberry + matcha only
        const P = a.period || 14;
        const lvl = (ph: number) => Math.pow(Math.max(0, Math.sin(((t / P) + ph) * Math.PI * 2)), 3);
        const g = (c: string, x: number, o: number) => <div style={{ position: 'absolute', left: x - aw * 0.55, top: -ah * 0.1, width: aw * 1.1, height: ah * 1.2, opacity: o * (a.opacity ?? 0.55),
            background: `radial-gradient(ellipse at center, ${c} 0, ${c}88 25%, transparent 65%)` }} />;
        return box(<>{g(c1, 0, lvl(0))}{g(c2, aw, lvl(0.5))}</>);
    }
    if (a.type === 'rain') {
        const n = a.density || 70, sl = a.slant ?? 0.18, fall = 46;   // px per frame, on twos
        const drops = Array.from({ length: n }, (_, i) => {
            const len = 50 + rand(s + i * 3.1) * 70, x0 = rand(s + i * 7.7) * (aw + 200) - 100;
            const y = ((rand(s + i * 1.3) * (ah + 200) + t * fall * (0.8 + rand(s + i * 9.1) * 0.5)) % (ah + 200)) - 100;
            return <div key={i} style={{ position: 'absolute', left: x0 - y * sl, top: y, width: 2, height: len, transform: `rotate(${Math.atan(sl) * 57.3}deg)`,
                background: 'linear-gradient(180deg, rgba(255,255,255,0), rgba(230,238,245,.55))', borderRadius: 2 }} />;
        });
        const rings = (a.ripples || []).flatMap(([px, py], i) => [0, 1].map((j) => {
            const L = 22, ph = (t + Math.round(rand(s + i * 5.3 + j) * L) + j * 11) % L, r = 6 + ph * 3.2;
            return <div key={i + '-' + j} style={{ position: 'absolute', left: px - ax - r, top: py - ay - r * 0.35, width: 2 * r, height: 0.7 * r,
                border: '2px solid rgba(235,242,248,.6)', borderRadius: '50%', opacity: 1 - ph / L }} />;
        }));
        return box(<>{drops}{rings}</>, { opacity: a.opacity ?? 0.85 });
    }
    if (a.type === 'sweep') {
        // a slow band of light crossing the picture (sun moving through a window = time passing); with `bars`, the
        // band is cut by the shadows of the bars it comes through
        const p = interpolate(t, [0, Math.max(1, D)], [a.from ?? -0.2, a.to ?? 1.0]), W = (a.width ?? 0.45) * aw;
        const x = p * aw;
        const col = a.color || 'rgba(255,250,240,.34)';   // plain daylight: no colour of its own
        const n = a.bars || 0;
        const shadows = Array.from({ length: n }, (_, i) => <div key={i} style={{ position: 'absolute', top: 0, height: '100%', left: (i + 0.5) * (W / n) - W * 0.05, width: W * 0.1,
            background: 'rgba(0,0,0,.42)', filter: 'blur(6px)' }} />);
        return box(<div style={{ position: 'absolute', left: x - W / 2, top: -ah * 0.1, width: W, height: ah * 1.2, transform: 'skewX(-14deg)' }}>
            <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(90deg, transparent, ${col} 25%, ${col} 75%, transparent)`, mixBlendMode: 'screen' }} />
            {shadows}
        </div>);
    }
    if (a.type === 'blink') {
        const every = a.every || 12, on = (Math.floor(t0 / every) + (rand(s + Math.floor(t0 / every)) > 0.7 ? 1 : 0)) % 2 === 0;
        const r = a.r || 60, c = a.color || '#3f7f45';
        const beat = (t0 % every) < 3 ? 1 : 0.55;
        return <div style={{ position: 'absolute', left: ax - r, top: ay - r, width: 2 * r, height: 2 * r, opacity: on ? beat : 0.15,
            background: `radial-gradient(circle, ${c} 0, ${c}99 18%, transparent 70%)` }} />;
    }
    return null;
}

export const DepthScene: React.FC<{ beat: DepthBeat; t: number; D: number; b: Brand; src: (n: string) => string; H: number; seed: number }> = ({ beat, t, D, b, src, H, seed }) => {
    const [, cx, cy, zoom] = cameraAt(beat.camera, t);
    const fr = beat.frame;
    const ox = fr ? fr.x + fr.w / 2 : 540, oy = fr ? fr.y + fr.h / 2 : H / 2;
    const cam = (z: number): React.CSSProperties => ({
        position: 'absolute', left: 0, top: 0, width: 1080, height: H, transformOrigin: `${ox}px ${oy}px`,
        transform: `translate(${-cx * z}px, ${-cy * z}px) scale(${1 + (zoom - 1) * z})`
    });
    const still: React.CSSProperties = { position: 'absolute', left: 0, top: 0, width: 1080, height: H };
    const flashes = (beat.ambient || []).filter((a) => a.type === 'flashes').map((a) => ({ a, f: flashTimes(a, D) }));
    const light = flashes.reduce((m, x) => Math.max(m, flashLevel(x.f, t)), 0);
    type Item = { z: number; el: React.ReactNode; out?: boolean };
    const items: Item[] = [];

    (beat.layers || []).forEach((l, i) => {
        if (l.at != null && t < l.at) return;
        const sc = l.at != null ? settleScale(t - l.at, { ...b, settleFrames: 6 }) : 1;
        const img = <Img src={src(l.src)} style={{ width: l.w, display: 'block' }} />;
        const fade = l.fade ? `linear-gradient(to bottom, transparent 0, #000 ${l.fade[0]}px, #000 calc(100% - ${l.fade[1]}px), transparent 100%)` : undefined;
        const out = !!(fr && l.paper);
        items.push({ z: l.order ?? l.z, out, el: <div key={'l' + i} style={out ? still : cam(l.z)}>
            <div style={{ position: 'absolute', left: l.x, top: l.y, width: l.w, transformOrigin: '50% 100%', transform: `${animOf(l.anim, t, i * 1.7)} rotate(${l.rot ?? 0}deg) scale(${sc})`,
                filter: [l.blur ? `blur(${l.blur}px)` : '', (l.dim ?? 1) !== 1 || (l.lit && light) ? `brightness(${(l.dim ?? 1) * (1 + (l.lit ? 0.28 * light : 0))})` : ''].join(' ') || undefined,
                WebkitMaskImage: fade, maskImage: fade,
                ...(l.paper ? { background: PAPER, padding: 14, boxShadow: '0 16px 30px rgba(0,0,0,.55)' } : {}) }}>
                {img}
                {(l.eyes || []).map((e, k) => <EyeBar key={k} e={e} w={l.w} h={l.w * (l.ar ?? 1)} text={l.eyeText || 'FVCK CORRUPT'} />)}
            </div>
        </div> });
    });
    flashes.forEach(({ a, f }, k) => {
        const on = f.filter((x) => t === x.at || t === x.at + 1);
        if (!on.length) return;
        items.push({ z: a.z + 0.001, el: <div key={'f' + k} style={{ ...cam(a.z), mixBlendMode: 'screen' }}>
            {on.map((x, n) => {
                const I = t === x.at ? 1 : 0.4;
                return <div key={n} style={{ position: 'absolute', left: x.x - x.r, top: x.y - x.r, width: 2 * x.r, height: 2 * x.r, opacity: I,
                    background: 'radial-gradient(circle, #ffffff 0, rgba(255,255,255,.95) 6%, rgba(255,250,235,.45) 22%, rgba(255,250,235,0) 70%)' }}>
                    <div style={{ position: 'absolute', left: 0, top: x.r - 1.5, width: 2 * x.r, height: 3, background: 'linear-gradient(90deg, transparent, #fff, transparent)' }} />
                    <div style={{ position: 'absolute', top: 0, left: x.r - 1.5, height: 2 * x.r, width: 3, background: 'linear-gradient(180deg, transparent, #fff, transparent)' }} />
                </div>;
            })}
        </div> });
    });
    (beat.ambient || []).forEach((a, k) => {
        const el = ambientOf(a, t, D, k, b);
        if (el) items.push({ z: a.z + 0.001, el: <div key={'a' + k} style={{ ...cam(a.z), mixBlendMode: a.type === 'sweep' && a.bars ? 'normal' : 'screen', pointerEvents: 'none' }}>{el}</div> });
    });
    (beat.strips || []).forEach((s, i) => items.push({ z: s.z, out: !!fr, el: <div key={'s' + i} style={fr ? still : cam(s.z)}><PaperStrip s={s} t={t} seed={seed + i} /></div> }));

    const sorted = items.sort((p, q) => p.z - q.z);
    if (!fr) return <>{sorted.map((x) => x.el)}</>;
    // framed: hard cut + settle on the window (brand hand look), the picture moving inside it
    const sc = settleScale(t, b);   // the brand's own cut settle (110 % -> 100 %), like every collage card
    return <>
        <div style={{ position: 'absolute', left: fr.x, top: fr.y, width: fr.w, height: fr.h, transform: `scale(${sc})`, transformOrigin: 'center' }}>
            <FilmBorder box={{ w: fr.w, h: fr.h }} seed={seed} shadow="0 22px 44px rgba(0,0,0,.6)" edgeColor={b.filmEdge} />
            <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#111' }}>
                <div style={{ position: 'absolute', left: -fr.x, top: -fr.y, width: 1080, height: H }}>
                    {sorted.filter((x) => !x.out).map((x) => x.el)}
                </div>
            </div>
        </div>
        {sorted.filter((x) => x.out).map((x) => x.el)}
    </>;
};
