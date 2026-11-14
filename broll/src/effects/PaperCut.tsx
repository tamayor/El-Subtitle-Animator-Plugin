// Paper cut: the speaker is cut out of the shot with a white torn-paper edge and laid on a sheet of grid paper taped
// to a dark backdrop, with a ransom-note label. Reads every frame of the footage (props._seq, lib/footage.tsx), so
// the speaker keeps moving inside the cut-out.
import React from 'react';
import { spring, useVideoConfig } from 'remotion';
import { Common, Full, clamp, prog, useInOut, useUnit } from '../lib/common';
import { Speaker, seqOf, speakerBox } from '../lib/footage';
import { Grain, PAPER, Tape, TornFilter, tornClip } from '../lib/paper';
import { RansomText } from './RansomText';

type P = Common & { _seq?: unknown; label: string; labelY: number; paper: string; backdrop: string; border: number; grid: boolean; tape: boolean; tilt: number };

export const PaperCut: React.FC<P> = (p) => {
    const { frame, real, fps } = useInOut(p, () => 12);
    const { width: W, height: H } = useVideoConfig();
    const u = useUnit();
    const seq = seqOf(p), b = speakerBox(seq);
    const s = spring({ frame, fps, config: { damping: 13, stiffness: 190, mass: 0.8 } });
    const edge = spring({ frame: frame - 3, fps, config: { damping: 14, stiffness: 160 } });
    // the sheet: the speaker's box with room around it, never past the frame
    const m = 0.07, sx = Math.max(0.03, b.x - m), sy = Math.max(0.04, b.top - m), sw = Math.min(0.97, b.x + b.w + m) - sx, sh = 1.02 - sy;
    const cell = 46 * u, line = 'rgba(60,90,150,.22)';
    return (
        <Full p={p}>
            <div style={{ position: 'absolute', inset: 0, background: p.backdrop || '#17181c', opacity: clamp(frame / 3) }} />
            <div style={{ position: 'absolute', left: sx * W, top: sy * H, width: sw * W, height: sh * H, transformOrigin: 'center 30%',
                transform: `scale(${1.25 - s * 0.25}) rotate(${(Number(p.tilt) || 0) + (1 - s) * 7}deg)`, opacity: clamp(s * 3), filter: `drop-shadow(0 ${16 * u}px ${24 * u}px rgba(0,0,0,.5))` }}>
                <div style={{ position: 'absolute', inset: 0, background: p.paper || PAPER.grid, clipPath: tornClip(5, { left: true, right: true, bottom: false, depth: 1.6, teeth: 30 }),
                    backgroundImage: p.grid ? `linear-gradient(${line} ${2 * u}px, transparent ${2 * u}px), linear-gradient(90deg, ${line} ${2 * u}px, transparent ${2 * u}px)` : 'none', backgroundSize: `${cell}px ${cell}px` }}>
                    <Grain id="pcg" opacity={0.22} />
                </div>
                {p.tape && <><Tape left="16%" top={6 * u} width={150 * u} angle={-14} /><Tape left="84%" top={6 * u} width={150 * u} angle={11} /></>}
            </div>
            <svg width={0} height={0} style={{ position: 'absolute' }}><defs><TornFilter id="pct" width={Math.max(1, (Number(p.border) || 14) * u * edge)} rough={12 * u} /></defs></svg>
            <div style={{ position: 'absolute', inset: 0, filter: 'url(#pct)', opacity: clamp(frame / 2) }}><Speaker seq={seq} real={real} /></div>
            {p.label && prog(frame, 6, 7) > 0 && <RansomText {...(p as any)} text={p.label} x={0.5} y={clamp(p.labelY ?? 0.86)} scale={(p.scale || 1) * 0.62} delay={(p.delay || 0) + 6} settle={0} fitIn={false}
                _times={undefined} byWord={false} size={120} seed={3} useAccent />}
        </Full>
    );
};
