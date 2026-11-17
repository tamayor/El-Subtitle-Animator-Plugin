// Before 2028 ILLUSTRATION STANDARD (from Ep. 13, 2026-11-17; before-2028-edit-prompt.md): one drawing kit, one stage,
// one motion grammar. Every scene here is built from the same helpers:
//   outline  ink 6 px on silhouettes (SW), 4 px on inner detail (DW), round joins
//   plate    the hero silhouette printed once more, offset (9, 8), in the second ink
//   shading  one halftone pattern (#kitht) for the ground shadow and shadow sides
//   colours  matcha = the public good / what people are owed · strawberry = money, the problem, the emphasis ·
//            ink = people and structures · cream = paper
//   text     Arial Bold caps on the label strip, never under 40 px on screen (the strip un-scales itself),
//            0.7 em of strip either side of the words, and the strip is clamped inside the 820 px stage
//   motion   enter: cut in at 108 % settling over 8 frames · act: a state change on its word, 8 frames ·
//            idle: one small loop · exit: hard cut. All on twos.
// A scene is drawn in its own coordinates: ground line at y = 0, x from -410 to 410 (the 820 px stage), up = negative y.
// Items: { kind, x, y (the ground line), s, at, steps: [frames from the clip start of each state change], text, n, out }.
import React from 'react';

export const INK = '#1c2738', PAPER = '#efe4cc', MATCHA = '#3f7f45', STRAW = '#c7385a', WHITE = '#fbfaf6';
export const ARIAL = 'Arial, Helvetica, sans-serif';
export const SW = 6, DW = 4, PX = 9, PY = 8;
export const cl = (x: number) => Math.max(0, Math.min(1, x));
export const ez = (x: number) => 1 - Math.pow(1 - cl(x), 3);
export const two = (f: number) => Math.floor(f / 2) * 2;
export const rnd = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export type KitItem = { kind: string; x: number; y: number; s?: number; at?: number; steps?: number[]; text?: string; n?: number; out?: number; w?: number; h?: number; flip?: boolean; color?: string };

// progress 0..1 of the state change that starts on frame `at` (on twos, 8 frames)
export const act = (f: number, at: number | undefined, dur = 8) => (at === undefined ? 0 : ez(two(f - at) / dur));
export const on = (f: number, at: number | undefined) => at !== undefined && f >= at;
// the one idle loop: a value that steps every `every` frames
export const idle = (f: number, every = 4, n = 2) => Math.floor(f / every) % n;

// the stage: places the scene on its ground line and gives it the shared entrance (cut in at 108 %, settle on twos)
export const Stage: React.FC<{ it: KitItem; f: number; children: React.ReactNode }> = ({ it, f, children }) => {
    const t0 = f - (it.at || 0);
    if (t0 < 0) return null;
    const k = 1.08 - 0.08 * ez(two(t0) / 8);
    return <g transform={`translate(${it.x} ${it.y}) scale(${(it.s || 1) * k})`} strokeLinejoin="round" strokeLinecap="round">{children}</g>;
};
// ground line + the halftone ground shadow, the same under every scene
export const Ground: React.FC<{ w?: number; x?: number }> = ({ w = 820, x = 0 }) => (
    <g>
        <rect x={x - w / 2 + 30} y={4} width={w - 20} height={26} fill="url(#kitht)" />
        <line x1={x - w / 2} y1={0} x2={x + w / 2} y2={0} stroke={INK} strokeWidth={SW} />
    </g>
);
// a silhouette with the ink outline; `plate` prints the misregistered second ink behind it
export const Shape: React.FC<{ d: string; fill: string; plate?: string | false; sw?: number; opacity?: number }> = ({ d, fill, plate = false, sw = SW }) => (
    <g>
        {plate && <path d={d} fill={plate} transform={`translate(${PX} ${PY})`} />}
        <path d={d} fill={fill} stroke={INK} strokeWidth={sw} />
    </g>
);
export const box = (x: number, y: number, w: number, h: number, r = 10) =>
    `M${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} H${x + r} Q${x} ${y + h} ${x} ${y + h - r} V${y + r} Q${x} ${y} ${x + r} ${y} Z`;
// the label strip (same look as the reason-scene tags): strawberry strip, ink block out of register, white Arial Bold caps.
// `s` = the scene's scale, so the text is never under 40 px on screen.
export const Label: React.FC<{ x: number; y: number; text: string; s?: number; size?: number; fill?: string; ink?: string; f?: number; at?: number }> = ({ x, y, text, s = 1, size = 44, fill = STRAW, ink = '#fff', f, at }) => {
    if (f !== undefined && at !== undefined && f < at) return null;
    const fs = Math.max(size, 40 / s), w = text.length * fs * 0.77 + fs * 1.4, h = fs * 1.6;
    const k = f !== undefined && at !== undefined ? 1.12 - 0.12 * ez(two(f - at) / 6) : 1;
    return (
        <g transform={`translate(${Math.max(-400 + w / 2, Math.min(400 - w / 2, x))} ${y}) scale(${k})`}>
            <rect x={-w / 2 + PX} y={-h / 2 + PY} width={w} height={h} fill={INK} />
            <rect x={-w / 2} y={-h / 2} width={w} height={h} fill={fill} />
            <text x={0} y={fs * 0.35} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={fs} letterSpacing={fs * 0.05} fill={ink}>{text}</text>
        </g>
    );
};
// the one person of the series: an ink silhouette (head, body, legs), optional strawberry sash for an official
export const Person: React.FC<{ x: number; y?: number; h?: number; f?: number; sash?: boolean; walk?: boolean; lean?: number }> = ({ x, y = 0, h = 200, f = 0, sash, walk, lean = 0 }) => {
    const k = h / 200, st = walk ? idle(f, 4) : 0;
    return (
        <g transform={`translate(${x} ${y}) scale(${k}) rotate(${lean})`}>
            <rect x={-20} y={-78} width={16} height={78} fill={INK} transform={`rotate(${walk ? (st ? 9 : -9) : 0} -12 -78)`} />
            <rect x={4} y={-78} width={16} height={78} fill={INK} transform={`rotate(${walk ? (st ? -9 : 9) : 0} 12 -78)`} />
            <rect x={-30} y={-164} width={60} height={96} rx={18} fill={INK} />
            {sash && <path d="M-26 -158 L26 -84" stroke={STRAW} strokeWidth={12} />}
            <circle cx={0} cy={-184} r={22} fill={INK} />
        </g>
    );
};
// a sketched strawberry pen loop round something (the series' pen box), drawing on over 8 frames
export const PenLoop: React.FC<{ cx: number; cy: number; rx: number; ry: number; f: number; at?: number }> = ({ cx, cy, rx, ry, f, at }) => {
    if (!on(f, at)) return null;
    const p = act(f, at, 8), len = 2 * Math.PI * Math.max(rx, ry) * 1.15, j = idle(f, 4) ? 2 : -2;
    return <ellipse cx={cx + j} cy={cy} rx={rx} ry={ry} fill="none" stroke={STRAW} strokeWidth={8} strokeDasharray={`${len * p} ${len}`} transform={`rotate(-4 ${cx} ${cy})`} />;
};
export const KitDefs: React.FC = () => (
    <pattern id="kitht" width={9} height={9} patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><circle cx={4.5} cy={4.5} r={2.3} fill={INK} /></pattern>
);

// ---------------------------------------------------------------------------------------------------------------------
// EP. 13 (rigged bidding, substandard roads). Motif = THE ROAD.
// ---------------------------------------------------------------------------------------------------------------------

// road: a new concrete road running to the horizon, a ribbon-cutting sign beside it, a car on it.
// steps[0] = it cracks · steps[1] = it sinks (a pothole opens, the car drops in) · steps[2] = a repair cone + 2nd label.
// text = "LABEL A|LABEL B": A lands with the crack, B with step 2 (or with the sink when there is no step 2).
export const Road: React.FC<{ it: KitItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, st = it.steps || [], lab = (it.text || '').split('|');
    const crack = act(f, st[0], 10), sink = act(f, st[1], 10), fix = on(f, st[2]);
    const H = 430, top = 96, bot = 330;                      // half widths of the road at the horizon / at the ground
    const xr = (t: number) => top + (bot - top) * t;          // half width at depth t (0 = horizon, 1 = ground)
    const yr = (t: number) => -H + H * t;
    const road = `M${-top} ${-H} L${top} ${-H} L${bot} 0 L${-bot} 0 Z`;
    // the car drives toward the viewer on a loop until the road sinks, then sits in the hole, tilted
    const loop = ((two(f) * 0.012) % 1), ct = on(f, st[1]) ? 0.62 : 0.12 + loop * 0.62, cs = 0.35 + ct * 0.75;
    const cx = xr(ct) * 0.42, cy = yr(ct) + (on(f, st[1]) ? 26 * sink : 0);
    const crackPts = [[-0.78, 0.5], [-0.5, 0.56], [-0.28, 0.47], [-0.05, 0.6], [0.16, 0.52], [0.4, 0.63], [0.62, 0.55], [0.8, 0.62]];
    const nSeg = Math.round(crack * (crackPts.length - 1));
    const P = (p: number[]) => `${xr(p[1]) * p[0]},${yr(p[1])}`;
    return (
        <Stage it={it} f={f}>
            {/* verges: the public land either side */}
            <path d={`M-410 0 L-410 ${-H} L${-top} ${-H} L${-bot} 0 Z`} fill={MATCHA} stroke={INK} strokeWidth={SW} />
            <path d={`M410 0 L410 ${-H} L${top} ${-H} L${bot} 0 Z`} fill={MATCHA} stroke={INK} strokeWidth={SW} />
            <line x1={-410} y1={-H} x2={410} y2={-H} stroke={INK} strokeWidth={SW} />
            {/* the road: cream concrete, ink edge, a strawberry plate out of register */}
            <Shape d={road} fill={PAPER} plate={STRAW} />
            <path d={`M${top * 0.55} ${-H} L${bot * 0.82} 0 L${bot} 0 L${top} ${-H} Z`} fill="url(#kitht)" />
            {[0.08, 0.3, 0.52, 0.76].map((t, i) => {
                const t2 = t + 0.13 + i * 0.012;
                return <path key={i} d={`M${-xr(t) * 0.035} ${yr(t)} L${xr(t) * 0.035} ${yr(t)} L${xr(t2) * 0.035} ${yr(t2)} L${-xr(t2) * 0.035} ${yr(t2)} Z`} fill={INK} />;
            })}
            {/* the crack runs across on its word */}
            {nSeg > 0 && <polyline points={crackPts.slice(0, nSeg + 1).map(P).join(' ')} fill="none" stroke={INK} strokeWidth={20} />}
            {nSeg > 0 && <polyline points={crackPts.slice(0, nSeg + 1).map(P).join(' ')} fill="none" stroke={STRAW} strokeWidth={9} />}
            {nSeg > 2 && [[-0.28, 0.47, -0.2, 0.36], [0.16, 0.52, 0.26, 0.42], [0.4, 0.63, 0.3, 0.74]].map((b, i) =>
                <line key={i} x1={xr(b[1]) * b[0]} y1={yr(b[1])} x2={xr(b[3]) * b[2]} y2={yr(b[3])} stroke={INK} strokeWidth={8} />)}
            {/* the sink: a pothole opens under the car */}
            {on(f, st[1]) && <g transform={`translate(${xr(0.62) * 0.42} ${yr(0.62) + 12})`}>
                <ellipse rx={150 * sink} ry={46 * sink} fill={INK} />
                <ellipse rx={150 * sink} ry={46 * sink} fill="none" stroke={STRAW} strokeWidth={DW} transform={`translate(${PX} ${PY})`} />
            </g>}
            {/* the car */}
            <g transform={`translate(${cx} ${cy}) scale(${cs}) rotate(${on(f, st[1]) ? 13 * sink : 0})`}>
                <Shape d={`${box(-70, -66, 140, 66, 14)} M-48 -66 L-34 -104 H34 L48 -66 Z`} fill={STRAW} sw={SW / cs * 0.8} />
                <rect x={-36} y={-98} width={72} height={28} rx={6} fill={PAPER} stroke={INK} strokeWidth={DW / cs * 0.8} />
                <rect x={-62} y={-10} width={30} height={22} rx={6} fill={INK} /><rect x={32} y={-10} width={30} height={22} rx={6} fill={INK} />
                <circle cx={-48} cy={-40} r={9} fill={PAPER} /><circle cx={48} cy={-40} r={9} fill={PAPER} />
            </g>
            {/* the ribbon-cutting sign: the supporting element */}
            <g transform="translate(-300 -150)">
                <rect x={-8} y={0} width={16} height={150} fill={INK} />
                <Shape d={box(-104, -120, 208, 128, 10)} fill={WHITE} plate={MATCHA} />
                <rect x={-104} y={-120} width={208} height={38} fill={MATCHA} stroke={INK} strokeWidth={DW} />
                {[0, 1, 2].map((i) => <line key={i} x1={-80} y1={-58 + i * 22} x2={i === 2 ? 20 : 80} y2={-58 + i * 22} stroke={INK} strokeWidth={DW} />)}
                <path d={`M-104 ${-30 + idle(f, 6) * 3} Q0 ${6 + idle(f, 6) * 3} 104 ${-30 + idle(f, 6) * 3}`} fill="none" stroke={STRAW} strokeWidth={12} />
            </g>
            {fix && <g transform={`translate(${xr(0.86) * -0.3} ${yr(0.86)})`}>
                <Shape d="M-34 0 L-12 -92 H12 L34 0 Z" fill={STRAW} /><rect x={-22} y={-52} width={44} height={16} fill={WHITE} /><rect x={-48} y={-8} width={96} height={14} rx={4} fill={INK} />
            </g>}
            <Ground />
            {lab[0] && <Label x={0} y={-H - 58 - (lab[1] ? Math.max(44, 40 / s) * 1.9 : 0)} text={lab[0]} s={s} f={f} at={st[0]} />}
            {lab[1] && <Label x={0} y={-H - 58} text={lab[1]} s={s} fill={INK} f={f} at={st[2] !== undefined ? st[2] : st[1]} />}
        </Stage>
    );
};

// bids: three sealed bids standing on the bidding table, each with its price.
// n = 0 (default): steps[0] = the lowest gets the pen loop + label text[3] ("LOWEST WINS").
// n = 1 (fixed contest): the WIN / LOSE stamps land on steps[0..2] before anyone opens them; label text[3] on steps[3].
// text = "price|price|price|LABEL" (the middle one is the lowest / the pre-picked winner).
export const Bids: React.FC<{ it: KitItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, st = it.steps || [], tx = (it.text || '₱120M|₱98M|₱135M|LOWEST WINS').split('|'), fixed = it.n === 1;
    const fs = Math.max(48, 40 / s);
    return (
        <Stage it={it} f={f}>
            {/* the table */}
            <Shape d="M-400 -70 H400 L370 -10 H-370 Z" fill={MATCHA} plate={STRAW} />
            <rect x={-330} y={-10} width={24} height={10} fill={INK} /><rect x={306} y={-10} width={24} height={10} fill={INK} />
            {[-250, 0, 250].map((x, i) => {
                const mid = i === 1, bob = mid && !fixed && on(f, st[0]) ? -14 * act(f, st[0]) : 0;
                const stampAt = fixed ? st[[1, 0, 2][i]] : undefined, sp = act(f, stampAt, 6);
                return (
                    <g key={i} transform={`translate(${x} ${-70 + bob}) rotate(${[-3, 0, 3][i]})`}>
                        <Shape d={box(-104, -330, 208, 330, 10)} fill={WHITE} plate={mid ? STRAW : false} />
                        <rect x={-104} y={-330} width={208} height={62} fill={INK} />
                        <text x={0} y={-286} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={Math.max(40, 40 / s)} letterSpacing={4} fill="#fff">BID</text>
                        <text x={0} y={-170} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={fs} fill={mid ? STRAW : INK}>{tx[i]}</text>
                        {[0, 1, 2].map((q) => <line key={q} x1={-70} y1={-110 + q * 26} x2={q === 2 ? 10 : 70} y2={-110 + q * 26} stroke={INK} strokeWidth={DW} />)}
                        <circle cx={62} cy={-36} r={20} fill={mid ? STRAW : MATCHA} stroke={INK} strokeWidth={DW} />
                        {fixed && on(f, stampAt) && <g transform={`translate(0 -170) rotate(-12) scale(${1.5 - 0.5 * sp})`}>
                            <rect x={-96} y={-40} width={192} height={80} fill={mid ? MATCHA : STRAW} stroke={INK} strokeWidth={SW} />
                            <text x={0} y={18} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={Math.max(50, 40 / s)} letterSpacing={4} fill="#fff">{mid ? 'WIN' : 'LOSE'}</text>
                        </g>}
                    </g>
                );
            })}
            {!fixed && <PenLoop cx={0} cy={-256} rx={150} ry={66} f={f} at={st[0]} />}
            <Ground />
            {tx[3] && <Label x={0} y={-480} text={tx[3]} s={s} f={f} at={fixed ? st[3] : st[0]} />}
        </Stage>
    );
};

// roof: the carpenter analogy. A house, a carpenter up the ladder, his quote on paper.
// steps[0] = the quote (text[0], "LOWEST QUOTE") gets its tick · steps[1] = the roof boards go thin (gaps) ·
// steps[2] = the nails are skipped (strawberry rings where nails should be) · steps[3] = the roof leaks.
// A step frame below 0 = already in that state when the clip starts.
export const Roof: React.FC<{ it: KitItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, st = it.steps || [], tx = (it.text || 'LOWEST QUOTE|THIN WOOD, NO NAILS').split('|');
    const thin = act(f, st[1]), nails = on(f, st[2]), leak = on(f, st[3]);
    const boards = [0, 1, 2, 3, 4];
    const ham = idle(f, 4) ? -28 : 6;
    return (
        <Stage it={it} f={f}>
            {/* the house */}
            <Shape d={box(-250, -250, 500, 250, 6)} fill={PAPER} plate={STRAW} />
            <rect x={-60} y={-150} width={120} height={150} fill={INK} /><circle cx={34} cy={-74} r={8} fill={PAPER} />
            <rect x={-210} y={-190} width={100} height={90} fill={WHITE} stroke={INK} strokeWidth={DW} /><line x1={-160} y1={-190} x2={-160} y2={-100} stroke={INK} strokeWidth={DW} /><line x1={-210} y1={-145} x2={-110} y2={-145} stroke={INK} strokeWidth={DW} />
            {/* the roof: boards that go thin on the word */}
            <path d="M-300 -250 L0 -470 L300 -250 Z" fill={INK} />
            {boards.map((i) => {
                const y0 = -262 - i * 40, half = 286 - i * 55, hgt = 30 - 16 * thin;
                return <g key={i}>
                    <rect x={-half} y={y0 - hgt} width={half * 2} height={hgt} fill={MATCHA} stroke={INK} strokeWidth={DW} />
                    {[-0.7, -0.25, 0.25, 0.7].map((q, j) => (i + j) % 2 === 0 || !nails
                        ? <circle key={j} cx={half * q} cy={y0 - hgt / 2} r={5} fill={INK} opacity={nails && (i + j) % 2 ? 0 : 1} />
                        : <circle key={j} cx={half * q} cy={y0 - hgt / 2} r={13} fill="none" stroke={STRAW} strokeWidth={DW + 1} />)}
                </g>;
            })}
            {/* the leak */}
            {leak && [0, 1, 2].map((i) => {
                const t = ((two(f - (st[3] || 0)) + i * 10) % 30) / 30;
                return <path key={i} d="M0 -16 Q12 4 0 12 Q-12 4 0 -16 Z" fill={STRAW} stroke={INK} strokeWidth={3} transform={`translate(${-150 + i * 150} ${-236 + t * 200})`} />;
            })}
            {leak && <ellipse cx={0} cy={-6} rx={210} ry={12} fill={STRAW} />}
            {/* ladder + carpenter hammering (the idle loop) */}
            <g transform="translate(330 0)">
                <line x1={-30} y1={0} x2={-90} y2={-330} stroke={INK} strokeWidth={10} /><line x1={30} y1={0} x2={-30} y2={-330} stroke={INK} strokeWidth={10} />
                {[1, 2, 3, 4, 5].map((i) => <line key={i} x1={-30 - i * 10 + 4} y1={-i * 55} x2={30 - i * 10 - 4} y2={-i * 55} stroke={INK} strokeWidth={8} />)}
            </g>
            <Person x={262} y={-196} h={190} lean={-8} />
            <g transform={`translate(236 -330) rotate(${ham})`}><rect x={-6} y={-70} width={12} height={74} fill={INK} /><rect x={-30} y={-92} width={60} height={28} rx={5} fill={STRAW} stroke={INK} strokeWidth={DW} /></g>
            {/* the quote on paper */}
            {on(f, st[0] === undefined ? 0 : Math.min(st[0], 0)) && <g transform={`translate(-330 -330) rotate(-5) scale(${st[0] !== undefined && st[0] > 0 ? 1 : 1})`}>
                <Shape d={box(-76, -100, 152, 200, 8)} fill={WHITE} plate={MATCHA} />
                <text x={0} y={-50} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={Math.max(46, 40 / s)} fill={STRAW}>₱</text>
                {[0, 1].map((q) => <line key={q} x1={-48} y1={-14 + q * 24} x2={48} y2={-14 + q * 24} stroke={INK} strokeWidth={DW} />)}
                {on(f, st[0]) && <path d="M-34 56 L-10 80 L42 26" fill="none" stroke={MATCHA} strokeWidth={14} strokeDasharray={`${150 * act(f, st[0])} 150`} />}
            </g>}
            <Ground />
            {tx[0] && !on(f, st[1]) && <Label x={0} y={-540} text={tx[0]} s={s} f={f} at={st[0]} fill={MATCHA} />}
            {tx[1] && <Label x={0} y={-540} text={tx[1]} s={s} f={f} at={st[1]} />}
        </Stage>
    );
};

// stacks: peso coin stacks side by side, each under its label. text = "LABEL|LABEL" (1-3 stacks), steps[i] = stack i lands.
// n = coins per stack (default 7). The last stack is strawberry (the cost you did not expect).
export const Stacks: React.FC<{ it: KitItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, st = it.steps || [0], tx = (it.text || 'BUILD|FIX').split('|'), n = it.n || 7, m = tx.length;
    const gap = m === 1 ? 0 : Math.min(360, 640 / (m - 1));
    // labels never overlap each other or leave the stage (user 2026-11-17, "130 BAD PROJECTS" under "₱3.458 BILLION"): each strip is
    // clamped inside the stage, and when neighbours would touch they go on alternate rows
    const fsL = Math.max(44, 40 / s), lw = (t: string) => t.length * fsL * 0.77 + fsL * 1.4, rowH = fsL * 2.25;
    const lx = tx.map((t, i) => { const x = (i - (m - 1) / 2) * gap, hw = lw(t) / 2; return Math.max(-400 + hw, Math.min(400 - hw, x)); });
    const stagger = tx.some((t, i) => i > 0 && lx[i] - lx[i - 1] < (lw(t) + lw(tx[i - 1])) / 2 + 24);
    return (
        <Stage it={it} f={f}>
            {tx.map((t, i) => {
                const at = st[i] === undefined ? 0 : st[i], x = (i - (m - 1) / 2) * gap, last = m > 1 && i === m - 1;
                if (!on(f, at)) return null;
                const up = Math.min(n, Math.floor((two(f - at)) / 2) + 1), shine = idle(f, 6);
                return (
                    <g key={i} transform={`translate(${x} 0)`}>
                        {Array.from({ length: up }, (_, j) => {
                            const y = -18 - j * 30, dx = (rnd(i * 9 + j) - 0.5) * 14;
                            return <g key={j} transform={`translate(${dx} ${y})`}>
                                {j === 0 && <ellipse cx={PX} cy={PY} rx={112} ry={30} fill={last ? MATCHA : STRAW} />}
                                <path d="M-110 0 V-22 A110 28 0 0 1 110 -22 V0 A110 28 0 0 1 -110 0 Z" fill={last ? STRAW : MATCHA} stroke={INK} strokeWidth={SW} />
                                <ellipse cx={0} cy={-22} rx={110} ry={28} fill={j === up - 1 ? PAPER : (last ? STRAW : MATCHA)} stroke={INK} strokeWidth={SW} />
                                {j === up - 1 && <text x={0} y={-8} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={Math.max(40, 40 / s)} fill={INK} transform={`translate(0 ${shine})`}>₱</text>}
                            </g>;
                        })}
                        {t && <Label x={lx[i] - x} y={-18 - n * 30 - 86 - (stagger && i % 2 === 0 ? rowH : 0)} text={t} s={s} f={f} at={at + 4} fill={last ? STRAW : INK} />}
                    </g>
                );
            })}
            <Ground />
        </Stage>
    );
};

// kickback: the project budget as one long bar. steps[0] = a slice (text[1], "20%") turns strawberry and is cut off ·
// steps[1] = the slice drops into an envelope that an official pockets · steps[2] = what is left for the road shrinks
// (label text[2], "CHEAPER MATERIALS"). text = "PROJECT BUDGET|20%|CHEAPER MATERIALS".
export const Kickback: React.FC<{ it: KitItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, st = it.steps || [], tx = (it.text || 'PROJECT BUDGET|20%|CHEAPER MATERIALS').split('|');
    const cut = act(f, st[0]), drop = act(f, st[1], 10), weak = act(f, st[2]);
    const W = 760, L = -W / 2, sl = W * 0.24, fs = Math.max(44, 40 / s);
    const sx = L + W - sl + 40 * cut + (210 - (L + W - sl + 40)) * drop * 0, sy = -420 + drop * 250;
    return (
        <Stage it={it} f={f}>
            {/* the budget bar */}
            <Shape d={box(L, -420, W - sl - 6, 110, 10)} fill={MATCHA} plate={STRAW} />
            {weak > 0 && <rect x={L + (W - sl) * (1 - 0.3 * weak)} y={-417} width={(W - sl) * 0.3 * weak - 9} height={104} fill="url(#kitht)" />}
            <text x={L + 26} y={-350} fontFamily={ARIAL} fontWeight={700} fontSize={fs} letterSpacing={2} fill="#fff">{tx[0]}</text>
            {/* the slice */}
            <g transform={`translate(${sx + 30 * cut} ${sy}) rotate(${8 * cut + 10 * drop})`} opacity={drop >= 1 ? 0 : 1}>
                <Shape d={box(0, 0, sl, 110, 10)} fill={on(f, st[0]) ? STRAW : MATCHA} plate={on(f, st[0]) ? INK : false} />
                {on(f, st[0]) && <text x={sl / 2} y={72} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={fs * 1.1} fill="#fff">{tx[1]}</text>}
            </g>
            {/* the official with the envelope */}
            <Person x={345} h={250} sash />
            <g transform={`translate(262 -120) rotate(-6) scale(${1 + 0.1 * (drop >= 1 ? idle(f, 6) : 0)})`}>
                <Shape d={box(-92, -60, 184, 120, 8)} fill={WHITE} plate={STRAW} />
                <path d="M-92 -60 L0 12 L92 -60" fill="none" stroke={INK} strokeWidth={SW} />
                {drop >= 1 && <text x={0} y={46} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={Math.max(44, 40 / s)} fill={STRAW}>{tx[1]}</text>}
            </g>
            {/* what is left: a thin road slab under the bar */}
            <g transform="translate(-150 0)">
                <Shape d={`M-240 ${-70 + 34 * weak} H240 V0 H-240 Z`} fill={PAPER} />
                {[-150, -30, 90].map((x, i) => <rect key={i} x={x} y={-44 + 34 * weak * 0.5 - 6} width={70} height={10} fill={INK} />)}
                {weak > 0.9 && <polyline points="-40,-36 -10,-18 -30,-6 0,0" fill="none" stroke={STRAW} strokeWidth={8} />}
            </g>
            <Ground />
            {tx[2] && <Label x={-175} y={-200} text={tx[2]} s={s} size={36} f={f} at={st[2]} />}
        </Stage>
    );
};

// balance: quality against cheap price (RA 12009, Ep. 13 T22). A scale; the peso price tag sits on the right pan and wins
// at first (the old lowest-bid rule). steps[0] = a solid road slab lands on the left pan · steps[1] = the beam tips to
// the slab and its label (text[0], "QUALITY") lands · steps[2] = the price label (text[1], "CHEAP PRICE") lands.
export const Balance: React.FC<{ it: KitItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, st = it.steps || [], tx = (it.text || 'QUALITY|CHEAP PRICE').split('|');
    const slab = on(f, st[0]), land = act(f, st[0], 6), tip = act(f, st[1], 10);
    const sway = (on(f, st[1]) && tip >= 1 ? [0, 1.5, 0, -1.5][idle(f, 5, 4)] : [0, 1, 0, -1][idle(f, 6, 4)]);
    const ang = 13 - 26 * tip + sway, r = (ang * Math.PI) / 180, L = 290, PY0 = -430;
    const ex = (d: number) => d * L * Math.cos(r), ey = (d: number) => PY0 + d * L * Math.sin(r);
    const pan = (d: number, child: React.ReactNode) => (
        <g transform={`translate(${ex(d)} ${ey(d)})`}>
            <line x1={0} y1={0} x2={-110} y2={150} stroke={INK} strokeWidth={DW} /><line x1={0} y1={0} x2={110} y2={150} stroke={INK} strokeWidth={DW} />
            <g transform="translate(0 150)">{child}<Shape d="M-140 0 H140 L112 34 H-112 Z" fill={PAPER} plate={d < 0 ? MATCHA : STRAW} /></g>
        </g>
    );
    const fsL = Math.max(44, 40 / s);
    return (
        <Stage it={it} f={f}>
            {/* post + base */}
            <Shape d="M-150 0 H150 L110 -46 H-110 Z" fill={INK} />
            <rect x={-14} y={PY0} width={28} height={-PY0 - 40} fill={INK} />
            {/* beam */}
            <g transform={`translate(0 ${PY0}) rotate(${ang})`}>
                <rect x={-L - 16} y={-11 + PY} width={2 * L + 32} height={22} rx={8} fill={STRAW} transform={`translate(${PX} 0)`} />
                <rect x={-L - 16} y={-11} width={2 * L + 32} height={22} rx={8} fill={PAPER} stroke={INK} strokeWidth={SW} />
            </g>
            <circle cx={0} cy={PY0} r={26} fill={MATCHA} stroke={INK} strokeWidth={SW} />
            {/* left pan: the solid road slab (quality) */}
            {pan(-1, slab && <g transform={`translate(0 ${-70 * (1 - land)})`}>
                <Shape d={box(-112, -84, 224, 84, 8)} fill={MATCHA} />
                <rect x={-112} y={-84} width={224} height={26} fill={PAPER} stroke={INK} strokeWidth={DW} />
                {[-70, 0, 70].map((x) => <rect key={x} x={x - 22} y={-75} width={44} height={8} fill={INK} />)}
                {[0, 1, 2].map((q) => <line key={q} x1={-90} y1={-44 + q * 14} x2={90} y2={-44 + q * 14} stroke={INK} strokeWidth={3} strokeDasharray="14 10" />)}
            </g>)}
            {/* right pan: the peso price tag (cheap price) */}
            {pan(1, <g transform="translate(0 -4) rotate(-8)">
                <Shape d="M-70 -96 H40 L84 -52 L40 -8 H-70 Z" fill={STRAW} />
                <circle cx={44} cy={-52} r={9} fill={PAPER} stroke={INK} strokeWidth={DW} />
                <text x={-22} y={-32} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={Math.max(58, 40 / s)} fill="#fff">₱</text>
            </g>)}
            {/* the tick on the winning side */}
            {tip >= 1 && <path d="M-330 -520 L-300 -490 L-240 -560" fill="none" stroke={MATCHA} strokeWidth={16} />}
            <Ground />
            {tx[0] && <Label x={-250} y={-640} text={tx[0]} s={s} f={f} at={st[1]} fill={MATCHA} />}
            {tx[1] && <Label x={190} y={-640} text={tx[1]} s={s} f={f} at={st[2]} />}
        </Stage>
    );
};

// ---------------------------------------------------------------------------------------------------------------------
// EP. 14 (fast food removed its playgrounds). Motif = THE CORNER of the restaurant where the playground stood.
// ---------------------------------------------------------------------------------------------------------------------

const Kid: React.FC<{ x: number; y?: number; h?: number; f: number; i?: number }> = ({ x, y = 0, h = 110, f, i = 0 }) =>
    <Person x={x} y={y - (idle(f + i * 3, 4) ? 10 : 0)} h={h} />;
// a small restaurant table with two stools
const Table: React.FC<{ x: number; s?: number }> = ({ x, s = 1 }) => (
    <g transform={`translate(${x} 0) scale(${s})`}>
        <rect x={-8} y={-84} width={16} height={84} fill={INK} /><Shape d={box(-70, -100, 140, 22, 6)} fill={PAPER} />
        <rect x={-104} y={-52} width={30} height={52} fill={INK} /><rect x={74} y={-52} width={30} height={52} fill={INK} />
    </g>
);
// corner: the playground corner. A slide and a ball pit with kids, against the restaurant wall.
// steps[0] = the slide is struck out · steps[1] = the ball pit is struck out · steps[2] = the whole playground is ripped
// out (the wall goes grey) · steps[3] = tables come in (n of them, default 6). h = frame a CLOSED tape goes across it.
// w = frame germs pop onto the playground (Ep. 14 T20, user: "add germs element here to emphasize that germs").
// text = "LABEL A|LABEL B": A lands with the rip-out (or with h when there is no rip-out), B with the tables.
// Use 9999 for a step that never happens and -1 for one that already has.
export const Corner: React.FC<{ it: KitItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, st = it.steps || [], lab = (it.text || '').split('|'), n = it.n || 6;
    const out = act(f, st[2], 10), gone = on(f, st[2]) && out >= 1, tab = on(f, st[3]);
    const lift = -640 * out, tape = it.h !== undefined && on(f, it.h);
    const X: React.FC<{ x: number; y: number; at?: number }> = ({ x, y, at }) => on(f, at) && !gone ? (
        <g transform={`translate(${x} ${y}) scale(${1.4 - 0.4 * act(f, at, 6)})`}>
            <line x1={-70} y1={-70} x2={70} y2={70} stroke={STRAW} strokeWidth={22} /><line x1={70} y1={-70} x2={-70} y2={70} stroke={STRAW} strokeWidth={22} />
        </g>) : null;
    return (
        <Stage it={it} f={f}>
            {/* the wall + floor of the corner: warm paper while the playground stands, a flat grey once it is gone */}
            <Shape d={box(-400, -560, 800, 560, 10)} fill={on(f, st[2]) ? '#b9b7ae' : PAPER} plate={on(f, st[2]) ? INK : MATCHA} />
            {!on(f, st[2]) && [0, 1, 2, 3, 4].map((i) => <rect key={i} x={-400 + i * 160 + 3} y={-557} width={80} height={554} fill={MATCHA} opacity={0.16} />)}
            {on(f, st[2]) && <rect x={-397} y={-557} width={794} height={554} fill="url(#kitht)" opacity={0.35} />}
            {/* the playground */}
            {!gone && <g transform={`translate(0 ${lift}) rotate(${-6 * out})`}>
                {/* slide: tower + chute */}
                <rect x={-330} y={-360} width={26} height={360} fill={INK} /><rect x={-190} y={-360} width={26} height={360} fill={INK} />
                <Shape d={box(-350, -400, 206, 50, 8)} fill={STRAW} plate={INK} />
                <path d="M-350 -400 L-247 -500 L-144 -400 Z" fill={MATCHA} stroke={INK} strokeWidth={SW} />
                <Shape d="M-150 -372 C-60 -372 -40 -40 110 -40 L110 0 C-60 0 -90 -322 -150 -322 Z" fill={STRAW} plate={MATCHA} />
                {[1, 2, 3, 4].map((i) => <line key={i} x1={-330} y1={-i * 70} x2={-164} y2={-i * 70} stroke={INK} strokeWidth={8} />)}
                <Kid x={-247} y={-400} h={96} f={f} />
                {/* ball pit */}
                <Shape d="M130 -150 H390 V0 H130 Z" fill={PAPER} plate={STRAW} />
                {Array.from({ length: 22 }, (_, i) => {
                    const bx = 152 + (i % 8) * 31 + (Math.floor(i / 8) % 2) * 14, by = -30 - Math.floor(i / 8) * 34 - (idle(f + i * 5, 5) ? 5 : 0);
                    return <circle key={i} cx={bx} cy={by} r={17} fill={[MATCHA, STRAW, PAPER][i % 3]} stroke={INK} strokeWidth={DW} />;
                })}
                <Kid x={215} y={-70} h={104} f={f} i={1} /><Kid x={320} y={-64} h={96} f={f} i={2} />
            </g>}
            <X x={-200} y={-250} at={st[0]} /><X x={260} y={-110} at={st[1]} />
            {/* germs (w = the frame they show up): spiky strawberry blobs popping onto the playground one by one, wobbling */}
            {it.w !== undefined && it.w > 1 && on(f, it.w) && !gone && [[-250, -470, 1.1], [-60, -330, 0.85], [150, -420, 1.25], [300, -250, 0.95], [-340, -180, 0.8], [40, -120, 1.0], [330, -470, 0.75]].map(([gx, gy, gk], i) => {
                const a0 = (it.w as number) + i * 4;
                if (!on(f, a0)) return null;
                const pop = 1.5 - 0.5 * act(f, a0, 6), wob = [0, 9, 0, -9][idle(f + i * 2, 4, 4)];
                return (
                    <g key={i} transform={`translate(${gx} ${gy + lift}) scale(${gk * pop}) rotate(${wob + i * 25})`}>
                        {Array.from({ length: 10 }, (_, q) => <g key={q} transform={`rotate(${q * 36})`}><line x1={0} y1={-44} x2={0} y2={-74} stroke={INK} strokeWidth={9} /><circle cx={0} cy={-78} r={11} fill={STRAW} stroke={INK} strokeWidth={DW} /></g>)}
                        <circle cx={PX * 0.6} cy={PY * 0.6} r={50} fill={INK} /><circle r={50} fill={STRAW} stroke={INK} strokeWidth={SW} />
                        <circle cx={-16} cy={-12} r={11} fill={PAPER} /><circle cx={18} cy={8} r={8} fill={MATCHA} /><circle cx={-6} cy={22} r={6} fill={PAPER} />
                    </g>
                );
            })}
            {/* the tape */}
            {tape && !gone && <g transform={`translate(0 ${lift}) rotate(-7)`}>
                <rect x={-420 * act(f, it.h, 8)} y={-250} width={840 * act(f, it.h, 8)} height={62} fill={STRAW} stroke={INK} strokeWidth={SW} />
                {act(f, it.h, 8) >= 1 && <text x={0} y={-204} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={Math.max(46, 40 / s)} letterSpacing={10} fill="#fff">CLOSED  ·  CLOSED</text>}
            </g>}
            {/* the tables that replace it */}
            {tab && Array.from({ length: n }, (_, i) => {
                const a = (st[3] || 0) + i * 4;
                if (!on(f, a)) return null;
                const cols = Math.ceil(n / 2), row = Math.floor(i / cols), col = i % cols, k = 1.25 - 0.25 * act(f, a, 6);
                return <g key={i} transform={`translate(${-300 + col * (600 / Math.max(1, cols - 1))} ${row ? -8 : -250}) scale(${k})`}><Table x={0} s={row ? 1 : 0.82} /></g>;
            })}
            <Ground />
            {lab[0] && <Label x={0} y={-640} text={lab[0]} s={s} f={f} at={st[2] !== undefined && st[2] < 9000 ? st[2] : it.h} />}
            {lab[1] && <Label x={0} y={-640} text={lab[1]} s={s} fill={INK} f={f} at={st[3]} />}
        </Stage>
    );
};

// hook: the hook-and-drop. A fishing line with a toy on the hook; a family walks toward it.
// steps[0] = the family is hooked (pulled in under the line) · steps[1] = the toy is dropped (falls away, the family stays)
// text = "LABEL A|LABEL B": A lands with steps[0], B with steps[1].
export const Hook: React.FC<{ it: KitItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, st = it.steps || [], lab = (it.text || '').split('|');
    const bite = act(f, st[0], 10), drop = act(f, st[1], 10), sway = [0, 4, 0, -4][idle(f, 5, 4)] * (on(f, st[1]) ? 0 : 1);
    const fx = 330 - 250 * bite;
    return (
        <Stage it={it} f={f}>
            {/* the rod, from the counter of the chain */}
            <Shape d={box(-400, -210, 190, 210, 8)} fill={STRAW} plate={INK} />
            <rect x={-400} y={-250} width={210} height={44} fill={INK} />
            <path d="M-300 -230 Q-120 -640 60 -560" fill="none" stroke={INK} strokeWidth={12} />
            <line x1={60} y1={-560} x2={60 + sway} y2={-360} stroke={INK} strokeWidth={DW} />
            <path d={`M${60 + sway} -360 v60 a34 34 0 0 1 -68 0`} fill="none" stroke={INK} strokeWidth={10} />
            {/* the toy on the hook: a ball with a star, the fun */}
            <g transform={`translate(${26 + sway} ${-250 + 420 * drop}) rotate(${40 * drop})`} opacity={drop >= 1 ? 0 : 1}>
                <circle cx={PX} cy={PY} r={56} fill={STRAW} /><circle r={56} fill={MATCHA} stroke={INK} strokeWidth={SW} />
                <path d="M0 -30 L9 -9 L31 -9 L13 5 L20 27 L0 14 L-20 27 L-13 5 L-31 -9 L-9 -9 Z" fill={PAPER} stroke={INK} strokeWidth={DW} />
            </g>
            {/* the family */}
            <Person x={fx + 60} h={230} f={f} walk={!on(f, st[0]) || bite < 1} />
            <Person x={fx - 30} h={210} f={f} walk={!on(f, st[0]) || bite < 1} />
            <Kid x={fx - 110} h={120} f={f} />
            {on(f, st[0]) && bite >= 1 && !on(f, st[1]) && <path d={`M${fx - 110} -170 q20 -40 0 -60 q-20 20 0 60 Z`} fill={STRAW} stroke={INK} strokeWidth={DW} transform={`translate(0 ${idle(f, 4) ? -6 : 0})`} />}
            <Ground />
            {lab[0] && !on(f, st[1]) && <Label x={150} y={-690} text={lab[0]} s={s} f={f} at={st[0]} fill={MATCHA} />}
            {lab[1] && <Label x={150} y={-690} text={lab[1]} s={s} f={f} at={st[1]} />}
        </Stage>
    );
};

// target: "you were the target". A bullseye with a child at its centre and a gift beside them.
// steps[0] = the gift's tag flips to text[0] ("NOT FREE") · steps[1] = a heart pops over the child (falls for the brand) ·
// steps[2] = the child has grown into a paying adult, label text[1] ("CUSTOMER FOR LIFE").
export const Target: React.FC<{ it: KitItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, st = it.steps || [], lab = (it.text || '').split('|');
    const grow = act(f, st[2], 10), pulse = idle(f, 5) ? 1.03 : 1;
    return (
        <Stage it={it} f={f}>
            <g transform={`translate(-60 -330) scale(${pulse})`}>
                <circle cx={PX} cy={PY} r={300} fill={STRAW} />
                {[300, 215, 130].map((r, i) => <circle key={i} r={r} fill={[PAPER, STRAW, PAPER][i]} stroke={INK} strokeWidth={SW} />)}
            </g>
            <Person x={-60} y={-120} h={150 + 150 * grow} f={f} />
            {on(f, st[1]) && !on(f, st[2]) && <path d="M0 26 C-70 -30 -44 -84 0 -48 C44 -84 70 -30 0 26 Z" fill={STRAW} stroke={INK} strokeWidth={SW} transform={`translate(-60 ${-330 - (idle(f, 4) ? 8 : 0)}) scale(${1.5 - 0.5 * act(f, st[1], 6)})`} />}
            {on(f, st[2]) && <g transform={`translate(70 -260) scale(${1.4 - 0.4 * grow})`}><circle r={46} fill={PAPER} stroke={INK} strokeWidth={SW} /><text y={20} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={Math.max(56, 40 / s)} fill={STRAW}>₱</text></g>}
            {/* the gift */}
            <g transform="translate(290 0)">
                <Shape d={box(-80, -130, 160, 130, 8)} fill={MATCHA} plate={STRAW} />
                <rect x={-14} y={-130} width={28} height={130} fill={PAPER} stroke={INK} strokeWidth={DW} /><rect x={-92} y={-160} width={184} height={40} rx={6} fill={PAPER} stroke={INK} strokeWidth={SW} />
                <path d="M0 -160 q-50 -60 -70 -20 q10 30 70 20 q50 -60 70 -20 q-10 30 -70 20" fill={STRAW} stroke={INK} strokeWidth={DW} />
            </g>
            <Ground />
            {lab[0] && <Label x={250} y={-260} text={lab[0]} s={s} f={f} at={st[0]} />}
            {lab[1] && <Label x={0} y={-700} text={lab[1]} s={s} fill={INK} f={f} at={st[2]} />}
        </Stage>
    );
};

// cafe: the Wi-Fi goes off and the comfortable chair becomes a hard stool.
// steps[0] = Wi-Fi struck off (label text[0]) · steps[1] = the armchair swaps to a stool (label text[1]).
export const Cafe: React.FC<{ it: KitItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, st = it.steps || [], lab = (it.text || 'NO WI-FI|HARD CHAIRS').split('|');
    const off = on(f, st[0]), hard = on(f, st[1]), k = 1.2 - 0.2 * act(f, st[1], 6);
    return (
        <Stage it={it} f={f}>
            {/* the Wi-Fi sign */}
            <g transform="translate(-210 -330)">
                <Shape d={box(-150, -150, 300, 300, 24)} fill={PAPER} plate={off ? INK : MATCHA} />
                {[0, 1, 2].map((i) => <path key={i} d={`M${-100 + i * 30} ${-10 - i * 34} A${140 - i * 40} ${140 - i * 40} 0 0 1 ${100 - i * 30} ${-10 - i * 34}`} fill="none"
                    stroke={off ? '#9a988f' : MATCHA} strokeWidth={24} opacity={!off && idle(f, 6, 3) < i ? 0.25 : 1} />)}
                <circle cx={0} cy={80} r={22} fill={off ? '#9a988f' : MATCHA} />
                {off && <line x1={-120} y1={120} x2={120} y2={-120} stroke={STRAW} strokeWidth={26} strokeDasharray={`${340 * act(f, st[0], 6)} 340`} />}
            </g>
            {/* the seat */}
            <g transform={`translate(220 0) scale(${hard ? k : 1})`}>
                {!hard ? <g>
                    <Shape d={`${box(-130, -210, 260, 150, 30)} ${box(-150, -120, 60, 120, 20)} ${box(90, -120, 60, 120, 20)}`} fill={MATCHA} plate={STRAW} />
                    <Shape d={box(-96, -330, 192, 150, 40)} fill={MATCHA} />
                    <rect x={-100} y={-60} width={20} height={60} fill={INK} /><rect x={80} y={-60} width={20} height={60} fill={INK} />
                </g> : <g>
                    <Shape d={box(-90, -200, 180, 26, 6)} fill={PAPER} plate={STRAW} />
                    <line x1={-70} y1={-174} x2={-96} y2={0} stroke={INK} strokeWidth={14} /><line x1={70} y1={-174} x2={96} y2={0} stroke={INK} strokeWidth={14} />
                    <line x1={-84} y1={-70} x2={84} y2={-70} stroke={INK} strokeWidth={10} />
                </g>}
            </g>
            <Ground />
            {lab[0] && <Label x={-210} y={-560} text={lab[0]} s={s} f={f} at={st[0]} />}
            {lab[1] && <Label x={180} y={-420} text={lab[1]} s={s} fill={INK} f={f} at={st[1]} />}
        </Stage>
    );
};

// timer: a family at a table under a big stopwatch. The hand races (idle).
// steps[0] = the receipt lands, stamped text[0] ("PAID") · steps[1] = the family is moved out (slides off to the right) ·
// steps[2] = label text[1] ("15 MINUTES").
export const Timer: React.FC<{ it: KitItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, st = it.steps || [], lab = (it.text || 'PAID|15 MINUTES').split('|');
    const go = act(f, st[1], 12), hand = two(f) * 7;
    return (
        <Stage it={it} f={f}>
            {/* the stopwatch */}
            <g transform="translate(-200 -400)">
                <rect x={-22} y={-236} width={44} height={50} rx={8} fill={INK} />
                <circle cx={PX} cy={PY} r={190} fill={STRAW} /><circle r={190} fill={PAPER} stroke={INK} strokeWidth={SW + 6} />
                {Array.from({ length: 12 }, (_, i) => <line key={i} x1={0} y1={-170} x2={0} y2={-146} stroke={INK} strokeWidth={8} transform={`rotate(${i * 30})`} />)}
                <path d="M0 0 L0 -170 A170 170 0 0 1 170 0 Z" fill={STRAW} opacity={0.9} />
                <line x1={0} y1={18} x2={0} y2={-150} stroke={INK} strokeWidth={12} transform={`rotate(${hand})`} /><circle r={16} fill={INK} />
            </g>
            {/* the family at its table */}
            <g transform={`translate(${200 + 520 * go} 0)`} opacity={go >= 1 ? 0 : 1}>
                <Table x={0} s={1.5} />
                <Person x={-150} h={240} f={f} /><Person x={150} h={220} f={f} /><Kid x={40} y={-150} h={90} f={f} />
            </g>
            {on(f, st[0]) && <g transform={`translate(200 ${-330 - 60 * (1 - act(f, st[0], 6))}) rotate(6)`}>
                <Shape d="M-70 -110 H70 V90 l-20 -16 l-20 16 l-20 -16 l-20 16 l-20 -16 l-20 16 l-20 -16 Z" fill={WHITE} plate={MATCHA} />
                {[0, 1, 2].map((q) => <line key={q} x1={-44} y1={-76 + q * 26} x2={44} y2={-76 + q * 26} stroke={INK} strokeWidth={DW} />)}
                <text x={0} y={52} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={Math.max(40, 40 / s)} fill={STRAW}>{lab[0]}</text>
            </g>}
            <Ground />
            {lab[1] && <Label x={-200} y={-690} text={lab[1]} s={s} f={f} at={st[2]} />}
        </Stage>
    );
};

// shrink: the price goes up while the food gets smaller. A burger on a tray and its price tag.
// steps[0] = the price tag climbs (text[0] -> text[1]) · steps[1] = the burger shrinks · label text[2] with steps[1].
export const Shrink: React.FC<{ it: KitItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, st = it.steps || [], tx = (it.text || '₱75|₱120|LESS FOOD').split('|');
    const up = act(f, st[0], 10), sm = 1 - 0.45 * act(f, st[1], 10), fs = Math.max(64, 40 / s);
    return (
        <Stage it={it} f={f}>
            <Shape d="M-390 -40 H110 L80 0 H-360 Z" fill={INK} />
            <g transform={`translate(-140 -40) scale(${sm})`}>
                <Shape d="M-170 -150 A170 130 0 0 1 170 -150 Z" fill={STRAW} plate={INK} />
                {[-90, -20, 60, 110].map((x, i) => <ellipse key={i} cx={x} cy={-220 - (i % 2) * 24} rx={10} ry={5} fill={PAPER} />)}
                <path d="M-180 -150 q30 30 60 0 q30 30 60 0 q30 30 60 0 q30 30 60 0 q30 30 60 0 q30 30 60 0 V-120 H-180 Z" fill={MATCHA} stroke={INK} strokeWidth={DW} />
                <Shape d={box(-170, -120, 340, 50, 18)} fill={INK} />
                <Shape d={box(-170, -70, 340, 70, 24)} fill={STRAW} />
            </g>
            {/* the price tag on its pole climbs */}
            <g transform={`translate(270 ${-140 - 330 * up})`}>
                <line x1={0} y1={0} x2={0} y2={140 + 330 * up} stroke={INK} strokeWidth={12} />
                <Shape d={box(-130, -110, 260, 120, 12)} fill={PAPER} plate={STRAW} />
                <text x={0} y={-28} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={fs} fill={STRAW}>{up > 0.5 ? tx[1] : tx[0]}</text>
                {on(f, st[0]) && <path d="M150 -20 v-80 m-26 30 l26 -32 l26 32" fill="none" stroke={STRAW} strokeWidth={14} transform={`translate(0 ${idle(f, 4) ? -8 : 0})`} />}
            </g>
            <Ground />
            {tx[2] && <Label x={-140} y={-420} text={tx[2]} s={s} fill={INK} f={f} at={st[1]} />}
        </Stage>
    );
};

// delivery: the order comes from a phone and leaves on a motorbike; nobody walks in.
// steps[0] = the order pings on the phone (text[0], "ORDER") · steps[1] = the rider leaves with the bag ·
// steps[2] = the family at the door is struck out, label text[1].
export const Delivery: React.FC<{ it: KitItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, st = it.steps || [], lab = (it.text || 'ORDER|NO NEED TO WALK IN').split('|');
    const ride = act(f, st[1], 14), ping = on(f, st[0]);
    return (
        <Stage it={it} f={f}>
            {/* the phone */}
            <g transform="translate(-250 0)">
                <Shape d={box(-120, -470, 240, 470, 30)} fill={INK} plate={STRAW} />
                <rect x={-96} y={-430} width={192} height={380} rx={10} fill={PAPER} />
                {[0, 1, 2].map((i) => <rect key={i} x={-76} y={-400 + i * 70} width={152} height={50} rx={8} fill={i === 0 && ping ? MATCHA : '#d9cfb4'} stroke={INK} strokeWidth={DW} />)}
                {ping && <g transform={`translate(96 -430) scale(${1.5 - 0.5 * act(f, st[0], 6)})`}><circle r={44} fill={STRAW} stroke={INK} strokeWidth={SW} /><text y={18} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={52} fill="#fff">1</text></g>}
                <rect x={-76} y={-150} width={152} height={70} rx={10} fill={STRAW} stroke={INK} strokeWidth={DW} />
                <text x={0} y={-100} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={Math.max(40, 40 / s)} fill="#fff">{lab[0]}</text>
            </g>
            {/* the rider */}
            <g transform={`translate(${130 + 520 * ride} ${idle(f, 3) ? -3 : 0})`} opacity={ride >= 1 ? 0 : 1}>
                <circle cx={-90} cy={-50} r={50} fill={PAPER} stroke={INK} strokeWidth={SW + 4} /><circle cx={110} cy={-50} r={50} fill={PAPER} stroke={INK} strokeWidth={SW + 4} />
                <Shape d="M-100 -60 L-30 -150 H70 L120 -60 H40 L10 -100 H-40 Z" fill={STRAW} plate={INK} />
                <Person x={0} y={-130} h={200} lean={8} />
                <Shape d={box(-150, -300, 120, 120, 10)} fill={MATCHA} plate={STRAW} />
            </g>
            {/* the family that no longer needs to come in */}
            <g transform="translate(330 0)" opacity={on(f, st[1]) && ride < 1 ? 0 : 1}>
                <Person x={-50} h={200} /><Person x={30} h={185} /><Kid x={-110} h={105} f={f} />
                {on(f, st[2]) && <g transform={`translate(-30 -110) scale(${1.4 - 0.4 * act(f, st[2], 6)})`}><line x1={-110} y1={-110} x2={110} y2={110} stroke={STRAW} strokeWidth={24} /><line x1={110} y1={-110} x2={-110} y2={110} stroke={STRAW} strokeWidth={24} /></g>}
            </g>
            <Ground />
            {lab[1] && <Label x={60} y={-600} text={lab[1]} s={s} f={f} at={st[2]} />}
        </Stage>
    );
};

// ---------------------------------------------------------------------------------------------------------------------
// EP. 15 (the everyday plastic habit). Motif = THE LABO BAG (a thin plastic bag with knotted handles).
// ---------------------------------------------------------------------------------------------------------------------

// a labo bag: translucent paper-white body, strawberry out of register, two knotted ears; `c` = something inside
const Labo: React.FC<{ x: number; y: number; k?: number; r?: number; fill?: string; children?: React.ReactNode }> = ({ x, y, k = 1, r = 0, fill = WHITE, children }) => (
    <g transform={`translate(${x} ${y}) scale(${k}) rotate(${r})`}>
        <path d="M-70 -150 C-110 -60 -100 0 -60 0 H60 C100 0 110 -60 70 -150 Z" fill={STRAW} transform={`translate(${PX} ${PY})`} />
        {children}
        <path d="M-70 -150 C-110 -60 -100 0 -60 0 H60 C100 0 110 -60 70 -150 Z" fill={fill} fillOpacity={0.72} stroke={INK} strokeWidth={SW} />
        <path d="M-70 -150 q-30 -50 4 -70 q20 30 20 70 M70 -150 q30 -50 -4 -70 q-20 30 -20 70" fill={fill} stroke={INK} strokeWidth={SW} />
        <path d="M-46 -150 H46" stroke={INK} strokeWidth={DW} />
    </g>
);
const Egg: React.FC<{ x: number; y: number; k?: number }> = ({ x, y, k = 1 }) => (
    <g transform={`translate(${x} ${y}) scale(${k})`}><path d="M0 -92 C52 -92 70 -30 70 -8 A70 60 0 0 1 -70 -8 C-70 -30 -52 -92 0 -92 Z" fill={PAPER} stroke={INK} strokeWidth={SW} />
        <path d="M-40 -30 q10 -30 34 -40" fill="none" stroke={WHITE} strokeWidth={8} /></g>
);
// sari: the sari-sari store counter. The seller inside the grille, the buyer outside, one egg on the counter.
// steps[0] = the egg is set on the counter · steps[1] = the seller bags it (a labo bag closes round it) ·
// steps[2] = the buyer takes the bag. n = people queueing behind the buyer (they shuffle: the idle loop).
// w = 1: the buyer already carries a tote bag. text = "LABEL A|LABEL B": A with steps[1], B with steps[2].
export const Sari: React.FC<{ it: KitItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, st = it.steps || [], lab = (it.text || '').split('|'), q = it.n || 0;
    const bagged = act(f, st[1], 8), take = act(f, st[2], 10);
    const ex = 60 + 150 * take, ey = -268 + 60 * take;
    return (
        <Stage it={it} f={f}>
            {/* the store: roof, sign board, grille window, counter */}
            <path d="M-420 -520 L-360 -600 H130 L190 -520 Z" fill={STRAW} stroke={INK} strokeWidth={SW} />
            <Shape d={box(-390, -520, 550, 520, 6)} fill={PAPER} plate={MATCHA} />
            <rect x={-340} y={-470} width={450} height={210} fill={INK} />
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <line key={i} x1={-340 + i * 64} y1={-470} x2={-340 + i * 64} y2={-260} stroke={PAPER} strokeWidth={DW} />)}
            {[0, 1].map((i) => <line key={i} x1={-340} y1={-400 + i * 70} x2={110} y2={-400 + i * 70} stroke={PAPER} strokeWidth={DW} />)}
            {/* hanging sachet strips (tingi) */}
            {[0, 1, 2, 3, 4].map((i) => <g key={i} transform={`translate(${-300 + i * 90} -470) rotate(${[2, -2][idle(f + i * 3, 6)]})`}>
                {[0, 1, 2].map((j) => <rect key={j} x={-18} y={j * 44} width={36} height={40} fill={[STRAW, MATCHA, WHITE][(i + j) % 3]} stroke={INK} strokeWidth={3} />)}</g>)}
            <Person x={-120} y={-250} h={190} />
            <Shape d={box(-400, -260, 620, 40, 6)} fill={MATCHA} />
            {/* the egg, then the bag round it */}
            {on(f, st[0]) && <g transform={`translate(${ex} ${ey})`}>
                <Egg x={0} y={0} k={0.62 * (1.3 - 0.3 * act(f, st[0], 6))} />
                {on(f, st[1]) && <Labo x={0} y={14} k={0.62 * (1.5 - 0.5 * bagged)} />}
            </g>}
            {/* the buyer + the queue */}
            <Person x={300} h={300} lean={-3} />
            {it.w === 1 && <g transform="translate(372 -150)"><Shape d={box(-44, 0, 88, 100, 8)} fill={MATCHA} plate={STRAW} /><path d="M-26 0 q26 -70 52 0" fill="none" stroke={INK} strokeWidth={SW} /></g>}
            {Array.from({ length: q }, (_, i) => <Person key={i} x={385 + i * 62 - (idle(f, 6) ? 6 : 0)} h={270 - i * 14} />)}
            <Ground />
            {lab[0] && !on(f, st[2]) && <Label x={0} y={-680} text={lab[0]} s={s} f={f} at={st[1]} />}
            {lab[1] && <Label x={0} y={-680} text={lab[1]} s={s} fill={INK} f={f} at={st[2]} />}
        </Stage>
    );
};

// oneitem: one small item, big. n = 0: an egg, then a labo bag closes over it (steps[0]) and the label text[0] lands;
// n = 1: an open hand holds the egg (steps[0] = the bag beside it is struck out, label text[0]);
// n = 2: your own tote bag: the egg drops into it (steps[0]), label text[0].
export const OneItem: React.FC<{ it: KitItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, st = it.steps || [], lab = (it.text || '').split('|'), m = it.n || 0;
    const a = act(f, st[0], 8), bob = idle(f, 5) ? -6 : 0;
    return (
        <Stage it={it} f={f}>
            {m === 0 && <g>
                <Egg x={0} y={-150 + bob} k={2.3} />
                {on(f, st[0]) && <Labo x={0} y={0} k={2.5 * (1.3 - 0.3 * a)} />}
            </g>}
            {m === 1 && <g>
                <Shape d="M-230 -40 C-230 -150 -130 -190 -10 -190 H130 C210 -190 250 -150 250 -110 C250 -60 200 -30 120 -30 H-60 C-120 -30 -150 0 -230 0 Z" fill={STRAW} plate={INK} />
                {[0, 1, 2, 3].map((i) => <path key={i} d={`M${-60 + i * 70} -190 v-70 a26 26 0 0 1 52 0 v70`} fill={STRAW} stroke={INK} strokeWidth={SW} />)}
                <Egg x={40} y={-250 + bob} k={1.7} />
                <g transform="translate(-290 -330)"><Labo x={0} y={0} k={1.1} r={-8} />
                    {on(f, st[0]) && <g transform={`translate(0 -90) scale(${1.4 - 0.4 * a})`}><line x1={-90} y1={-90} x2={90} y2={90} stroke={STRAW} strokeWidth={24} /><line x1={90} y1={-90} x2={-90} y2={90} stroke={STRAW} strokeWidth={24} /></g>}</g>
            </g>}
            {m === 2 && <g>
                <path d="M-110 -360 q110 -260 220 0" fill="none" stroke={INK} strokeWidth={22} />
                <Shape d="M-230 -380 H230 L200 0 H-200 Z" fill={MATCHA} plate={STRAW} />
                <path d="M-150 -300 H150" stroke={PAPER} strokeWidth={10} strokeDasharray="26 18" />
                <Egg x={0} y={on(f, st[0]) ? -420 + 150 * a + bob : -640 + bob} k={1.1} />
                <Shape d={box(250, -150, 150, 150, 26)} fill={STRAW} plate={INK} /><path d="M270 -110 H380" stroke={PAPER} strokeWidth={8} strokeDasharray="14 10" />
            </g>}
            <Ground />
            {lab[0] && <Label x={0} y={m === 2 ? -730 : -640} text={lab[0]} s={s} f={f} at={st[0]} fill={m === 0 ? STRAW : MATCHA} />}
        </Stage>
    );
};

// bags: the count. A sheet that fills with rows of small labo bags.
// steps[0] = the first block lands (label text[0]) · steps[1] = the second block (label text[1]) · steps[2] = the total (text[2]).
// n = 1: totes instead of labo bags (the small choices), one block only.
export const Bags: React.FC<{ it: KitItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, st = it.steps || [], lab = (it.text || '').split('|'), tote = it.n === 1;
    const cols = 10, rows = 6;
    const cell = (i: number, fill: string) => {
        const c = i % cols, r = Math.floor(i / cols), x = -360 + c * 80, y = -430 + r * 78 + (idle(f + c * 3, 6) ? -4 : 0);
        return tote
            ? <g key={i} transform={`translate(${x} ${y})`}><path d="M-12 -30 q12 -30 24 0" fill="none" stroke={INK} strokeWidth={5} /><rect x={-24} y={-30} width={48} height={44} rx={5} fill={fill} stroke={INK} strokeWidth={DW} /></g>
            : <g key={i} transform={`translate(${x} ${y}) scale(0.32)`}><path d="M-70 -150 C-110 -60 -100 0 -60 0 H60 C100 0 110 -60 70 -150 Z M-70 -150 q-30 -50 4 -70 q20 30 20 70 M70 -150 q30 -50 -4 -70 q-20 30 -20 70" fill={fill} stroke={INK} strokeWidth={DW / 0.32} /></g>;
    };
    const n1 = on(f, st[0]) ? Math.min(30, Math.floor(two(f - st[0]) / 1) + 2) : 0, n2 = on(f, st[1]) ? Math.min(30, Math.floor(two(f - st[1]) / 1) + 2) : 0;
    return (
        <Stage it={it} f={f}>
            <Shape d={box(-410, -500, 820, 500, 10)} fill={PAPER} plate={STRAW} />
            {Array.from({ length: n1 }, (_, i) => cell(i, tote ? MATCHA : WHITE))}
            {Array.from({ length: n2 }, (_, i) => cell(30 + i, STRAW))}
            <Ground />
            {lab[0] && !on(f, st[2]) && <Label x={-180} y={-590} text={lab[0]} s={s} fill={INK} f={f} at={st[0]} />}
            {lab[1] && !on(f, st[2]) && <Label x={200} y={-590 - Math.max(44, 40 / s) * 2.25} text={lab[1]} s={s} f={f} at={st[1]} />}
            {lab[2] && <Label x={0} y={-590} text={lab[2]} s={s} f={f} at={st[2]} />}
        </Stage>
    );
};

// river: a thin bag is refused by the recycling bin and ends in the water.
// steps[0] = the bin spits the bag back out (X, label text[0]) · steps[1] = bags drift down the river ·
// steps[2] = they reach the sea (label text[1]).
export const River: React.FC<{ it: KitItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, st = it.steps || [], lab = (it.text || '').split('|');
    const rej = act(f, st[0], 8), flow = on(f, st[1]) ? two(f - (st[1] || 0)) : -1, wave = idle(f, 5) ? 8 : 0;
    return (
        <Stage it={it} f={f}>
            {/* the water: river from the left into the sea on the right */}
            <path d={`M-410 -150 C-250 ${-190 + wave} -120 ${-110 - wave} 40 -150 C120 -170 180 -230 410 -230 V0 H-410 Z`} fill={MATCHA} stroke={INK} strokeWidth={SW} />
            {[0, 1, 2].map((i) => <path key={i} d={`M${-360 + i * 250} ${-90 + i * 8} q40 ${-24 + wave} 80 0 q40 ${24 - wave} 80 0`} fill="none" stroke={PAPER} strokeWidth={DW + 2} />)}
            {/* the recycling bin on the bank */}
            <g transform="translate(-270 -168)">
                <Shape d="M-90 -230 H90 L70 0 H-70 Z" fill={PAPER} plate={STRAW} />
                <rect x={-104} y={-262} width={208} height={36} rx={8} fill={INK} />
                <path d="M0 -170 l34 56 h-68 Z M-46 -70 l34 -56 M46 -70 l-34 -56" fill="none" stroke={MATCHA} strokeWidth={12} />
                {on(f, st[0]) && <g transform={`translate(0 -120) scale(${1.4 - 0.4 * rej})`}><line x1={-80} y1={-80} x2={80} y2={80} stroke={STRAW} strokeWidth={22} /><line x1={80} y1={-80} x2={-80} y2={80} stroke={STRAW} strokeWidth={22} /></g>}
            </g>
            {/* the bag: over the bin, then thrown back, then many drifting */}
            {!on(f, st[1]) && <Labo x={-270 + 150 * rej} y={-470 + 250 * rej + (idle(f, 4) ? -8 : 0)} k={0.8} r={-10 + 40 * rej} />}
            {flow >= 0 && [0, 1, 2, 3, 4].map((i) => {
                const p = cl((flow - i * 10) / 70), x = -330 + 700 * p, y = -120 - 70 * p + (idle(f + i * 2, 4) ? -8 : 0);
                return flow >= i * 10 ? <Labo key={i} x={x} y={y} k={0.5} r={[-20, 14, -8, 24, 6][i]} /> : null;
            })}
            <Ground />
            {lab[0] && !on(f, st[2]) && <Label x={-150} y={-600} text={lab[0]} s={s} f={f} at={st[0]} />}
            {lab[1] && <Label x={100} y={-600} text={lab[1]} s={s} fill={INK} f={f} at={st[2]} />}
        </Stage>
    );
};

// eprlaw: who the law covers. A big company building and a small sari-sari store, the law's page between them.
// steps[0] = the target (text[0], "80% BY 2028") is stamped on the company · steps[1] = the small store gets its tag
// (text[1], "NO TARGET") · steps[2] = label text[2] ("NO NATIONWIDE BAN").
export const EprLaw: React.FC<{ it: KitItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, st = it.steps || [], tx = (it.text || '80% BY 2028|NO TARGET|NO NATIONWIDE BAN').split('|');
    const fs = Math.max(42, 40 / s), smoke = idle(f, 5);
    return (
        <Stage it={it} f={f}>
            {/* the big company */}
            <g transform="translate(-220 0)">
                <Shape d={box(-170, -430, 340, 430, 6)} fill={INK} plate={STRAW} />
                {Array.from({ length: 12 }, (_, i) => <rect key={i} x={-130 + (i % 3) * 96} y={-390 + Math.floor(i / 3) * 86} width={64} height={52} fill={PAPER} />)}
                <rect x={70} y={-540} width={56} height={110} fill={INK} /><circle cx={98 + smoke * 10} cy={-580 - smoke * 14} r={30} fill="url(#kitht)" />
                <rect x={-40} y={-80} width={80} height={80} fill={STRAW} />
                {on(f, st[0]) && <g transform={`translate(0 -250) rotate(-8) scale(${1.5 - 0.5 * act(f, st[0], 6)})`}>
                    <rect x={-(tx[0].length * fs * 0.4 + 30)} y={-fs * 0.85} width={tx[0].length * fs * 0.8 + 60} height={fs * 1.7} fill={MATCHA} stroke={INK} strokeWidth={SW} />
                    <text x={0} y={fs * 0.36} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={fs} letterSpacing={2} fill="#fff">{tx[0]}</text></g>}
            </g>
            {/* the small store */}
            <g transform="translate(250 0)">
                <path d="M-150 -210 L-110 -270 H110 L150 -210 Z" fill={STRAW} stroke={INK} strokeWidth={SW} />
                <Shape d={box(-130, -210, 260, 210, 6)} fill={PAPER} plate={MATCHA} />
                <rect x={-100} y={-180} width={200} height={90} fill={INK} />{[0, 1, 2, 3].map((i) => <line key={i} x1={-100 + i * 66} y1={-180} x2={-100 + i * 66} y2={-90} stroke={PAPER} strokeWidth={DW} />)}
                <Labo x={0} y={-10} k={0.42} />
                {on(f, st[1]) && <g transform={`translate(0 -330) rotate(6) scale(${1.5 - 0.5 * act(f, st[1], 6)})`}>
                    <rect x={-(tx[1].length * fs * 0.4 + 30)} y={-fs * 0.85} width={tx[1].length * fs * 0.8 + 60} height={fs * 1.7} fill={STRAW} stroke={INK} strokeWidth={SW} />
                    <text x={0} y={fs * 0.36} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={fs} letterSpacing={2} fill="#fff">{tx[1]}</text></g>}
            </g>
            <Ground />
            {tx[2] && <Label x={0} y={-680} text={tx[2]} s={s} fill={INK} f={f} at={st[2]} />}
        </Stage>
    );
};

// mall: only the big mall's parking lot gets cleaned; the street corner is left out; both drain to the same place.
// steps[0] = the mall lot is swept clean (its litter goes) · steps[1] = the street corner keeps its litter, label text[0] ·
// steps[2] = the corner's litter slides into the drain between them, label text[1].
export const Mall: React.FC<{ it: KitItem; f: number }> = ({ it, f }) => {
    const s = it.s || 1, st = it.steps || [], lab = (it.text || 'LEFT OUT OF THE RULE|THE SAME DRAIN').split('|');
    const clean = act(f, st[0], 10), drain = act(f, st[2], 14), sweep = idle(f, 4) ? 10 : -10;
    const litter = (x0: number, n: number, gone: number, to?: number) => Array.from({ length: n }, (_, i) => {
        const x = x0 + i * 46 + (rnd(i + x0) - 0.5) * 20, tx2 = to === undefined ? x : x + (to - x) * drain, y = to === undefined ? -14 : -14 + 40 * drain;
        return <g key={i} opacity={gone >= 1 || (to !== undefined && drain >= 1) ? 0 : 1} transform={`translate(${tx2 + (to === undefined ? -80 * gone : 0)} ${y}) rotate(${rnd(i) * 60 - 30})`}><Labo x={0} y={0} k={0.22} /></g>;
    });
    return (
        <Stage it={it} f={f}>
            {/* the mall */}
            <g transform="translate(-235 0)">
                <Shape d={box(-170, -400, 340, 300, 8)} fill={PAPER} plate={MATCHA} />
                <rect x={-170} y={-400} width={340} height={70} fill={MATCHA} stroke={INK} strokeWidth={SW} />
                <text x={0} y={-350} textAnchor="middle" fontFamily={ARIAL} fontWeight={700} fontSize={Math.max(44, 40 / s)} letterSpacing={6} fill="#fff">MALL</text>
                {[0, 1, 2].map((i) => <rect key={i} x={-130 + i * 96} y={-290} width={68} height={130} fill={INK} />)}
                <rect x={-170} y={-100} width={340} height={100} fill="#d9cfb4" stroke={INK} strokeWidth={SW} />
                {[0, 1, 2, 3].map((i) => <line key={i} x1={-120 + i * 80} y1={-100} x2={-120 + i * 80} y2={-20} stroke={INK} strokeWidth={DW} />)}
                {litter(-130, 6, clean)}
                {on(f, st[0]) && clean < 1 && <g transform={`translate(${-150 + 300 * clean} -20) rotate(${sweep})`}><line x1={0} y1={-150} x2={0} y2={0} stroke={INK} strokeWidth={10} /><path d="M-36 0 H36 L50 34 H-50 Z" fill={STRAW} stroke={INK} strokeWidth={DW} /></g>}
            </g>
            {/* the drain */}
            <g transform="translate(15 0)"><rect x={-44} y={-10} width={88} height={34} rx={6} fill={INK} />{[0, 1, 2].map((i) => <line key={i} x1={-26 + i * 26} y1={-4} x2={-26 + i * 26} y2={18} stroke={PAPER} strokeWidth={5} />)}</g>
            {/* the street corner */}
            <g transform="translate(250 0)">
                <Shape d={box(-110, -250, 220, 250, 6)} fill={PAPER} plate={STRAW} />
                <path d="M-130 -250 L-95 -300 H95 L130 -250 Z" fill={STRAW} stroke={INK} strokeWidth={SW} />
                <rect x={-80} y={-210} width={160} height={90} fill={INK} />
                <rect x={130} y={-330} width={12} height={330} fill={INK} /><Shape d={box(96, -390, 80, 70, 8)} fill={MATCHA} />
            </g>
            {litter(120, 6, 0, 15)}
            <Ground />
            {lab[0] && !on(f, st[2]) && <Label x={250} y={-500} text={lab[0]} s={s} f={f} at={st[1]} />}
            {lab[1] && <Label x={0} y={-560} text={lab[1]} s={s} fill={INK} f={f} at={st[2]} />}
        </Stage>
    );
};

export const kitScene = (it: KitItem, f: number, key: number): React.ReactNode | undefined => {
    switch (it.kind) {
        case 'road': return <Road key={key} it={it} f={f} />;
        case 'bids': return <Bids key={key} it={it} f={f} />;
        case 'roof': return <Roof key={key} it={it} f={f} />;
        case 'stacks': return <Stacks key={key} it={it} f={f} />;
        case 'kickback': return <Kickback key={key} it={it} f={f} />;
        case 'balance': return <Balance key={key} it={it} f={f} />;
        case 'corner': return <Corner key={key} it={it} f={f} />;
        case 'hook': return <Hook key={key} it={it} f={f} />;
        case 'target': return <Target key={key} it={it} f={f} />;
        case 'cafe': return <Cafe key={key} it={it} f={f} />;
        case 'timer': return <Timer key={key} it={it} f={f} />;
        case 'shrink': return <Shrink key={key} it={it} f={f} />;
        case 'delivery': return <Delivery key={key} it={it} f={f} />;
        case 'sari': return <Sari key={key} it={it} f={f} />;
        case 'oneitem': return <OneItem key={key} it={it} f={f} />;
        case 'bags': return <Bags key={key} it={it} f={f} />;
        case 'river': return <River key={key} it={it} f={f} />;
        case 'eprlaw': return <EprLaw key={key} it={it} f={f} />;
        case 'mall': return <Mall key={key} it={it} f={f} />;
        default: return undefined;
    }
};
