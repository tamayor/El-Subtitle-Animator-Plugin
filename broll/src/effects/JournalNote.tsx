// Journal note: "page" = a lined notebook page (taped on) where the lines appear as if written by hand; "reveal" =
// the words alone, writing themselves left to right in a marker hand over the footage.
import React from 'react';
import { loadFont as loadMarker } from '@remotion/google-fonts/PermanentMarker';
import { Common, FONT, Place, clamp, prog, useInOut } from '../lib/common';
import { Grain, SHADOW, Tape } from '../lib/paper';

const MARKER = loadMarker('normal', { weights: ['400'], subsets: ['latin'] }).fontFamily;

type P = Common & { mode: string; title: string; lines: string[]; ink: string; font: string; underline: boolean };

// One line written left to right: a soft-edged wipe that follows the pen.
const Written: React.FC<{ k: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ k, children, style }) => {
    const a = clamp(k) * 112 - 6;
    return <div style={{ ...style, WebkitMaskImage: `linear-gradient(90deg, #000 ${a}%, transparent ${a + 6}%)`, maskImage: `linear-gradient(90deg, #000 ${a}%, transparent ${a + 6}%)`,
        visibility: k <= 0 ? 'hidden' : 'visible' }}>{children}</div>;
};

export const JournalNote: React.FC<P> = (p) => {
    const lines = (p.lines || []).map(String).filter(Boolean).slice(0, 7);
    const chars = lines.reduce((s, l) => s + l.length, 0) + String(p.title || '').length;
    const pace = (D0: number, f: number) => Math.max(12, Math.min(Math.round(D0 * 0.7), Math.round((chars / 22) * f)));
    const { frame, fps, durationInFrames: D, inn } = useInOut(p, pace);
    const end = pace(D, fps);
    const reveal = String(p.mode) === 'reveal';
    const font = String(p.font) === 'marker' ? MARKER : FONT.hand;
    // each line gets a share of the build by its length
    const units = [String(p.title || ''), ...lines];
    let acc = 0;
    const spans = units.map(t => { const a = acc; acc += Math.max(4, t.length); return [a, acc]; });
    const kOf = (i: number) => prog(frame, 2 + (spans[i][0] / acc) * (end - 2), 2 + (spans[i][1] / acc) * (end - 2));
    if (reveal) {
        const ink = p.ink && p.ink.toLowerCase() !== '#22304a' ? p.ink : '#ffffff';
        return (
            <Place p={p}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, transform: 'rotate(-2.5deg)', textShadow: '0 4px 14px rgba(0,0,0,.55)' }}>
                    {p.title && <Written k={kOf(0)} style={{ fontFamily: font, fontSize: 70, color: p.accent, whiteSpace: 'nowrap', padding: '0 20px' }}>{p.title}</Written>}
                    {lines.map((l, i) => (
                        <div key={i} style={{ position: 'relative' }}>
                            <Written k={kOf(i + 1)} style={{ fontFamily: font, fontWeight: 700, fontSize: font === MARKER ? 112 : 150, lineHeight: 1.05, color: ink, whiteSpace: 'nowrap', padding: '0 24px' }}>{l}</Written>
                            {p.underline && i === lines.length - 1 && (
                                <div style={{ position: 'absolute', left: 14, right: 14, bottom: -10, height: 12, borderRadius: 12, background: p.accent,
                                    transform: `rotate(-0.8deg) scaleX(${prog(frame, end, end + 8)})`, transformOrigin: 'left center' }} />
                            )}
                        </div>
                    ))}
                </div>
            </Place>
        );
    }
    const ink = p.ink || '#22304a', LH = 78;
    return (
        <Place p={p}>
            <div style={{ position: 'relative', width: 700, padding: '54px 52px 40px 96px', background: '#fbf7ea', borderRadius: 6, boxShadow: SHADOW.lift, overflow: 'visible',
                opacity: clamp(inn * 1.6), transform: `rotate(${-2 + (1 - inn) * -5}deg) translateY(${(1 - inn) * 60}px)`,
                backgroundImage: `repeating-linear-gradient(180deg, transparent 0, transparent ${LH - 3}px, rgba(70,110,170,.32) ${LH - 3}px, rgba(70,110,170,.32) ${LH}px)`, backgroundPosition: '0 62px' }}>
                <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: 6 }}><Grain id="jng" opacity={0.2} /></div>
                <div style={{ position: 'absolute', left: 74, top: 0, bottom: 0, width: 3, background: 'rgba(220,70,70,.5)' }} />
                {[0.2, 0.5, 0.8].map(t => <div key={t} style={{ position: 'absolute', left: 24, top: `${t * 100}%`, width: 26, height: 26, borderRadius: 26, background: 'rgba(0,0,0,.28)', boxShadow: 'inset 0 3px 5px rgba(0,0,0,.4)' }} />)}
                <Tape left="50%" top={0} width={170} angle={-3} />
                <div style={{ position: 'relative' }}>
                    {p.title && <Written k={kOf(0)} style={{ fontFamily: font, fontWeight: 700, fontSize: 62, lineHeight: `${LH}px`, color: p.accent, filter: 'brightness(.62) saturate(1.5)', whiteSpace: 'nowrap' }}>{p.title}</Written>}
                    {lines.map((l, i) => <Written key={i} k={kOf(i + 1)} style={{ fontFamily: font, fontSize: font === MARKER ? 44 : 58, lineHeight: `${LH}px`, color: ink, whiteSpace: 'nowrap' }}>{l}</Written>)}
                </div>
            </div>
        </Place>
    );
};
