// Viewfinder zoom: a camcorder HUD over the frame: corner brackets, a blinking REC dot, a running timecode, a ruler
// and a zoom readout that ticks up. (The push-in itself is done on the footage: Effect presets > Transform.)
import React from 'react';
import { useVideoConfig } from 'remotion';
import { Common, FONT, Full, clamp, ease, prog, useInOut, useUnit } from '../lib/common';
import { Footage, seqOf } from '../lib/footage';

type P = Common & { pushIn?: boolean; _seq?: unknown; zoomFrom: number; zoomTo: number; label: string; color: string; grid: boolean; margin: number };

const pad = (n: number, l = 2) => String(Math.floor(n)).padStart(l, '0');

export const ViewfinderZoom: React.FC<P> = (p) => {
    const { frame, raw, real, fps, durationInFrames: D } = useInOut(p, (D0) => Math.max(8, Math.round(D0 * 0.7)));
    const seq = p.pushIn ? seqOf(p) : null;
    const { width: W, height: H } = useVideoConfig();
    const u = useUnit() * (p.scale || 1);
    const c = p.color || '#ffffff';
    const m = clamp(Number(p.margin) || 0.06, 0.01, 0.3) * Math.min(W, H), L = 70 * u, sw = 5 * u;
    const on = clamp(frame / 3) * (frame < 6 ? (frame % 2 ? 0.4 : 1) : 1);       // flickers on
    const zk = ease(prog(frame, 2, Math.max(8, Math.round(D * 0.7))));
    const zoom = (Number(p.zoomFrom) || 1) + ((Number(p.zoomTo) || 1.3) - (Number(p.zoomFrom) || 1)) * zk;
    const t = raw / fps, tc = `${pad(t / 3600)}:${pad((t / 60) % 60)}:${pad(t % 60)}:${pad(raw % fps)}`;
    const corner = (x: number, y: number, dx: number, dy: number) => `M ${x} ${y + dy * L} L ${x} ${y} L ${x + dx * L} ${y}`;
    const txt: React.CSSProperties = { position: 'absolute', fontFamily: FONT.mono, fontWeight: 700, fontSize: 30 * u, color: c, textShadow: `0 ${2 * u}px ${6 * u}px rgba(0,0,0,.6)`, whiteSpace: 'nowrap' };
    const rulerW = W * 0.34, rx = W / 2 - rulerW / 2, ry = H - m - 24 * u;
    return (
        <Full p={p} style={seq ? undefined : { opacity: on }}>
            {/* Push in: the footage itself, punched in by the zoom the readout shows */}
            {seq && <Footage seq={seq} real={real} style={{ transform: `scale(${zoom})`, transformOrigin: `${clamp(p.x ?? 0.5) * 100}% ${clamp(p.y ?? 0.5) * 100}%` }} />}
            <svg width={W} height={H} style={{ position: 'absolute', inset: 0, filter: `drop-shadow(0 ${2 * u}px ${4 * u}px rgba(0,0,0,.5))` }} fill="none" stroke={c} strokeWidth={sw} strokeLinecap="square">
                <path d={corner(m, m, 1, 1)} /><path d={corner(W - m, m, -1, 1)} /><path d={corner(m, H - m, 1, -1)} /><path d={corner(W - m, H - m, -1, -1)} />
                <path d={`M ${W / 2 - 22 * u} ${H / 2} L ${W / 2 + 22 * u} ${H / 2} M ${W / 2} ${H / 2 - 22 * u} L ${W / 2} ${H / 2 + 22 * u}`} strokeWidth={sw * 0.6} />
                {p.grid && <path d={`M ${W / 3} ${m} L ${W / 3} ${H - m} M ${W * 2 / 3} ${m} L ${W * 2 / 3} ${H - m} M ${m} ${H / 3} L ${W - m} ${H / 3} M ${m} ${H * 2 / 3} L ${W - m} ${H * 2 / 3}`} strokeWidth={u * 1.5} opacity={0.35} />}
                <g strokeWidth={u * 2.5}>
                    {Array.from({ length: 31 }, (_, i) => <line key={i} x1={rx + (rulerW * i) / 30} x2={rx + (rulerW * i) / 30} y1={ry} y2={ry - (i % 5 ? 12 : 24) * u} />)}
                </g>
                <path d={`M ${rx + rulerW * clamp((zoom - 1) / 1)} ${ry + 8 * u} l ${-10 * u} ${16 * u} l ${20 * u} 0 Z`} fill={p.accent} stroke="none" />
            </svg>
            <div style={{ ...txt, left: m + 26 * u, top: m + 22 * u, display: 'flex', alignItems: 'center', gap: 12 * u }}>
                <div style={{ width: 22 * u, height: 22 * u, borderRadius: 22 * u, background: '#ff3b30', opacity: Math.floor(raw / (fps / 2)) % 2 ? 0.25 : 1 }} />REC
            </div>
            <div style={{ ...txt, right: m + 26 * u, top: m + 22 * u }}>{tc}</div>
            <div style={{ ...txt, left: m + 26 * u, bottom: m + 20 * u }}>{p.label}</div>
            <div style={{ ...txt, right: m + 26 * u, bottom: m + 20 * u, color: p.accent, fontSize: 38 * u }}>{zoom.toFixed(2)}x</div>
        </Full>
    );
};
