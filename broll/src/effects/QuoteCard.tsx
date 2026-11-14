// Quote card: either an editorial quote card or a top notification/alert banner.
import React from 'react';
import { interpolate } from 'remotion';
import { Common, Place, WordsIn, ease, useInOut, wordCount, wordSpans } from '../lib/common';
import { useVibe } from '../lib/vibe';

type P = Common & { title: string; body: string; author: string; alert: boolean; dark: boolean };

export const QuoteCard: React.FC<P> = (p) => {
    const { frame, real, durationInFrames: D, inn } = useInOut(p, (D0) => Math.max(10, Math.round(D0 * 0.45)));
    const body = p.alert ? (p.body || 'Check this before posting') : (p.body || 'Keep it simple');
    const sp = wordSpans(p, wordCount(body), (_i, a) => a + 4);   // Land on word: each word from its in to its end frame
    const times = sp ? sp.at : null;
    const end = Math.max(10, Math.round(D * 0.45));
    const reveal = interpolate(frame, [3, end], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });

    const L = useVibe(p);

    if (p.alert) {
        return (
            <Place p={p}>
                <div style={{ ...L.card(22), width: 680, padding: '20px 26px',
                    display: 'flex', alignItems: 'center', gap: 18, ...L.enter(inn, 'down') }}>
                    <div style={{ width: 52, height: 52, borderRadius: L.r(14), background: L.accent, color: L.onAccent,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        ...L.text.num(28, { color: L.onAccent }) }}>!</div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ ...L.text.label(20), marginBottom: 4 }}>{p.title || 'Reminder'}</div>
                        <div style={{ ...L.text.body(30), opacity: times ? 1 : reveal }}>{times ? <WordsIn text={body} times={times} ends={sp ? sp.end : undefined} frame={real} /> : body}</div>
                    </div>
                </div>
            </Place>
        );
    }

    return (
        <Place p={p}>
            <div style={{ ...L.card(22), position: 'relative', overflow: 'hidden', maxWidth: 740, padding: '28px 36px 28px 44px', ...L.enter(inn) }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 8, background: L.accent }} />
                {p.title && (
                    <div style={{ ...L.text.label(20), marginBottom: 10 }}>{p.title}</div>
                )}
                <div style={{ ...L.text.quote(44), opacity: times ? 1 : reveal }}>
                    {times ? <WordsIn text={'“' + body + '”'} times={times} ends={sp ? sp.end : undefined} frame={real} /> : '“' + body + '”'}
                </div>
                {p.author && (
                    <div style={{ marginTop: 14, ...L.text.label(22, { textTransform: 'none', letterSpacing: 0 }) }}>
                        — {p.author}
                    </div>
                )}
            </div>
        </Place>
    );
};
