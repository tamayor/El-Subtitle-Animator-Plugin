// The footage inside an effect (hidden props from src/main/broll-footage.js, see there):
//   props._seq = { url, count, first, cut, full, w, h, box, headTop, cx }: the frames of the clip's own range as pictures,
//   <url>/c00000.png ... = the speaker cut out (Spotlight's matte engine), <url>/f00000.jpg ... = the full frames,
//   <url>/p00000.jpg ... = the room with the speaker filled in from around them (the clean plate).
//   props._bg = { url, count }: a video backdrop's frames, <url>/b00000.jpg ..., one per clip frame (looped).
// Drawing the cut-out over a layer puts that layer BEHIND the speaker (the cut-out is the same pixels as the footage
// under the overlay); drawing the full frame lets an effect scale, tint or frame the picture itself.
import React from 'react';
import { Img } from 'remotion';
import { clamp } from './common';

export type Seq = { url: string; count: number; first?: number; cut?: boolean; full?: boolean; plate?: boolean; w: number; h: number;
    box?: number[] | null; headTop?: number | null; cx?: number | null };

export function seqOf(p: { _seq?: unknown }): Seq | null {
    const s = p._seq as Seq | undefined;
    return s && typeof s.url === 'string' && s.count > 0 ? s : null;
}
// Where the speaker is (0..1 of the frame); a centred guess without a matte, so previews still lay out.
export function speakerBox(s: Seq | null) {
    const b = s && Array.isArray(s.box) && s.box.length === 4 ? s.box : [0.3, 0.16, 0.4, 0.84];
    return { x: b[0], y: b[1], w: b[2], h: b[3], cx: s && Number.isFinite(Number(s.cx)) ? Number(s.cx) : b[0] + b[2] / 2,
        top: s && Number.isFinite(Number(s.headTop)) ? Number(s.headTop) : b[1], bottom: Math.min(1, b[1] + b[3]) };
}
const name = (s: Seq, real: number, kind: 'c' | 'f' | 'p') =>
    `/${s.url}/${kind}${String(clamp(Math.round(real) - (s.first || 0), 0, s.count - 1)).padStart(5, '0')}.${kind === 'c' ? 'png' : 'jpg'}`;
const fill: React.CSSProperties = { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', display: 'block' };

// The speaker cut out of clip frame `real`, filling its parent (which is the frame, or a scaled copy of it).
export const Speaker: React.FC<{ seq: Seq | null; real: number; style?: React.CSSProperties }> = ({ seq, real, style }) =>
    seq && seq.cut ? <Img src={name(seq, real, 'c')} style={{ ...fill, ...style }} /> : <Silhouette style={style} />;

// The whole picture of clip frame `real`.
export const Footage: React.FC<{ seq: Seq | null; real: number; style?: React.CSSProperties }> = ({ seq, real, style }) =>
    seq && seq.full ? <Img src={name(seq, real, 'f')} style={{ ...fill, objectFit: 'cover', ...style }} />
        : <div style={{ ...fill, background: 'linear-gradient(160deg, #5d6b7a, #8a8f86 55%, #b7a58c)', ...style }} />;

// The room without the speaker (the clean plate) at clip frame `real`; the whole frame when there is no plate.
export const Plate: React.FC<{ seq: Seq | null; real: number; style?: React.CSSProperties }> = ({ seq, real, style }) =>
    seq && seq.plate ? <Img src={name(seq, real, 'p')} style={{ ...fill, objectFit: 'cover', ...style }} /> : <Footage seq={seq} real={real} style={style} />;

// A video backdrop (props._bg) at clip frame `real`, or null when there is none.
export type Bg = { url: string; count: number };
export function bgOf(p: { _bg?: unknown }): Bg | null {
    const b = p._bg as Bg | undefined;
    return b && typeof b.url === 'string' && b.count > 0 ? b : null;
}
export const bgFrame = (b: Bg, real: number) => `/${b.url}/b${String(((Math.round(real) % b.count) + b.count) % b.count).padStart(5, '0')}.jpg`;

// What stands where the speaker goes when there is no footage (the effect's thumbnail, a preview without a timeline).
export const Silhouette: React.FC<{ style?: React.CSSProperties }> = ({ style }) => (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ ...fill, ...style }}>
        <ellipse cx={50} cy={34} rx={11} ry={14} fill="#d9b594" />
        <path d="M39 30 C38 16 62 16 61 30 C58 23 42 23 39 30 Z" fill="#3a2a20" />
        <path d="M30 100 C30 62 40 52 50 52 C60 52 70 62 70 100 Z" fill="#3d5a80" />
    </svg>
);
