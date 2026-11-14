// Green screen: the speaker is cut out of the room and put in front of another picture or video (or a lit stage when
// none is chosen); the bottom of the frame fades into darkness. Reads every frame of the footage (props._seq) for the
// cut-out; a video backdrop comes in as frames at the clip's rate (props._bg, src/main/broll-footage.js), looped.
import React from 'react';
import { Img, useVideoConfig } from 'remotion';
import { Common, Full, clamp, ease, prog, useInOut } from '../lib/common';
import { Speaker, bgFrame, bgOf, seqOf, speakerBox } from '../lib/footage';

type P = Common & { _seq?: unknown; _bg?: unknown; image: string; color: string; color2: string; fade: number; drift: number; speakerSize: number; rim: boolean };

export const GreenScreenStage: React.FC<P> = (p) => {
    const { frame, real, raw, durationInFrames: D } = useInOut(p, () => 8);
    const { height: H } = useVideoConfig();
    const seq = seqOf(p), b = speakerBox(seq), bg = bgOf(p);
    const k = ease(prog(frame, 0, 8)), t = raw / Math.max(1, D);
    const c1 = p.color || '#1b2a4a', c2 = p.color2 || '#0b0d14';
    const drift = 1.06 + (Number(p.drift) || 0) * t;
    const fade = clamp(Number(p.fade) || 0, 0, 0.9);
    const size = clamp(Number(p.speakerSize) || 1, 0.5, 1.6);
    const cover: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${drift})` };
    return (
        <Full p={p}>
            <div style={{ position: 'absolute', inset: 0, opacity: k, overflow: 'hidden', background: c2 }}>
                {bg ? <Img src={bgFrame(bg, real)} style={cover} />
                    : p.image ? <Img src={p.image} style={cover} />
                    : <>
                        <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse at ${b.cx * 100}% 38%, ${c1} 0%, ${c2} 72%)` }} />
                        {[-1, 1].map(d => <div key={d} style={{ position: 'absolute', left: `${b.cx * 100 + d * 34}%`, top: '-20%', width: '26%', height: '150%', marginLeft: '-13%',
                            background: `linear-gradient(180deg, ${p.accent}55, transparent 75%)`, transform: `rotate(${d * (16 + Math.sin(raw / 30) * 3)}deg)`, filter: `blur(${H * 0.03}px)`, transformOrigin: 'top center' }} />)}
                    </>}
            </div>
            <div style={{ position: 'absolute', inset: 0, transform: `scale(${size})`, transformOrigin: `${b.cx * 100}% ${Math.min(100, b.bottom * 100)}%`, opacity: clamp(frame / 2),
                filter: p.rim ? `drop-shadow(0 0 ${H * 0.012}px ${p.accent}88)` : 'none' }}><Speaker seq={seq} real={real} /></div>
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${fade * 100}%`, background: 'linear-gradient(180deg, transparent, rgba(0,0,0,.92))', opacity: k }} />
        </Full>
    );
};
