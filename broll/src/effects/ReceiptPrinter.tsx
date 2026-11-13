// Receipt printer: a thermal printer feeds a receipt up out of its slot. The header prints first (so it reads at the
// top, like a torn-off receipt), then each line: a whole line at a time (news-line mode, a print-head wipe) or word by
// word (byWord). "Label | value" lines print as two columns. With _times (frames from the clip start, one per word,
// set by Sync to words from the transcription) each word prints on the frame it is spoken.
import React from 'react';
import { interpolate } from 'remotion';
import { Common, FONT, Place, clamp, ease, useInOut } from '../lib/common';

type P = Common & {
    header: string; subheader: string; lines: string[]; byWord: boolean; footer: string; barcode: boolean;
    mark: number; upper: boolean; paper: string; ink: string; _times?: number[];
};

const PAPER_W = 520, PAD = 32, FS = 30, CH = FS * 0.6, COLS = Math.floor((PAPER_W - PAD * 2) / CH);
const ROW_H = 44, MAX_PAPER = 760, FEED = 5;

type Row = { kind: 'header' | 'sub' | 'rule' | 'text' | 'footer' | 'barcode'; h: number; left?: string[]; right?: string; item?: number };

// Wraps words to `cols` characters (a word longer than a row is cut).
function wrap(words: string[], cols: number) {
    const rows: string[][] = [];
    let cur: string[] = [], len = 0;
    for (let w of words) {
        if (w.length > cols) w = w.slice(0, cols);
        if (cur.length && len + 1 + w.length > cols) { rows.push(cur); cur = []; len = 0; }
        len += (cur.length ? 1 : 0) + w.length; cur.push(w);
    }
    if (cur.length) rows.push(cur);
    return rows;
}

function buildRows(p: P) {
    const up = (s: string) => (p.upper !== false ? s.toUpperCase() : s);
    const rows: Row[] = [];
    if (p.header) rows.push({ kind: 'header', h: 62, left: [up(p.header)] });
    if (p.subheader) rows.push({ kind: 'sub', h: 34, left: [up(p.subheader)] });
    if (p.header || p.subheader) rows.push({ kind: 'rule', h: 26 });
    (p.lines && p.lines.length ? p.lines : ['Line']).slice(0, 24).forEach((raw, item) => {
        const [l, r] = String(raw).split('|').map((s) => s.trim());
        const right = r ? up(r) : '';
        const words = up(l || '').split(/\s+/).filter(Boolean);
        const wrapped = wrap(words, right ? Math.max(6, COLS - right.length - 1) : COLS);
        (wrapped.length ? wrapped : [[]]).forEach((ws, k) => rows.push({ kind: 'text', h: ROW_H, left: ws, right: k === 0 ? right : '', item }));
    });
    if (p.footer || p.barcode) rows.push({ kind: 'rule', h: 26 });
    if (p.footer) rows.push({ kind: 'footer', h: 46, left: [up(p.footer)] });
    if (p.barcode) rows.push({ kind: 'barcode', h: 76 });
    return rows;
}

// Print units: what appears at one moment. Line mode: one per row. Word mode: one per word of a text row (the right
// column is its own unit after the row's words); headers, rules, footer and barcode are one unit each.
type Unit = { row: number; word: number; spoken: boolean };   // word -1 = the whole row
function buildUnits(rows: Row[], byWord: boolean) {
    const units: Unit[] = [];
    rows.forEach((r, i) => {
        if (byWord && r.kind === 'text') {
            (r.left || []).forEach((_, k) => units.push({ row: i, word: k, spoken: true }));
            if (r.right) units.push({ row: i, word: (r.left || []).length, spoken: true });
            if (!(r.left || []).length && !r.right) units.push({ row: i, word: -1, spoken: false });
        } else units.push({ row: i, word: -1, spoken: false });
    });
    return units;
}

function pace(units: Unit[], D: number, fps: number, enter: number, exit: number) {
    const start = Math.round(enter + 4);
    const end = Math.max(start + 1, D - exit - Math.round(fps * 0.6));
    const per = Math.max(2, Math.min(fps * 0.45, (end - start) / Math.max(1, units.length)));
    return { start, per };
}

export const ReceiptPrinter: React.FC<P> = (p) => {
    const rows = buildRows(p);
    const units = buildUnits(rows, !!p.byWord);
    const times = Array.isArray(p._times) && p._times.length && p.byWord ? p._times.map(Number).filter(Number.isFinite) : null;
    const { frame: warped, raw, fps, durationInFrames: D, inn, out } = useInOut(times ? { ...p, settle: 0 } : p, (D0, f) => {
        const { start, per } = pace(units, D0, f, p.enter ?? 10, p.exit ?? 8);
        return start + (units.length - 1) * per + FEED;
    });
    const frame = times ? raw : warped;
    const { start, per } = pace(units, D, fps, p.enter ?? 10, p.exit ?? 8);

    // when each unit prints: evenly paced, or spoken words on their own frames with the rest fitted between them
    const at: number[] = units.map((_, i) => start + i * per);
    if (times) {
        let w = 0;
        units.forEach((u, i) => { if (u.spoken && w < times.length) at[i] = times[w++]; });
        // units before the first spoken word run up to it; units after one follow it at a quick pace
        const firstSpoken = units.findIndex((u) => u.spoken);
        for (let i = firstSpoken - 1; i >= 0; i--) at[i] = Math.max(0, Math.min(start + i * 3, at[i + 1] - 3));
        for (let i = Math.max(1, firstSpoken + 1); i < units.length; i++) {
            if (!units[i].spoken) at[i] = at[i - 1] + 4;
            else if (at[i] < at[i - 1]) at[i] = at[i - 1] + 1;
        }
    }
    const rowStart = rows.map(() => 1e9);
    const unitAt = new Map<string, number>();
    for (let i = 0; i < units.length; i++) {
        const u = units[i];
        if (at[i] < rowStart[u.row]) rowStart[u.row] = at[i];
        const key = `${u.row}:${u.word}`;
        if (!unitAt.has(key)) unitAt.set(key, at[i]);
    }
    const shownAt = (ri: number, word: number) => {
        const t = unitAt.get(`${ri}:${word}`) ?? unitAt.get(`${ri}:-1`);
        return t === undefined ? rowStart[ri] : t;
    };

    // paper feed: each row slides out of the slot over FEED frames when its first unit prints
    const feedOf = (ri: number) => ease(clamp((frame - rowStart[ri]) / FEED));
    const TOP = 22;
    const fed = TOP + rows.reduce((s, r, ri) => s + r.h * feedOf(ri), 0);
    const total = TOP + rows.reduce((s, r) => s + r.h, 0) + 14;
    const paperH = Math.min(MAX_PAPER, fed);
    const scrolled = Math.max(0, fed - MAX_PAPER);
    const printing = units.some((_, i) => frame >= at[i] && frame < at[i] + per + FEED) && frame < at[at.length - 1] + FEED;
    const buzz = printing ? Math.sin(frame * 2.7) * 0.6 : 0;

    const ink = p.ink || '#1d1d1f', paper = p.paper || '#fbf8f1';
    const mark = Math.round(p.mark || 0);
    const rise = interpolate(inn, [0, 1], [120, 0]);
    const ys: number[] = []; rows.reduce((y, r) => { ys.push(y); return y + r.h; }, TOP);

    const zig = Array.from({ length: 24 }, (_, i) => `${(i / 23) * 100}% ${i % 2 ? 0 : 9}px`).join(', ');

    return (
        <Place p={p}>
            <div style={{ position: 'relative', width: 640, height: Math.min(MAX_PAPER, total) + 150, opacity: out * clamp(inn * 1.6),
                transform: `translateY(${rise}px)` }}>
                {/* the receipt, behind the printer, bottom at the slot */}
                <div style={{ position: 'absolute', left: (640 - PAPER_W) / 2, bottom: 150, width: PAPER_W, height: paperH + 8,
                    overflow: 'hidden', clipPath: `polygon(${zig}, 100% 100%, 0 100%)`, background: paper,
                    filter: 'drop-shadow(0 10px 24px rgba(0,0,0,.35))', transform: `translateX(${buzz}px)`,
                    WebkitMaskImage: scrolled > 0 ? 'linear-gradient(to bottom, transparent 0, #000 90px)' : undefined }}>
                    <div style={{ position: 'absolute', left: 0, right: 0, top: paperH - fed, height: total, fontFamily: FONT.mono, color: ink }}>
                        {rows.map((r, ri) => {
                            const y = ys[ri];
                            if (frame < rowStart[ri]) return null;
                            const base: React.CSSProperties = { position: 'absolute', left: PAD, right: PAD, top: y, height: r.h, display: 'flex', alignItems: 'center' };
                            if (r.kind === 'rule') return <div key={ri} style={{ ...base, borderTop: `2px dashed ${ink}`, height: 0, top: y + r.h / 2, opacity: 0.55 }} />;
                            if (r.kind === 'barcode') {
                                return (
                                    <div key={ri} style={{ ...base, justifyContent: 'center', alignItems: 'stretch', gap: 0, padding: '8px 30px 14px' }}>
                                        {Array.from({ length: 46 }, (_, i) => (
                                            <div key={i} style={{ width: [2, 4, 2, 6, 3][(i * 7 + 3) % 5], marginRight: [3, 2, 4, 2][(i * 5) % 4], background: ink }} />
                                        ))}
                                    </div>
                                );
                            }
                            const header = r.kind === 'header', centred = header || r.kind === 'sub' || r.kind === 'footer';
                            const marked = r.kind === 'text' && mark > 0 && r.item === mark - 1;
                            // line mode: the print head wipes the row left to right over ~3 frames
                            const wipe = p.byWord && r.kind === 'text' ? 1 : clamp((frame - rowStart[ri]) / 3);
                            const word = (w: string, k: number) => {
                                const t = shownAt(ri, k);
                                if (frame < t) return null;
                                return <span key={k} style={{ opacity: clamp((frame - t + 1) / 2) }}>{(k ? ' ' : '') + w}</span>;
                            };
                            const rightK = (r.left || []).length;
                            return (
                                <div key={ri} style={{ ...base, justifyContent: centred ? 'center' : 'space-between', whiteSpace: 'pre',
                                    fontSize: header ? 42 : r.kind === 'sub' ? 20 : FS, fontWeight: header || r.kind === 'footer' || marked ? 700 : 400,
                                    letterSpacing: header ? 1.5 : r.kind === 'sub' ? 2 : 0, opacity: r.kind === 'sub' ? 0.7 : 1,
                                    background: marked ? p.accent : 'transparent', margin: marked ? '0 -8px' : 0, padding: marked ? '0 8px' : 0,
                                    clipPath: wipe < 1 ? `inset(0 ${(1 - wipe) * 100}% 0 0)` : undefined }}>
                                    <span>{(r.left || []).map(word)}</span>
                                    {r.right ? (frame >= shownAt(ri, rightK) ? <span style={{ fontWeight: 700 }}>{r.right}</span> : null) : null}
                                </div>
                            );
                        })}
                    </div>
                    {/* the curl into the slot */}
                    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 26, background: 'linear-gradient(to top, rgba(0,0,0,.22), transparent)' }} />
                </div>
                {/* the printer */}
                <div style={{ position: 'absolute', left: 0, bottom: 0, width: 640, height: 158, borderRadius: 30,
                    background: 'linear-gradient(180deg, #34343a 0%, #222226 40%, #18181b 100%)',
                    boxShadow: '0 22px 50px rgba(0,0,0,.5), inset 0 2px 0 rgba(255,255,255,.12)' }}>
                    <div style={{ position: 'absolute', left: 50, right: 50, top: 14, height: 12, borderRadius: 6, background: '#0b0b0d',
                        boxShadow: 'inset 0 3px 4px rgba(0,0,0,.8), 0 1px 0 rgba(255,255,255,.08)' }} />
                    <div style={{ position: 'absolute', left: 40, bottom: 36, display: 'flex', alignItems: 'center', gap: 12,
                        fontFamily: FONT.mono, fontSize: 15, letterSpacing: 3, color: 'rgba(255,255,255,.45)' }}>
                        <div style={{ width: 14, height: 14, borderRadius: 14, background: p.accent,
                            opacity: printing ? (Math.floor(frame / 4) % 2 ? 1 : 0.45) : 0.9, boxShadow: `0 0 14px ${p.accent}` }} />
                        {printing ? 'PRINTING' : 'READY'}
                    </div>
                    <div style={{ position: 'absolute', right: 40, bottom: 30, width: 92, height: 30, borderRadius: 15, background: '#0f0f11',
                        boxShadow: 'inset 0 2px 3px rgba(0,0,0,.7)' }} />
                </div>
            </div>
        </Place>
    );
};
