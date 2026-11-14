// Vertigo: a dolly-zoom. The speaker and the room change size against each other while the room shifts to a cooler
// tint. Reads every frame of the footage (props._seq).
//   Room grows (the real dolly zoom): the speaker stays put and the room behind them stretches. The room is the clean
//     plate (the speaker filled in from the room around them, subject_matte.py), so nothing of the speaker is left in
//     it to show as a halo when it grows. "Room shrinks" runs it the other way (dolly in, zoom out).
//   Speaker grows: the cut-out grows over the frames, the room moves much less (the look before the plate existed).
import React from 'react';
import { useVideoConfig } from 'remotion';
import { Common, Full, clamp, ease, prog, useInOut } from '../lib/common';
import { Footage, Plate, Speaker, seqOf, speakerBox } from '../lib/footage';

type P = Common & { _seq?: unknown; move: string; reverse: boolean; amount: number; room: number; tint: string; tintStrength: number; blur: number; vignette: number };

export const VertigoDolly: React.FC<P> = (p) => {
    const { frame, real, durationInFrames: D } = useInOut(p, (D0) => Math.max(8, D0 - 1));
    const { height: H } = useVideoConfig();
    const seq = seqOf(p), b = speakerBox(seq);
    const k = ease(prog(frame, 0, Math.max(8, D - 1)));
    const amount = clamp(Number(p.amount) || 0.18, 0, 0.6);
    const speakerMode = p.move === 'Speaker grows';
    // the room's scale: Speaker grows = a small push (room <= amount); Room grows = the full amount, or from it back to 1
    const roomScale = speakerMode ? 1 + clamp(Number(p.room) || 0, 0, amount) * k : p.reverse ? 1 + amount * (1 - k) : 1 + amount * k;
    const speakerScale = speakerMode ? 1 + amount * k : 1;
    // the room grows round the speaker's head, so the head stays where it is while the wall rushes past it
    const origin = speakerMode ? `${b.cx * 100}% ${Math.min(100, b.bottom * 100)}%` : `${b.cx * 100}% ${clamp(b.top + b.h * 0.18) * 100}%`;
    const tint = p.tint || '#2f5fd0', ts = clamp(Number(p.tintStrength) || 0, 0, 0.8) * k;
    return (
        <Full p={p}>
            <div style={{ position: 'absolute', inset: 0, transform: `scale(${roomScale})`, transformOrigin: origin, filter: `blur(${(Number(p.blur) || 0) * k * H / 1080}px)` }}>
                {speakerMode ? <Footage seq={seq} real={real} /> : <Plate seq={seq} real={real} />}
            </div>
            <div style={{ position: 'absolute', inset: 0, background: tint, opacity: ts, mixBlendMode: 'soft-light' }} />
            <div style={{ position: 'absolute', inset: 0, background: tint, opacity: ts * 0.28 }} />
            <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse at ${b.cx * 100}% 45%, transparent 35%, rgba(0,0,0,${clamp(Number(p.vignette) || 0) * k}) 100%)` }} />
            <div style={{ position: 'absolute', inset: 0, transform: `scale(${speakerScale})`, transformOrigin: origin }}><Speaker seq={seq} real={real} /></div>
        </Full>
    );
};
