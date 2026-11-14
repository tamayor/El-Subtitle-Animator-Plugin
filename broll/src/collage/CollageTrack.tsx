// Collage b-roll track: renders a range of a project's shots.json (beats in timeline frames) as one clip. Frame 0 of the
// clip is timeline frame `from`. Beats of visual "talking-head" draw nothing but their overlays (title), so a range
// that covers them stays transparent there and the speaker shows through; every other beat draws the dark backdrop
// and its card, medallion or stack, entering over the one before (which stays under it until the entrance is done).
// Pictures and video clips come from props._assets (a folder render.mjs links into the bundle) by file name.
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { brandOf, type Brand } from './brand';
import { Background, CardStack, DocumentCard, Medallion, PhotoCard, TitleCard, fitBox, k01, type Overlay } from './cards';

export type Beat = {
    id: string; frames: [number, number]; visual: string; line?: string; assets?: string[]; overlays?: Overlay[]; drift?: string;
    illustration?: string; beatsAt?: { word: string; frame: number }[]; crop?: number[]; crops?: (number[] | null)[];
    highlights?: number[][]; highlightAt?: number; clipStart?: number;   // clipStart: a clip beat's in-point, seconds
    blurs?: number[][]; zoom?: number[] | null; zoomAt?: number; blurStrength?: number;          // document: blurred boxes, the zoom onto the highlights
};
export type CollageProps = {
    beats: Beat[]; from: number; assetMeta?: Record<string, { w: number; h: number }>; _assets?: { url: string };
    assetAnchors?: Record<string, Record<string, any>>;   // per cut-out photo: neck / shoulderY / cuffY / armL / armR (0..1)
    brand?: Partial<Brand>; titleY?: number; _w?: number; _h?: number; _fps?: number; _frames?: number;
};

const FROM: ('right' | 'bottom' | 'left')[] = ['right', 'bottom', 'left'];
// A beat keeps its pictures and its clip when its visual changes: a clip beat plays its video, the others use pictures.
const VIDEO = /\.(mp4|webm|mov)$/i;
const assetsOf = (x: Beat) => (x.assets || []).filter((n) => (x.visual === 'clip') === VIDEO.test(n));

export const CollageTrack: React.FC<CollageProps> = (p) => {
    const frame = useCurrentFrame();
    const { width, height, fps } = useVideoConfig();
    const b = brandOf(p);
    const u = width / 1080, H = height / u;
    const g = (p.from || 0) + frame;
    const src = (n?: string) => (n && p._assets?.url ? `/${p._assets.url}/${encodeURIComponent(n)}` : '');
    const meta = (n?: string) => (n ? p.assetMeta?.[n] : undefined);
    const beats = [...(p.beats || [])].sort((x, y) => x.frames[0] - y.frames[0]);
    const broll = beats.filter((x) => x.visual !== 'talking-head');
    const onBroll = broll.some((x) => g >= x.frames[0] && g < x.frames[1]);

    const layers: React.ReactNode[] = [];
    broll.forEach((x, i) => {
        const [a, e] = x.frames;
        const nx = broll[i + 1] && broll[i + 1].frames[0] <= e + 1 ? broll[i + 1] : null;   // the next card follows straight on
        const hold = nx ? nx.frames[0] + b.enter + 6 : e;
        if (g < a || g >= hold) return;
        const t = g - a, D = e - a;
        const fade = nx ? 1 - k01(g, nx.frames[0] + b.enter, nx.frames[0] + b.enter + 6) : 1;
        const dim = nx ? 1 - 0.25 * k01(g, nx.frames[0], nx.frames[0] + b.enter) : 1;
        const seed = i + 1 + x.id.length * 13 + Number(String(x.id).replace(/\D/g, '') || 0);
        const ov = x.overlays || [];
        const drift = x.drift || 'push-in';
        let el: React.ReactNode = null;
        if (x.visual === 'photo') {
            const n = assetsOf(x)[0];
            el = <PhotoCard src={src(n)} box={fitBox(meta(n), x.crop, 860, 960)} crop={x.crop} t={t} D={D} seed={seed} b={b}
                from={FROM[i % FROM.length]} drift={drift} overlays={ov} />;
        } else if (x.visual === 'clip') {
            // a video clip (assets/<beat>-NN.mp4) in a photo card, playing from clipStart as the beat starts
            const n = assetsOf(x)[0];
            el = <PhotoCard src={src(n)} box={fitBox(meta(n), x.crop, 900, 960)} crop={x.crop} t={t} D={D} seed={seed} b={b}
                from={FROM[i % FROM.length]} drift={drift} overlays={ov}
                video={{ from: a - (p.from || 0), trim: Math.round((x.clipStart || 0) * fps) }} />;
        } else if (x.visual === 'stack') {
            const ns = assetsOf(x).slice(0, 4);
            el = <CardStack srcs={ns.map(src)} boxes={ns.map((n, k) => fitBox(meta(n), x.crops?.[k] || undefined, 760, 700))} t={t} D={D} seed={seed} b={b}
                drift={drift} overlays={ov} />;
        } else if (x.visual === 'document') {
            const n = assetsOf(x)[0];
            el = <DocumentCard src={src(n)} box={fitBox(meta(n), x.crop, 860, 1000)} crop={x.crop} rects={x.highlights || []}
                at={x.highlightAt ?? 16} t={t} D={D} seed={seed} b={b} drift={drift} overlays={ov} blurs={x.blurs || []} zoom={x.zoom} zoomAt={x.zoomAt} blurStrength={x.blurStrength} />;
        } else if (x.visual === 'medallion') {
            const at = (x.beatsAt || []).map((w) => w.frame - a);
            const n = assetsOf(x)[0], m = meta(n);   // a cut-out photo (the real suit) drawn instead of the drawn figure
            el = <Medallion name={x.illustration || ''} t={t} D={D} at={at} b={b} seed={seed} drift={drift} uid={`m-${x.id}`}
                img={n ? src(n) : undefined} imgAspect={m ? m.w / m.h : undefined} anchors={n ? p.assetAnchors?.[n] : undefined} />;
        } else if (x.visual === 'title') {
            // episode card on the backdrop: the title overlay's text, a little larger, centred where the cards sit
            const o = ov.find((y) => y.type === 'title') || { type: 'title' as const, text: x.line || '' };
            el = <div style={{ position: 'absolute', inset: 0, transform: `scale(${1.2 + b.drift * Math.min(1, t / Math.max(1, D))})`, transformOrigin: '540px 780px' }}>
                <TitleCard text={o.text || ''} sub={o.sub} t={t} at={o.at ?? 2} until={D + 99} b={b} cy={780 - 110} />
            </div>;
        }
        layers.push(<div key={x.id} style={{ position: 'absolute', inset: 0, opacity: fade, filter: dim < 1 ? `brightness(${dim})` : undefined }}>{el}</div>);
    });

    const titles = beats.filter((x) => x.visual === 'talking-head' && g >= x.frames[0] && g < x.frames[1]).flatMap((x) =>
        (x.overlays || []).filter((o) => o.type === 'title').map((o, k) => (
            <TitleCard key={x.id + k} text={o.text || ''} sub={o.sub} t={g - x.frames[0]} at={o.at ?? 10}
                until={(o as any).until ?? x.frames[1] - x.frames[0] - 8} b={b} cy={(p.titleY ?? 0.58) * H} />
        )));

    return (
        <AbsoluteFill style={{ backgroundColor: 'transparent', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, width: 1080, height: H, transform: `scale(${u})`, transformOrigin: 'left top' }}>
                {onBroll && <Background b={b} H={H} />}
                {onBroll && layers}
                {titles}
            </div>
        </AbsoluteFill>
    );
};
