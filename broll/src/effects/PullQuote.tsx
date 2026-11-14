// Pull quote: the frame dims softly and one memorable line is set large in editorial type, with its attribution.
// Full frame (unlike the compact Quote card).
import React from 'react';
import { useVideoConfig } from 'remotion';
import { Common, FONT, Full, WordsIn, clamp, ease, prog, useInOut, useUnit, wordCount, wordSpans } from '../lib/common';
import { face, plainClassic, useVibe } from '../lib/vibe';

type P = Common & { quote: string; author: string; dim: number; italic: boolean; marks: boolean };

export const PullQuote: React.FC<P> = (p) => {
    const quote = String(p.quote || '');
    const n = wordCount(quote);
    const { frame, real, durationInFrames: D } = useInOut(p, (D0) => Math.min(Math.round(D0 * 0.6), 8 + n * 3) + 6);
    const { width, height } = useVideoConfig();
    const u = useUnit() * (p.scale || 1);
    const spans = wordSpans(p, n, (i, at) => at + 5);
    const build = Math.min(Math.round(D * 0.6), 8 + n * 3);
    const times = spans ? spans.at : Array.from({ length: n }, (_, i) => 6 + (i / Math.max(1, n)) * (build - 6));
    const f = spans ? real : frame;      // word times are clip frames
    const size = (quote.length > 90 ? 62 : quote.length > 50 ? 76 : 94) * u;
    const last = spans ? Math.max(...spans.end) : build + 4;
    const L = useVibe(p), C = plainClassic(p, L);
    // Italic picks the vibe's quote face in italic; plain Classic keeps Instrument Serif
    const quoteFace = C ? { fontFamily: p.italic ? FONT.serifItalic : FONT.serif, fontStyle: p.italic ? 'italic' : 'normal', letterSpacing: -0.5 * u }
        : { ...face(L, 'quote', {}, false), ...(p.italic ? { fontStyle: 'italic' } : null) };
    return (
        <Full p={p}>
            <div style={{ position: 'absolute', inset: 0, background: `rgba(8,9,12,${clamp(Number(p.dim) || 0, 0, 0.95) * ease(prog(frame, 0, 10))})` }} />
            <div style={{ position: 'absolute', left: clamp(p.x ?? 0.5) * width, top: clamp(p.y ?? 0.5) * height, transform: 'translate(-50%, -50%)',
                width: Math.min(width * 0.84, 1500 * u), textAlign: 'center' }}>
                {p.marks && <div style={{ fontFamily: C ? FONT.serif : L.v.font.quote, fontSize: 230 * u, lineHeight: 0.6, color: p.accent, height: 110 * u, opacity: ease(prog(frame, 0, 8)),
                    transform: `translateY(${(1 - ease(prog(frame, 0, 10))) * 20 * u}px)` }}>“</div>}
                <div style={{ ...(quoteFace as React.CSSProperties), fontSize: C ? size : size * (L.v.optical.quote || 1), lineHeight: 1.14, color: C ? '#fff' : L.bare.color,
                    textShadow: `0 ${3 * u}px ${22 * u}px rgba(0,0,0,.6)` }}>
                    <WordsIn text={quote} times={times} frame={f} ends={spans ? spans.end : times.map(t => t + 6)} />
                </div>
                {p.author && (
                    <div style={{ marginTop: 34 * u, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 * u, opacity: prog(f, last, last + 8) }}>
                        <div style={{ width: 54 * u, height: 3 * u, background: p.accent }} />
                        <div style={{ ...face(L, 'label', { fontFamily: FONT.sans, fontWeight: 600, letterSpacing: 2 * u }, C, 30 * u), color: C ? 'rgba(255,255,255,.86)' : L.bare.color, opacity: C ? 1 : 0.86, textTransform: 'uppercase' }}>{p.author}</div>
                    </div>
                )}
            </div>
        </Full>
    );
};
