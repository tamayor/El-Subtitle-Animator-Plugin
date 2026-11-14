// Comment drop: a comment box types a word and posts it; the creator's comment drops in, its hearts tick up, and the
// typed reply lands under it.
import React from 'react';
import { interpolate, spring } from 'remotion';
import { Common, FONT, Place, typed, useInOut } from '../lib/common';
import { Look, readable, useVibe } from '../lib/vibe';

type P = Common & { keyword: string; user: string; comment: string; author: string; likes: number; reply: boolean; replyText?: string; cta?: string };

const Avatar: React.FC<{ letter: string; color: string; size: number }> = ({ letter, color, size }) => (
    <div style={{ width: size, height: size, borderRadius: size, background: color, color: readable(color), flex: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT.sans, fontWeight: 700, fontSize: size * 0.45 }}>
        {(letter || '?').slice(0, 1).toUpperCase()}
    </div>
);

const Heart: React.FC<{ on: boolean; n: number; pop: number }> = ({ on, n, pop }) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 40, transform: `scale(${1 + pop * 0.35})` }}>
        <svg width={26} height={24} viewBox="0 0 24 22">
            <path d="M12 21s-8.5-5.3-10.6-10.2C-0.3 6.6 2.4 2 6.6 2c2.4 0 4.1 1.3 5.4 3.1C13.3 3.3 15 2 17.4 2c4.2 0 6.9 4.6 5.2 8.8C20.5 15.7 12 21 12 21z"
                fill={on ? '#e0245e' : 'none'} stroke={on ? '#e0245e' : '#9a9a9a'} strokeWidth={2} />
        </svg>
        {n > 0 && <div style={{ fontFamily: FONT.sans, fontSize: 15, color: '#777', marginTop: 2 }}>{n}</div>}
    </div>
);

const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; L: Look }> = ({ children, style, L }) => (
    <div style={{ ...(L.v.id === 'classic' ? { background: '#fff', borderRadius: 20, boxShadow: '0 10px 30px rgba(0,0,0,.28)' } : L.card(20)),
        padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14, ...style }}>{children}</div>
);

export const CommentDrop: React.FC<P> = (p) => {
    const { frame, fps, durationInFrames: D, inn, out } = useInOut(p, (D0, f) => {
        // landed: the comment has dropped in, with the typed word
        const ts = Math.round(p.enter ?? 10), te = ts + Math.ceil(String(p.keyword || '').length / 10 * f) + 4;
        return Math.min(te + 6, Math.round(D0 * 0.55)) + 8;
    });
    const kw = String(p.keyword || '');
    const L = useVibe(p), classic = L.v.id === 'classic';
    const ink = classic ? '#111' : L.ink, dim = classic ? '#666' : L.dim;
    const typeStart = Math.round(p.enter ?? 10);
    const typeEnd = typeStart + Math.ceil(kw.length / 10 * fps) + 4;
    const post = Math.min(typeEnd + 6, Math.round(D * 0.55));
    const replyAt = post + 10;
    const text = frame < post ? typed(kw, frame, typeStart, fps, 10) : kw;
    const caret = Math.floor(frame / 8) % 2 === 0;

    const inputOut = interpolate(frame, [post, post + 6], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    const drop = spring({ frame: frame - post, fps, config: classic ? { damping: 13, stiffness: 140 } : L.spring });
    const dropR = spring({ frame: frame - replyAt, fps, config: classic ? { damping: 13, stiffness: 140 } : L.spring });
    const likes = Math.max(0, Math.round(p.likes || 0));
    const shown = Math.round(interpolate(frame, [post + 6, D - (p.exit ?? 0) - 4], [0, likes], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
    const pop = Math.max(0, 1 - ((frame - post - 6) % 8) / 8) * (shown > 0 && shown < likes ? 1 : 0);

    return (
        <Place p={p}>
            <div style={{ width: 720, position: 'relative', opacity: out, fontFamily: classic ? FONT.sans : L.v.font.body }}>
                {/* the input, typing */}
                <Card L={L} style={{ opacity: inputOut * inn, transform: `translateY(${(1 - inn) * -30}px)`, position: 'absolute', left: 0, right: 0, top: 0 }}>
                    <Avatar letter={p.user} color={L.accent} size={46} />
                    <div style={{ flex: 1, fontSize: 26, color: text ? ink : (classic ? '#9a9a9a' : L.dim), fontWeight: text ? 700 : 400 }}>
                        {text || 'Add a comment…'}{text && caret ? <span style={{ fontWeight: 300 }}>|</span> : null}
                    </div>
                    <div style={{ background: text ? L.accent : (classic ? '#eee' : L.track), color: text ? L.onAccent : (classic ? '#999' : L.dim), borderRadius: L.r(20),
                        padding: '8px 18px', fontSize: 20, fontWeight: 600 }}>Post</div>
                </Card>
                {/* the creator's comment */}
                {frame >= post && (
                    <Card L={L} style={{ transform: `translateY(${(1 - drop) * -120}px)`, opacity: Math.min(1, drop * 1.5), alignItems: 'flex-start' }}>
                        <Avatar letter={p.author} color="#d6c7a1" size={52} />
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 18, color: dim }}><b style={{ color: ink }}>{p.author}</b> · now</div>
                            <div style={{ fontSize: 28, color: ink, lineHeight: 1.25, marginTop: 4 }}>{String(p.comment || "").split("{keyword}").join(kw)}</div>
                        </div>
                        <Heart on={shown > 0} n={shown} pop={pop} />
                    </Card>
                )}
                {/* the reply */}
                {p.reply && frame >= replyAt && (
                    <Card L={L} style={{ marginTop: 14, marginLeft: 48, transform: `translateY(${(1 - dropR) * -80}px)`, opacity: Math.min(1, dropR * 1.5) }}>
                        <Avatar letter={p.user} color={L.accent} size={40} />
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 16, color: dim }}><b style={{ color: ink }}>{p.user}</b> · now</div>
                            <div style={{ fontSize: 26, color: ink, fontWeight: p.replyText ? 600 : 800 }}>{p.replyText || kw}</div>
                            {p.cta && (
                                <div style={{ display: 'inline-block', marginTop: 10, padding: '8px 22px', borderRadius: L.r(24), background: L.accent, color: L.onAccent, fontSize: 22, fontWeight: 700,
                                    transform: `scale(${spring({ frame: frame - replyAt - 8, fps, config: { damping: 12, stiffness: 200 } })})`, transformOrigin: 'left center' }}>{p.cta}</div>
                            )}
                        </div>
                        <Heart on={false} n={0} pop={0} />
                    </Card>
                )}
            </div>
        </Place>
    );
};
