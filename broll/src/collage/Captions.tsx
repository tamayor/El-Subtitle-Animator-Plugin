// Word-timed captions for the collage style: bold sans-serif, white, the word being spoken in yellow, 2 to 3 words at
// a time in the lower third. Words are in timeline frames; frame 0 of the clip is timeline frame `from`.
// Chunks break after punctuation, at a pause longer than 8 frames, at maxWords or at maxChars.
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { brandOf, type Brand } from './brand';
import { FONT } from '../lib/common';
import { k01 } from './cards';

export type Word = { w: string; start: number; end: number };
export type Chunk = { words: Word[]; start: number; end: number };

export function captionChunks(words: Word[], c: Brand['caption']): Chunk[] {
    const out: Word[][] = [];
    let cur: Word[] = [];
    const len = (ws: Word[]) => ws.map((w) => w.w).join(' ').length;
    for (const w of words) {
        if (cur.length && (cur.length >= c.maxWords || w.start - cur[cur.length - 1].end > 8 || len([...cur, w]) > c.maxChars)) { out.push(cur); cur = []; }
        cur.push(w);
        if (/[.,?!;:]$/.test(w.w)) { out.push(cur); cur = []; }
    }
    if (cur.length) out.push(cur);
    return out.map((ws, i) => {
        const next = out[i + 1];
        const end = Math.min(next ? next[0].start : Infinity, ws[ws.length - 1].end + 10);
        return { words: ws, start: ws[0].start, end };
    });
}

const STROKE = [[-4, 0], [4, 0], [0, -4], [0, 4], [-3, -3], [3, -3], [-3, 3], [3, 3]].map(([x, y]) => `${x}px ${y}px 0 #000`).join(', ') + ', 0 6px 14px rgba(0,0,0,.55)';

export const CollageCaptions: React.FC<{ words: Word[]; from: number; brand?: Partial<Brand> }> = (p) => {
    const frame = useCurrentFrame();
    const { width, height } = useVideoConfig();
    const b = brandOf(p), c = b.caption;
    const u = width / 1080, H = height / u, g = (p.from || 0) + frame;
    const chunk = captionChunks(p.words || [], c).find((x) => g >= x.start && g < x.end);
    if (!chunk) return <AbsoluteFill />;
    const pop = k01(g, chunk.start, chunk.start + 4);
    return (
        <AbsoluteFill>
            <div style={{ position: 'absolute', left: 0, top: 0, width: 1080, height: H, transform: `scale(${u})`, transformOrigin: 'left top' }}>
                <div style={{ position: 'absolute', left: 60, right: 60, top: c.y * H, transform: `translateY(-50%) scale(${0.92 + 0.08 * pop})`,
                    textAlign: 'center', fontFamily: FONT.sans, fontWeight: c.weight, fontSize: c.size, lineHeight: 1.15, textShadow: STROKE }}>
                    {chunk.words.map((w, i) => {
                        const nextStart = chunk.words[i + 1]?.start ?? chunk.end;
                        const on = g >= w.start && g < nextStart;
                        return <span key={i} style={{ color: on ? c.current : c.color }}>{w.w}{i < chunk.words.length - 1 ? ' ' : ''}</span>;
                    })}
                </div>
            </div>
        </AbsoluteFill>
    );
};
