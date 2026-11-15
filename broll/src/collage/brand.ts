import { FONT } from '../lib/common';
// Collage b-roll brand kit: one palette, outline weight and caption style for every card, medallion and caption of a
// video, so the set looks like one hand made it. A project's brand/brand.json is laid over these defaults.
export type Brand = {
    paper: string; paperShade: string; cardBorder: string; teal: string; tealLight: string; orange: string; heat: string;
    navy: string; navyLight: string; skin: string; bg: string; bgEdge: string; highlight: string; labelBg: string; labelInk: string;
    outline: number;          // sticker outline around illustrated figures (design px)
    cardBorderPx: number;     // white border of photo cards
    tilt: [number, number];   // random card tilt range, degrees (either direction)
    drift: number;            // push-in over a beat (0.04 = 4 %)
    enter: number;            // entrance length, frames
    // 'smooth' = sliding cards, push-in drift, cross-fades (the original look). 'hand' = edited-by-a-person look: hard
    // cuts with a small settle (settle -> 100 % over settleFrames), static holds, animation on `step`s (stop motion),
    // marks timed per word with uneven lengths, rough highlighter, boiling pen lines, a quick zoom.
    motion?: 'smooth' | 'hand';
    settle?: number;          // hand: entrance scale (1.1 = 110 % -> 100 %)
    settleFrames?: number;    // hand: settle length, frames
    step?: number;            // hand: hold every drawing for this many frames (2 = on twos)
    zoomFrames?: number;      // hand: the zoom's length (smooth = 22)
    border?: 'card' | 'film'; // photo border: 'card' = solid cardBorder colour, 'film' = 35 mm film strip (sprocket rails)
    filmEdge?: string;        // film strip edge-number colour (default the stock's orange; Ep. 04 on = strawberry, user: matcha + strawberry only)
    fonts?: { sans?: string; serif?: string };   // faces (keys of lib/common's FONT) for labels / title cards; none = Inter / Instrument Serif
    caption: { size: number; y: number; color: string; current: string; maxWords: number; maxChars: number; weight: number };
};

export const DEFAULT_BRAND: Brand = {
    paper: '#efe4cc', paperShade: '#e2d3b2', cardBorder: '#f6f2e9', teal: '#2f8f9a', tealLight: '#62b5bd', orange: '#f28a2e',
    heat: '#ff5a1f', navy: '#1c2738', navyLight: '#2c3b55', skin: '#e8b9a0', bg: '#1d1b19', bgEdge: '#0b0a09',
    highlight: '#ffd23f', labelBg: '#141414', labelInk: '#ffffff',
    outline: 14, cardBorderPx: 18, tilt: [1, 3], drift: 0.04, enter: 14,
    motion: 'smooth', settle: 1.1, settleFrames: 10, step: 2, zoomFrames: 10,
    caption: { size: 64, y: 0.7, color: '#ffffff', current: '#ffd23f', maxWords: 3, maxChars: 18, weight: 800 }
};

// The family a brand draws a role with: its `fonts` choice (a FONT key) or the default face.
export function fontOf(b: Brand, role: 'sans' | 'serif'): string {
    const key = b.fonts?.[role];
    return (key && (FONT as Record<string, string>)[key]) || FONT[role];
}

export function brandOf(p: { brand?: Partial<Brand> }): Brand {
    const b = p.brand || {};
    return { ...DEFAULT_BRAND, ...b, caption: { ...DEFAULT_BRAND.caption, ...(b.caption || {}) } } as Brand;
}
