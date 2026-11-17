// Talk accent (Before 2028, from Ep. 11, user 2026-11-17: "add animated minimalist overlay to all active speaking shot ...
// either word text emphasis in the portion or something related doodle about being spoken"; then "give it a riso vibe").
// Over a talking-head shot, in the empty space above the speaker's head: ONE key word of the line printed riso-style (ink
// EB Garamond italic on a cream paper strip, a strawberry plate printed out of register behind it, soy-ink mottling and
// paper tooth on every ink) cut in on its spoken frame and settling 110 % -> 100 %, plus an optional pen mark (underline /
// circle) and ONE flat riso doodle that acts the line out (ghost, cycle arrows, speech bubble, hearts, a hanging tarp,
// flood waves, the word fading away), shaded with halftone dots, its second ink misregistered. Use with `hand: true`
// (stop motion on twos + line boil). Positions are in a 1080 x 1920 design frame (`cx`, `cy` = the word's centre / baseline).
import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { FONT, clamp, ease } from '../lib/common';
import { draw, roughEllipse, roughLine } from '../lib/doodle';

const INK = '#1c2738', CREAM = '#efe4cc', STRAW = '#c7385a', MATCHA = '#3f7f45';
const HEART = 'M0 34 C-42 6 -40 -34 -17 -34 C-6 -34 0 -26 0 -19 C0 -26 6 -34 17 -34 C40 -34 42 6 0 34 Z';
const GHOST = 'M-48 40 L-48 -14 C-48 -48 -24 -70 0 -70 C24 -70 48 -48 48 -14 L48 40 L32 26 L16 40 L0 26 L-16 40 L-32 26 Z';
const MIS = { x: 9, y: 7 };   // the second plate's misregistration

type P = { word?: string; wordAt?: number; size?: number; cx?: number; cy?: number; mark?: string; markAt?: number;
    doodle?: string; doodleAt?: number; color?: string; strip?: boolean; border?: boolean | string };

const settle = (t: number) => (t < 0 ? 0 : 1.1 - 0.1 * ease(clamp(Math.floor(t / 2) * 2 / 8)));

// Riso defs: the soy-ink mottle + paper tooth (knocks speckles and soft patches out of every ink) and halftone dots.
// The noise seed changes every 4 frames, like the line boil, so the print "breathes" on twos.
const Defs: React.FC<{ seed: number }> = ({ seed }) => (
    <defs>
        <filter id="ta-riso" x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={seed} result="tooth" />
            <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves={2} seed={seed + 40} result="mottle" />
            <feColorMatrix in="tooth" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -3.4 3.15" result="t" />
            <feColorMatrix in="mottle" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.6 1.22" result="m" />
            <feComposite in="t" in2="m" operator="arithmetic" k1={1} result="mask" />
            <feComposite in="SourceGraphic" in2="mask" operator="in" />
        </filter>
        <pattern id="ta-dots" width={10} height={10} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <circle cx={5} cy={5} r={2.6} fill={INK} />
        </pattern>
    </defs>
);

export const TalkAccent: React.FC<P> = (p) => {
    const f = useCurrentFrame();
    const { width, height } = useVideoConfig();
    const word = String(p.word ?? ''), size = Number(p.size) || 112;
    const cx = Number(p.cx ?? 540), cy = Number(p.cy ?? 330);
    const wAt = Number(p.wordAt) || 0, mAt = p.markAt === undefined ? wAt + 6 : Number(p.markAt), dAt = p.doodleAt === undefined ? wAt : Number(p.doodleAt);
    const doodle = String(p.doodle || 'none'), mark = String(p.mark || 'none');
    const tw = Math.max(size, word.length * size * 0.43);           // EB Garamond italic: ~0.43 em per letter
    const tW = f - wAt, tM = f - mAt, tD = f - dAt;
    const k = settle(tW);
    const borderMode = p.border === true ? 'riso' : (p.border && p.border !== 'none' ? String(p.border) : 'none');
    const boxed = doodle === 'bubble' || doodle === 'tarp';
    const strip = p.strip !== false && !boxed;
    const letters = word.split('');
    const gone = (i: number) => doodle === 'fade' && tD >= 0 && tD >= 10 + i * 3;   // letters vanish one by one
    const midY = cy - size * 0.32;
    const text = (dx: number, dy: number, color: string) => (
        <text x={cx + dx} y={cy + dy} textAnchor="middle" fontFamily={FONT.garamondItalic} fontWeight={600} fontSize={size} fill={color}>
            {letters.map((c, i) => <tspan key={i} opacity={gone(i) ? 0 : 1}>{c}</tspan>)}
        </text>
    );
    // the cream strip the word is printed on: slightly tilted, its strawberry block out of register, halftone on the lower part
    const sx = cx - tw / 2 - 38, sy = cy - size * 0.98, sw = tw + 76, sh = size * 1.28;
    const R = { filter: 'url(#ta-riso)' };
    return (
        <svg width={width} height={height} viewBox="0 0 1080 1920" style={{ position: 'absolute', inset: 0 }}>
            <Defs seed={1 + (Math.floor(f / 4) % 6)} />
            {borderMode !== 'none' && <RisoBorder mode={borderMode} frame={f} />}
            {/* doodles printed behind the word */}
            {doodle === 'bubble' && tD >= 0 && (
                <g transform={`translate(${cx} ${midY}) scale(${settle(tD)}) translate(${-cx} ${-midY})`}>
                    <path d={bubble(cx, midY, tw / 2 + 50, size * 0.72)} fill={STRAW} transform={`translate(${MIS.x + 3} ${MIS.y + 3})`} {...R} />
                    <path d={bubble(cx, midY, tw / 2 + 50, size * 0.72)} fill={CREAM} {...R} />
                    <rect x={cx - tw / 2 - 50} y={midY + size * 0.2} width={tw + 100} height={size * 0.52} fill="url(#ta-dots)" opacity={0.18} />
                    <path d={bubble(cx, midY, tw / 2 + 50, size * 0.72)} fill="none" stroke={INK} strokeWidth={6} strokeLinejoin="round" {...R} />
                </g>
            )}
            {doodle === 'tarp' && tD >= 0 && (() => {
                const w = tw + 120, h = size * 1.5, x0 = cx - w / 2, y0 = cy - size * 1.0, sway = Math.sin(Math.floor(f / 4) * 1.3) * 1.5;
                return (
                    <g transform={`rotate(${sway} ${cx} ${y0 - 120})`}>
                        <line x1={x0 + 30} y1={y0} x2={x0 + 10} y2={y0 - 120} stroke={CREAM} strokeWidth={6} {...R} />
                        <line x1={x0 + w - 30} y1={y0} x2={x0 + w - 10} y2={y0 - 120} stroke={CREAM} strokeWidth={6} {...R} />
                        <rect x={x0} y={y0} width={w} height={h} fill={STRAW} transform={`translate(${MIS.x + 3} ${MIS.y + 3})`} {...R} />
                        <rect x={x0} y={y0} width={w} height={h} fill={CREAM} {...R} />
                        <rect x={x0 + w * 0.62} y={y0} width={w * 0.38} height={h} fill="url(#ta-dots)" opacity={0.2} />
                        {Array.from({ length: Math.floor(w / 46) }, (_, i) => (
                            <polygon key={i} points={`${x0 + 8 + i * 46},${y0 + 8} ${x0 + 46 + i * 46},${y0 + 8} ${x0 + 27 + i * 46},${y0 + 44}`}
                                fill={[STRAW, MATCHA, INK][i % 3]} opacity={i * 2 <= tD ? 1 : 0} {...R} />
                        ))}
                    </g>
                );
            })()}
            {doodle === 'cycle' && tD >= 0 && (() => {
                const rx = tw / 2 + 105, ry = size * 1.2, rot = Math.floor(tD / 2) * 4;
                const arc = (a0: number) => {
                    const pts = Array.from({ length: 13 }, (_, i) => { const a = (a0 + i * 11) * Math.PI / 180; return [cx + Math.cos(a) * rx, midY + Math.sin(a) * ry]; });
                    const [ex, ey] = pts[12], [px, py] = pts[11], ang = Math.atan2(ey - py, ex - px);
                    const head = [ang + 2.6, ang - 2.6].map((b) => `M${ex} ${ey} L${ex + Math.cos(b) * 36} ${ey + Math.sin(b) * 36}`).join(' ');
                    return 'M' + pts.map((q) => q.join(' ')).join(' L') + ' ' + head;
                };
                const k2 = clamp(tD / 10);
                return [0, 180].map((a0, i) => <g key={i}>
                    <path d={arc(a0 + rot)} stroke={i ? STRAW : MATCHA} strokeWidth={16} transform={`translate(${MIS.x} ${MIS.y})`} {...draw(k2)} {...R} />
                    <path d={arc(a0 + rot)} stroke={i ? MATCHA : STRAW} strokeWidth={16} {...draw(k2)} {...R} />
                </g>);
            })()}
            {/* the word, printed on its strip */}
            {word && tW >= 0 && (
                <g transform={`translate(${cx} ${midY}) scale(${k}) rotate(-2) translate(${-cx} ${-midY})`}>
                    {strip && <>
                        <rect x={sx} y={sy} width={sw} height={sh} fill={STRAW} transform={`translate(${MIS.x + 5} ${MIS.y + 4})`} {...R} />
                        <rect x={sx} y={sy} width={sw} height={sh} fill={CREAM} {...R} />
                        <rect x={sx} y={sy + sh * 0.62} width={sw} height={sh * 0.38} fill="url(#ta-dots)" opacity={0.16} />
                    </>}
                    {/* the strawberry plate under the ink, out of register */}
                    {text(5, 4, STRAW)}
                    <g {...R}>{text(0, 0, p.color || INK)}</g>
                </g>
            )}
            {/* pen marks + doodles printed over the word */}
            {mark === 'underline' && tM >= 0 && (
                <path d={roughLine(cx - tw / 2 - 10, cy + size * 0.42, cx + tw / 2 + 10, cy + size * 0.36, 3, 8)} stroke={STRAW} strokeWidth={13} {...draw(clamp(tM / 8))} {...R} />
            )}
            {mark === 'circle' && tM >= 0 && (
                <path d={roughEllipse(cx, midY, tw / 2 + 62, size * 0.86, 5)} stroke={STRAW} strokeWidth={12} {...draw(clamp(tM / 10))} {...R} />
            )}
            {doodle === 'ghost' && tD >= 0 && (() => {
                const gx = cx + tw / 2 + 125, gy = cy - size * 0.45 - (Math.floor(f / 4) % 2) * 10, fade = Math.floor(tD / 6) % 2 ? 0.6 : 1;
                return (
                    <g transform={`translate(${gx} ${gy}) scale(${settle(tD) * 1.7})`} opacity={fade}>
                        <path d={GHOST} fill={MATCHA} transform="translate(6 5)" {...R} />
                        <path d={GHOST} fill={CREAM} {...R} />
                        <path d="M10 -66 C40 -56 48 -30 48 -14 L48 40 L32 26 L16 40 Z" fill="url(#ta-dots)" opacity={0.35} />
                        <g {...R}><circle cx={-16} cy={-22} r={7} fill={INK} /><circle cx={16} cy={-22} r={7} fill={INK} />
                            <ellipse cx={0} cy={2} rx={9} ry={12} fill={INK} /></g>
                    </g>
                );
            })()}
            {doodle === 'hearts' && [[-tw / 2 - 90, -size * 0.85, 1.6], [tw / 2 + 90, -size * 0.7, 1.3], [tw / 2 + 40, size * 0.6, 1.0]].map(([dx, dy, s], i) => {
                const t = tD - i * 6;
                if (t < 0) return null;
                const beat = Math.floor(t / 2) % 6 === 0 ? 1.18 : 1, bob = (Math.floor(f / 4) + i) % 2 ? -6 : 0;
                return (
                    <g key={i} transform={`translate(${cx + dx} ${cy + dy + bob}) scale(${s * beat * settle(t)})`}>
                        <path d={HEART} fill={MATCHA} transform="translate(6 5)" {...R} />
                        <path d={HEART} fill={STRAW} {...R} />
                        <path d="M2 -30 C14 -36 40 -30 38 2 C30 18 14 26 2 32 Z" fill="url(#ta-dots)" opacity={0.3} />
                    </g>
                );
            })}
            {doodle === 'waves' && tD >= 0 && [0, 1].map((r) => {
                const ph = (Math.floor(tD / 2) * 9 + r * 40) % 80, y = cy + size * 0.5 + r * 30 - clamp(tD / 16) * 18;
                const x0 = cx - tw / 2 - 60 - ph, w = tw + 200;
                return <g key={r}>
                    <path d={waveBand(x0, y, w, 26, 16, 40)} fill={r ? STRAW : MATCHA} transform={`translate(${MIS.x} ${MIS.y})`} opacity={0.9} {...R} />
                    <path d={waveBand(x0, y, w, 26, 16, 40)} fill={r ? MATCHA : CREAM} {...R} />
                    {r === 0 && <path d={waveBand(x0, y + 10, w, 26, 16, 30)} fill="url(#ta-dots)" opacity={0.25} />}
                </g>;
            })}
        </svg>
    );
};

// Risograph print border for speaking shots: cream paper margin around the perimeter with halftone rim,
// misregistered Strawberry/Matcha ink plates, Ink inner rule, and corner registration marks. Center stays open.
// Animates independently on its own stepped frame loop (entrance draw-in + live press registration drift on twos).
const RisoBorder: React.FC<{ mode: string; frame: number }> = ({ mode, frame }) => {
    const m = 28, r = 1080 - m, b = 1920 - m, rim = 14;
    const primary = mode === 'matcha' ? MATCHA : STRAW;
    const secondary = mode === 'matcha' ? STRAW : MATCHA;
    const R = { filter: 'url(#ta-riso)' };
    const step = Math.floor(frame / 4);
    const intro = ease(clamp((Math.floor(frame / 2) * 2) / 8));
    // Live press registration drift on twos (cycles across 4 sheets)
    const drift = [[6, 5], [9, 3], [4, 7], [8, 6]][step % 4];
    const ox = drift[0] * intro, oy = drift[1] * intro;
    const regDrift = [[4, 3], [6, 1], [2, 5], [5, 4]][step % 4];
    const regAng = [0, 12, -8, 6][step % 4];
    const lDraw = draw(clamp((Math.floor(frame / 2) * 2) / 10));
    const dotOp = step % 2 === 0 ? 0.24 : 0.17;
    const reg = (x: number, y: number, key: number) => (
        <g key={key}>
            <g transform={`translate(${x + regDrift[0]} ${y + regDrift[1]}) rotate(${regAng})`} opacity={0.8} {...R}>
                <circle cx={0} cy={0} r={9} fill="none" stroke={primary} strokeWidth={2.5} />
                <line x1={-15} y1={0} x2={15} y2={0} stroke={primary} strokeWidth={2.2} />
                <line x1={0} y1={-15} x2={0} y2={15} stroke={primary} strokeWidth={2.2} />
            </g>
            <g transform={`translate(${x} ${y}) rotate(${-regAng * 0.5})`} {...R}>
                <circle cx={0} cy={0} r={9} fill="none" stroke={INK} strokeWidth={2.5} />
                <line x1={-15} y1={0} x2={15} y2={0} stroke={INK} strokeWidth={2.2} />
                <line x1={0} y1={-15} x2={0} y2={15} stroke={INK} strokeWidth={2.2} />
            </g>
        </g>
    );
    return (
        <g>
            {/* Cream paper margin around the frame */}
            <path d={`M0 0 H1080 V1920 H0 Z M${m} ${m} V${b} H${r} V${m} Z`} fill={CREAM} fillRule="evenodd" {...R} />
            {/* Halftone dot rim along the inner paper edge */}
            <path d={`M${rim} ${rim} H${1080 - rim} V${1920 - rim} H${rim} Z M${m} ${m} V${b} H${r} V${m} Z`}
                fill="url(#ta-dots)" fillRule="evenodd" opacity={dotOp} />
            {/* Misregistered accent ink plate (drifts between press passes) */}
            <rect x={m + ox} y={m + oy} width={r - m} height={b - m} fill="none" stroke={primary} strokeWidth={5} opacity={0.9} {...R} />
            {/* Opposite-corner secondary ink L-bars (draw in from corners, 3-ink riso overprint) */}
            {mode === 'riso' && (
                <g fill="none" stroke={secondary} strokeWidth={6} opacity={0.88} {...R}>
                    <path d={`M${m - 4} ${m + 150} V${m - 4} H${m + 150}`} {...lDraw} />
                    <path d={`M${r + 4} ${b - 150} V${b + 4} H${r - 150}`} {...lDraw} />
                </g>
            )}
            {/* Main Ink inner border */}
            <rect x={m} y={m} width={r - m} height={b - m} fill="none" stroke={INK} strokeWidth={4} {...R} />
            {/* Corner printmaker registration marks */}
            {[[54, 54], [1026, 54], [54, 1866], [1026, 1866]].map(([x, y], i) => reg(x, y, i))}
        </g>
    );
};

// a rounded speech bubble around (x, y) with its tail pointing down-left at the speaker's mouth
function bubble(x: number, y: number, rx: number, ry: number) {
    const l = x - rx, r = x + rx, t = y - ry, b = y + ry, q = 40;
    return `M${l + q} ${t} H${r - q} Q${r} ${t} ${r} ${t + q} V${b - q} Q${r} ${b} ${r - q} ${b} H${x - rx * 0.15} L${x - rx * 0.42} ${b + 70} L${x - rx * 0.4} ${b} H${l + q} Q${l} ${b} ${l} ${b - q} V${t + q} Q${l} ${t} ${l + q} ${t} Z`;
}
// a flat band of water: a wavy top edge (`n` half-waves, crests `h` high) and a straight bottom `depth` below
function waveBand(x0: number, y: number, w: number, h: number, n: number, depth: number) {
    const step = w / n;
    let d = `M${x0} ${y}`;
    for (let i = 0; i < n; i++) d += ` Q${x0 + step * (i + 0.5)} ${y + (i % 2 ? h : -h) / 2} ${x0 + step * (i + 1)} ${y}`;
    return d + ` L${x0 + w} ${y + depth} L${x0} ${y + depth} Z`;
}
