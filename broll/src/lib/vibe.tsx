// Vibes: one look shared by every B-roll effect. A vibe is a set of tokens (card surface, text colours, font pairing,
// corner shape, shadow, motion feel); an effect asks useVibe(p) for them instead of writing its own colours and fonts,
// so one choice per video restyles every graphic at once.
//   props.vibe   the vibe's id (VIBES below); unknown or empty = 'classic' (the look before vibes)
//   props._vibe  a partial vibe laid over it (the user's saved custom vibe, resolved by src/main/broll.js)
//   props.dark   the effect's own "Dark card" box: the vibe's dark surface
//   props.accent the clip's accent; the vibe's own accent when it is empty
// The overlay is rendered with alpha and no footage under it, so "glass" is a translucent tinted card with a light
// rim and sheen, not a real blur of the picture (the Glass Blur title preset does that inside Fusion).
import React from 'react';
import { FONT } from './common';

type Surface = { bg: string; border: string; ink: string; dim: string; track: string; sheen: string };

export type Vibe = {
    id: string; name: string; about: string;
    light: Surface; dark: Surface;
    preferDark?: boolean;    // the vibe is a dark look: its dark surface is used whether or not the effect's Dark card box is ticked
    accent: string; danger: string;
    radius: number;          // multiplier on an effect's own corner radius (0 = square)
    borderWidth: number;     // px at the 1080 design size
    shadow: string; shadowDark: string;
    hardShadow?: string;     // an offset solid shadow (Bold Pop); replaces the soft one when set
    bare: { color: string; shadow: string };   // text drawn straight on the footage, no card
    font: {
        // faces are keys of lib/common's FONT: sans / serif / serifItalic / mono / hand
        display: string; displayWeight: number; displayStyle: 'normal' | 'italic'; displayTracking: number;   // em
        body: string; bodyWeight: number;
        label: string; labelWeight: number; labelCase: 'uppercase' | 'none'; labelTracking: number;           // em
        num: string; numWeight: number; numTracking: number;                                                  // em
        connector: string; connectorWeight: number; connectorStyle: 'normal' | 'italic';   // the small joining words
        quote: string; quoteWeight: number; quoteStyle: 'normal' | 'italic';               // quotes and pulled lines
    };
    motion: {
        damping: number; stiffness: number; mass: number;   // the In spring
        rise: number;      // px the graphic travels as it comes in
        pop: number;       // scale it starts from (1 = no scale)
        tilt: number;      // degrees it starts rotated by
        stagger: number;   // frames between items of a list
        steps: number;     // > 0: the In is held on this many steps (hard cuts) instead of easing
    };
};

import registry from '../../vibes.json';

// vibes.json holds the looks (also read by src/main/broll.js for the panel and the MCP tools); the first is the
// default, 'classic': what the effects looked like before vibes, so a clip placed before them keeps its look.
export const VIBES = registry.vibes as unknown as Vibe[];
const classic = VIBES[0];
export const DEFAULT_VIBE = classic.id;

// Handwriting and mono faces run small / wide next to Inter at the same font-size: the factor that evens them out.
const OPTICAL: Record<string, number> = { hand: 1.22, mono: 0.86, serif: 1.08, serifItalic: 1.08 };

function overlay<T>(base: T, over: any): T {
    if (!over || typeof over !== 'object') return base;
    const out: any = { ...(base as any) };
    for (const k of Object.keys(over)) {
        const b = (base as any)[k], o = over[k];
        if (o === undefined || o === null || o === '') continue;
        out[k] = b && typeof b === 'object' && typeof o === 'object' ? overlay(b, o) : o;
    }
    return out;
}

// Fonts are named by key (sans / serif / serifItalic / mono / hand) in a vibe and turned into families here, at
// render time, so this file never reads FONT while lib/common is still loading (the two import each other).
type Resolved = Vibe & { optical: Record<string, number> };
const FACES = ['display', 'body', 'label', 'num', 'connector', 'quote'] as const;

export function resolveVibe(id?: string, custom?: unknown): Resolved {
    const base = VIBES.find((v) => v.id === id) || classic;
    const v = overlay(base, custom) as Resolved;
    v.font = { ...v.font };
    v.optical = {};
    for (const k of FACES) {
        const key = v.font[k];
        v.optical[k] = OPTICAL[key] || 1;
        v.font[k] = (FONT as Record<string, string>)[key] || key;
    }
    return v;
}

// The In spring of a clip's vibe (lib/common's useInOut).
export function vibeSpring(p: VibeProps) {
    const m = (VIBES.find((v) => v.id === p.vibe) || classic).motion;
    const c = (p._vibe as any)?.motion || {};
    return { damping: Number(c.damping) || m.damping, stiffness: Number(c.stiffness) || m.stiffness, mass: Number(c.mass) || m.mass };
}

export type VibeProps = { vibe?: string; _vibe?: unknown; dark?: boolean; accent?: string };

export type Look = ReturnType<typeof look>;

// Everything an effect draws with. `dark` here is the surface actually used (pass a second argument to force one).
export function look(p: VibeProps, forceDark?: boolean) {
    const v = resolveVibe(p.vibe, p._vibe);
    const dark = forceDark ?? (!!p.dark || !!v.preferDark);
    const s = dark ? v.dark : v.light;
    const accent = p.accent || v.accent;
    const size = (k: string, px: number) => Math.round(px * (v.optical[k] || 1));
    const r = (px: number) => Math.round(px * v.radius);
    const shadow = v.hardShadow ? v.hardShadow.replace('#111111', dark ? 'rgba(255,255,255,.9)' : '#111111') : (dark ? v.shadowDark : v.shadow);

    // A card: the vibe's surface, rim, corners and shadow. `radius` is the effect's own corner at the 1080 design size.
    const card = (radius = 22, extra?: React.CSSProperties): React.CSSProperties => ({
        background: s.sheen !== 'none' ? `${s.sheen}, ${s.bg}` : s.bg,
        border: `${v.borderWidth}px solid ${s.border}`,
        borderRadius: r(radius),
        boxShadow: shadow,
        boxSizing: 'border-box',
        ...extra
    });
    // A smaller surface inside a card (a row, a chip, an input): the track colour, no shadow.
    const inset = (radius = 12, extra?: React.CSSProperties): React.CSSProperties => ({
        background: s.track, borderRadius: r(radius), boxSizing: 'border-box',
        ...(v.borderWidth >= 3 ? { border: `${Math.max(2, v.borderWidth - 2)}px solid ${s.border}` } : null), ...extra
    });

    const text = {
        // the hero word / headline
        display: (px: number, extra?: React.CSSProperties): React.CSSProperties => ({ fontFamily: v.font.display, fontWeight: v.font.displayWeight,
            fontStyle: v.font.displayStyle, fontSize: size('display', px), letterSpacing: `${v.font.displayTracking}em`, color: s.ink, lineHeight: 1.08, ...extra }),
        body: (px: number, extra?: React.CSSProperties): React.CSSProperties => ({ fontFamily: v.font.body, fontWeight: v.font.bodyWeight,
            fontSize: size('body', px), color: s.ink, lineHeight: 1.25, ...extra }),
        // small headers, captions, tags
        label: (px: number, extra?: React.CSSProperties): React.CSSProperties => ({ fontFamily: v.font.label, fontWeight: v.font.labelWeight,
            fontSize: size('label', px), textTransform: v.font.labelCase, letterSpacing: `${v.font.labelTracking}em`, color: s.dim, lineHeight: 1.2, ...extra }),
        // counters and readouts
        num: (px: number, extra?: React.CSSProperties): React.CSSProperties => ({ fontFamily: v.font.num, fontWeight: v.font.numWeight,
            fontSize: size('num', px), letterSpacing: `${v.font.numTracking}em`, fontVariantNumeric: 'tabular-nums', color: s.ink, lineHeight: 1, ...extra }),
        // the small joining words beside a hero word
        connector: (px: number, extra?: React.CSSProperties): React.CSSProperties => ({ fontFamily: v.font.connector, fontWeight: v.font.connectorWeight,
            fontStyle: v.font.connectorStyle, fontSize: size('connector', px), color: s.dim, lineHeight: 1.1, ...extra }),
        quote: (px: number, extra?: React.CSSProperties): React.CSSProperties => ({ fontFamily: v.font.quote, fontWeight: v.font.quoteWeight,
            fontStyle: v.font.quoteStyle, fontSize: size('quote', px), color: s.ink, lineHeight: 1.2, ...extra })
    };

    // The In of one piece: k runs 0..1 (useInOut's `inn`, or a list item's own spring). dir: where it comes from.
    const enter = (k: number, dir: 'up' | 'down' | 'left' | 'right' | 'none' = 'up', extra = ''): React.CSSProperties => {
        const m = v.motion;
        const q = m.steps > 0 ? Math.min(1, Math.ceil(Math.max(0, k) * m.steps - 1e-6) / m.steps) : k;
        const d = (1 - q) * m.rise;
        const t = dir === 'up' ? `translateY(${d}px)` : dir === 'down' ? `translateY(${-d}px)` : dir === 'left' ? `translateX(${d}px)` : dir === 'right' ? `translateX(${-d}px)` : '';
        const sc = m.pop + (1 - m.pop) * q;
        return { opacity: Math.max(0, Math.min(1, q * 1.5)), transform: `${t} scale(${sc}) rotate(${(1 - q) * m.tilt}deg) ${extra}`.trim() };
    };

    return {
        v, dark, accent, danger: v.danger,
        bg: s.bg, ink: s.ink, dim: s.dim, track: s.track, border: s.border, shadow,
        // text colour that reads on the accent (a filled badge or bar)
        onAccent: readable(accent),
        bare: v.bare, r, card, inset, text, enter,
        spring: { damping: v.motion.damping, stiffness: v.motion.stiffness, mass: v.motion.mass },
        stagger: v.motion.stagger
    };
}

export const useVibe = look;   // no hooks inside: named for how effects read it

// Effects drawn before vibes existed keep, under plain Classic, the exact look they were drawn with (a clip placed
// earlier renders the same); any other vibe, or Classic with changes, draws with the vibe.
export function plainClassic(p: VibeProps, L: Look) {
    return L.v.id === 'classic' && !(p._vibe && typeof p._vibe === 'object');
}

type Role = 'display' | 'body' | 'label' | 'num' | 'connector' | 'quote';
// A text role's face: `own` (the effect's family / weight / spacing) under plain Classic, the vibe's otherwise. With
// `px` the size is set too, evened out for faces that run small (handwriting) or wide (mono).
export function face(L: Look, role: Role, own: React.CSSProperties, classic: boolean, px?: number): React.CSSProperties {
    if (classic) return px === undefined ? own : { ...own, fontSize: px };
    const f = L.v.font as unknown as Record<string, string | number>;
    const out: React.CSSProperties = { fontFamily: String(f[role]), fontWeight: Number(f[role + 'Weight']) || 700,
        fontStyle: (f[role + 'Style'] as React.CSSProperties['fontStyle']) || 'normal' };
    if (Number.isFinite(Number(f[role + 'Tracking']))) out.letterSpacing = `${Number(f[role + 'Tracking'])}em`;
    if (role === 'label') out.textTransform = L.v.font.labelCase;
    if (px !== undefined) out.fontSize = Math.round(px * (L.v.optical[role] || 1) * 100) / 100;
    return out;
}

// Black or white, whichever reads on `hex`.
export function readable(hex: string) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
    if (!m) return '#111111';
    const [r, g, b] = [m[1], m[2], m[3]].map((h) => { const c = parseInt(h, 16) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.32 ? '#111111' : '#ffffff';
}

// `hex` at an alpha, for tints of the accent.
export function tint(hex: string, a: number) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
    return m ? `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})` : hex;
}
