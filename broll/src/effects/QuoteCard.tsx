// Quote card: either an editorial quote card or a top notification/alert banner.
import React from 'react';
import { interpolate } from 'remotion';
import { Common, FONT, Place, WordsIn, ease, useInOut, wordCount, wordSpans } from '../lib/common';

type P = Common & { title: string; body: string; author: string; alert: boolean; dark: boolean };

export const QuoteCard: React.FC<P> = (p) => {
    const { frame, real, durationInFrames: D, inn, out } = useInOut(p, (D0) => Math.max(10, Math.round(D0 * 0.45)));
    const body = p.alert ? (p.body || 'Check this before posting') : (p.body || 'Keep it simple');
    const sp = wordSpans(p, wordCount(body), (_i, a) => a + 4);   // Land on word: each word from its in to its end frame
    const times = sp ? sp.at : null;
    const end = Math.max(10, Math.round(D * 0.45));
    const reveal = interpolate(frame, [3, end], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });

    const bg = p.dark ? 'rgba(24, 26, 31, 0.95)' : 'rgba(252, 251, 248, 0.97)';
    const fg = p.dark ? '#f5f6f8' : '#181a1e';
    const dim = p.dark ? 'rgba(255,255,255,.65)' : 'rgba(24,26,30,.6)';

    if (p.alert) {
        return (
            <Place p={p}>
                <div style={{ width: 680, padding: '20px 26px', borderRadius: 22, background: bg,
                    boxShadow: '0 22px 52px rgba(0,0,0,.32)', border: `2px solid ${p.accent}`,
                    display: 'flex', alignItems: 'center', gap: 18,
                    opacity: out * Math.min(1, inn * 1.4), transform: `translateY(${(1 - inn) * -36}px)` }}>
                    <div style={{ width: 52, height: 52, borderRadius: 14, background: p.accent, color: '#111',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        fontFamily: FONT.sans, fontWeight: 800, fontSize: 28 }}>!</div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontFamily: FONT.sans, fontWeight: 700, fontSize: 20, textTransform: 'uppercase',
                            letterSpacing: 1.2, color: p.accent, marginBottom: 4 }}>{p.title || 'Reminder'}</div>
                        <div style={{ fontFamily: FONT.sans, fontWeight: 600, fontSize: 30, lineHeight: 1.25, color: fg,
                            opacity: times ? 1 : reveal }}>{times ? <WordsIn text={body} times={times} ends={sp ? sp.end : undefined} frame={real} /> : body}</div>
                    </div>
                </div>
            </Place>
        );
    }

    return (
        <Place p={p}>
            <div style={{ maxWidth: 740, padding: '28px 36px', borderRadius: 22, background: bg,
                boxShadow: '0 24px 56px rgba(0,0,0,.32)', borderLeft: `8px solid ${p.accent}`,
                opacity: out * Math.min(1, inn * 1.4), transform: `translateY(${(1 - inn) * 32}px)` }}>
                {p.title && (
                    <div style={{ fontFamily: FONT.sans, fontWeight: 700, fontSize: 20, textTransform: 'uppercase',
                        letterSpacing: 1.4, color: p.accent, marginBottom: 10 }}>{p.title}</div>
                )}
                <div style={{ fontFamily: FONT.serifItalic, fontSize: 44, lineHeight: 1.2, color: fg, opacity: times ? 1 : reveal }}>
                    {times ? <WordsIn text={'“' + body + '”'} times={times} ends={sp ? sp.end : undefined} frame={real} /> : '“' + body + '”'}
                </div>
                {p.author && (
                    <div style={{ marginTop: 14, fontFamily: FONT.sans, fontWeight: 600, fontSize: 22, color: dim }}>
                        — {p.author}
                    </div>
                )}
            </div>
        </Place>
    );
};
