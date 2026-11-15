// Collage b-roll track: renders a range of a project's shots.json (beats in timeline frames) as one clip. Frame 0 of the
// clip is timeline frame `from`. Beats of visual "talking-head" draw nothing but their overlays (title), so a range
// that covers them stays transparent there and the speaker shows through; every other beat draws the dark backdrop
// and its card, medallion or stack, entering over the one before (which stays under it until the entrance is done).
// Pictures and video clips come from props._assets (a folder render.mjs links into the bundle) by file name.
import React from 'react';
import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig } from 'remotion';
import { brandOf, fontOf, type Brand } from './brand';
import { DepthScene, type DepthBeat } from './DepthScene';
import { Background, CardStack, DocumentCard, Medallion, PhotoCard, TitleCard, FILM_RAIL, fitBox, isHand, k01, settleScale, stepT, type Overlay } from './cards';

export type Beat = DepthBeat & {
    id: string; frames: [number, number]; visual: string; line?: string; assets?: string[]; overlays?: Overlay[]; drift?: string;
    illustration?: string; beatsAt?: { word: string; frame: number }[]; crop?: number[]; crops?: (number[] | null)[];
    highlights?: number[][]; highlightAt?: number; clipStart?: number;
    highlightAts?: number[];   // one start per highlight (frames from the beat start), each on its own word   // clipStart: a clip beat's in-point, seconds
    blurs?: number[][]; zoom?: number[] | null; zoomAt?: number; blurStrength?: number;          // document: blurred boxes, the zoom onto the highlights
    cols?: number; wallAts?: number[];   // wall: grid columns, each tile's landing frame (from the beat start)
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

    const hand = isHand(b);
    const fw = b.border === 'film' ? 2 * FILM_RAIL : 0;   // the film rails sit inside the same width as a plain card
    const layers: React.ReactNode[] = [];
    broll.forEach((x, i) => {
        const [a, e] = x.frames;
        const nx = broll[i + 1] && broll[i + 1].frames[0] <= e + 1 ? broll[i + 1] : null;   // the next card follows straight on
        // hand: a hard cut to the next card (no fade, no darkening under it); smooth: it stays under the entrance
        const hold = nx ? (hand ? nx.frames[0] : nx.frames[0] + b.enter + 6) : e;
        if (g < a || g >= hold) return;
        const t = stepT(g - a, b), D = e - a;   // hand: the drawing inside a beat moves on twos (stop motion)
        const fade = nx && !hand ? 1 - k01(g, nx.frames[0] + b.enter, nx.frames[0] + b.enter + 6) : 1;
        const dim = nx && !hand ? 1 - 0.25 * k01(g, nx.frames[0], nx.frames[0] + b.enter) : 1;
        const seed = i + 1 + x.id.length * 13 + Number(String(x.id).replace(/\D/g, '') || 0);
        const ov = x.overlays || [];
        const drift = hand ? 'none' : x.drift || 'push-in';   // hand: static holds
        let el: React.ReactNode = null;
        if (x.visual === 'photo') {
            const n = assetsOf(x)[0];
            el = <PhotoCard src={src(n)} box={fitBox(meta(n), x.crop, 860 - fw, 960)} crop={x.crop} t={t} D={D} seed={seed} b={b}
                from={FROM[i % FROM.length]} drift={drift} overlays={ov} />;
        } else if (x.visual === 'clip') {
            // a video clip (assets/<beat>-NN.mp4) in a photo card, playing from clipStart as the beat starts
            const n = assetsOf(x)[0];
            el = <PhotoCard src={src(n)} box={fitBox(meta(n), x.crop, 900 - fw, 960)} crop={x.crop} t={t} D={D} seed={seed} b={b}
                from={FROM[i % FROM.length]} drift={drift} overlays={ov}
                video={{ from: a - (p.from || 0), trim: Math.round((x.clipStart || 0) * fps) }} />;
        } else if (x.visual === 'stack') {
            const ns = assetsOf(x).slice(0, 4);
            el = <CardStack srcs={ns.map(src)} boxes={ns.map((n, k) => fitBox(meta(n), x.crops?.[k] || undefined, 760 - fw, 700))} t={t} D={D} seed={seed} b={b}
                drift={drift} overlays={ov} />;
        } else if (x.visual === 'document') {
            const n = assetsOf(x)[0];
            el = <DocumentCard src={src(n)} box={fitBox(meta(n), x.crop, 860 - fw, 1000)} crop={x.crop} rects={x.highlights || []}
                at={(x.highlightAts && x.highlightAts.length ? x.highlightAts : x.highlightAt) ?? 16} t={t} D={D} seed={seed} b={b} drift={drift} overlays={ov} blurs={x.blurs || []} zoom={x.zoom} zoomAt={x.zoomAt} blurStrength={x.blurStrength} />;
        } else if (x.visual === 'wall') {
            // a wall of pictures (many versions of the same thing): uniform 4:3 tiles in a grid, each landing on its own
            // frame (wallAts, frames from the beat start; default every 4 frames), hand: there at once and settling
            const ns = assetsOf(x), N = ns.length, cols = x.cols || (N > 6 ? 3 : 2), rows = Math.ceil(N / cols);
            const cw = 1010 / cols, ch = Math.min(cw * 0.75, 1180 / rows), gap = 12;
            const top = 780 - (rows * ch) / 2;
            const lab = ov.find((o) => o.type === 'label');
            el = <>
                {ns.map((n, k) => {
                    const at = x.wallAts?.[k] ?? k * 4;
                    if (t < at) return null;
                    const r = (q: number) => { const s = Math.sin((seed * 31.7 + k * 12.9 + q) * 43758.5453); return s - Math.floor(s); };
                    const tilt = (r(1) - 0.5) * 7, sc = hand ? settleScale(t - at, b) : 1 + 0.12 * (1 - k01(t, at, at + 6));
                    const row = Math.floor(k / cols), inRow = Math.min(cols, N - row * cols);
                    const left = 540 - (inRow * cw) / 2 + (k % cols) * cw + gap / 2 + (r(2) - 0.5) * 10;
                    return <div key={k} style={{ position: 'absolute', left, top: top + row * ch + gap / 2 + (r(3) - 0.5) * 10, width: cw - gap, height: ch - gap,
                        transform: `rotate(${tilt}deg) scale(${sc})`, background: b.cardBorder || '#efe4cc', padding: 7, boxSizing: 'border-box',
                        boxShadow: '0 14px 26px rgba(0,0,0,.5)', borderRadius: 3 }}>
                        <Img src={src(n)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    </div>;
                })}
                {lab && t >= (lab.at ?? 20) && (
                    <div style={{ position: 'absolute', left: 540, top: top + rows * ch + 26, transform: `translateX(-50%) rotate(-2deg) scale(${hand ? settleScale(t - (lab.at ?? 20), { ...b, settleFrames: 4 }) : 1})`,
                        background: b.labelBg, color: b.labelInk, fontFamily: fontOf(b, 'sans'), fontWeight: 800, fontSize: 46, letterSpacing: 3,
                        padding: '12px 26px', borderRadius: 4, boxShadow: '0 8px 18px rgba(0,0,0,.45)', whiteSpace: 'nowrap' }}>{lab.text}</div>
                )}
            </>;
        } else if (x.visual === 'medallion') {
            const at = (x.beatsAt || []).map((w) => w.frame - a);
            const n = assetsOf(x)[0], m = meta(n);   // a cut-out photo (the real suit) drawn instead of the drawn figure
            el = <Medallion name={x.illustration || ''} t={t} D={D} at={at} b={b} seed={seed} drift={drift} uid={`m-${x.id}`}
                img={n ? src(n) : undefined} imgAspect={m ? m.w / m.h : undefined} anchors={n ? p.assetAnchors?.[n] : undefined} />;
        } else if (x.visual === 'depth') {
            // layered picture + parallax camera + typed paper strips + ambient motion (DepthScene.tsx); its own timing:
            // the camera glides on every frame, the puppets inside move on twos
            el = <DepthScene beat={x} t={g - a} D={D} b={b} src={src} H={H} seed={seed} />;
        } else if (x.visual === 'title') {
            // episode card on the backdrop: the title overlay's text, a little larger, centred where the cards sit
            const o = ov.find((y) => y.type === 'title') || { type: 'title' as const, text: x.line || '' };
            const sc = hand ? 1.2 * settleScale(t, b) : 1.2 + b.drift * Math.min(1, t / Math.max(1, D));
            el = <div style={{ position: 'absolute', inset: 0, transform: `scale(${sc})`, transformOrigin: '540px 780px' }}>
                <TitleCard text={o.text || ''} sub={o.sub} t={t} at={o.at ?? 2} until={D + 99} b={b} cy={780 - 110} />
            </div>;
        }
        layers.push(<div key={x.id} style={{ position: 'absolute', inset: 0, opacity: fade, filter: dim < 1 ? `brightness(${dim})` : undefined }}>{el}</div>);
    });

    const titles = beats.filter((x) => x.visual === 'talking-head' && g >= x.frames[0] && g < x.frames[1]).flatMap((x) =>
        (x.overlays || []).filter((o) => o.type === 'title').map((o, k) => (
            <TitleCard key={x.id + k} text={o.text || ''} sub={o.sub} t={stepT(g - x.frames[0], b)} at={o.at ?? 10}
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
