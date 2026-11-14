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
    caption: { size: number; y: number; color: string; current: string; maxWords: number; maxChars: number; weight: number };
};

export const DEFAULT_BRAND: Brand = {
    paper: '#efe4cc', paperShade: '#e2d3b2', cardBorder: '#f6f2e9', teal: '#2f8f9a', tealLight: '#62b5bd', orange: '#f28a2e',
    heat: '#ff5a1f', navy: '#1c2738', navyLight: '#2c3b55', skin: '#e8b9a0', bg: '#1d1b19', bgEdge: '#0b0a09',
    highlight: '#ffd23f', labelBg: '#141414', labelInk: '#ffffff',
    outline: 14, cardBorderPx: 18, tilt: [1, 3], drift: 0.04, enter: 14,
    caption: { size: 64, y: 0.7, color: '#ffffff', current: '#ffd23f', maxWords: 3, maxChars: 18, weight: 800 }
};

export function brandOf(p: { brand?: Partial<Brand> }): Brand {
    const b = p.brand || {};
    return { ...DEFAULT_BRAND, ...b, caption: { ...DEFAULT_BRAND.caption, ...(b.caption || {}) } } as Brand;
}
