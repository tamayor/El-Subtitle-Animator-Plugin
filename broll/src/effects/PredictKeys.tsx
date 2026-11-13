// Predict keys: a phone keyboard slides up and types the text; each pressed key pops and the suggestion bar follows
// the word being typed.
import React from 'react';
import { interpolate } from 'remotion';
import { Common, FONT, Place, useInOut, wordSpans } from '../lib/common';

type P = Common & { text: string; suggestions: string[]; dark: boolean };

const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

type KeyProps = {
    ch: string; w?: number; dark?: boolean; label?: string;
    keyOn: boolean; last: string; keyBg: string; key2Bg: string; ink: string; dk: boolean;
};

const Key: React.FC<KeyProps> = ({ ch, w = 74, dark, label, keyOn, last, keyBg, key2Bg, ink, dk }) => {
    const on = keyOn && ch.length === 1 && ch === last;
    return (
        <div style={{ width: w, height: 92, borderRadius: 10, background: dark ? key2Bg : keyBg, color: ink, position: 'relative',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT.sans, fontSize: label ? 24 : 38,
            boxShadow: `0 2px 0 ${dk ? '#111' : '#898a8d'}` }}>
            {label || ch}
            {on && (
                <div style={{ position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)', width: w * 1.35, height: 120,
                    background: keyBg, borderRadius: 14, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 10,
                    fontSize: 54, boxShadow: '0 4px 16px rgba(0,0,0,.3)', zIndex: 3 }}>{ch}</div>
            )}
        </div>
    );
};

export const PredictKeys: React.FC<P> = (p) => {
    const { frame, real, fps, durationInFrames: D, inn, out } = useInOut(p, (D0, f) => {
        // landed: the last letter typed
        const st = Math.round((p.enter ?? 10) + 4), en = Math.max(st + 1, D0 - (p.exit ?? 8) - Math.round(f * 0.5));
        const len = Math.max(1, String(p.text || '').length);
        return st + len * Math.max(1.5, Math.min(f / 8, (en - st) / len));
    });
    const text = String(p.text || '');
    const start = Math.round((p.enter ?? 10) + 4);
    const end = Math.max(start + 1, D - (p.exit ?? 8) - Math.round(fps * 0.5));
    const perChar = Math.max(1.5, Math.min(fps / 8, (end - start) / Math.max(1, text.length)));
    let n = Math.max(0, Math.min(text.length, Math.floor((frame - start) / perChar) + 1));
    let shown = frame < start ? '' : text.slice(0, n);
    let sinceKey = frame < start ? 99 : (frame - start) % perChar;
    let keyOn = sinceKey < Math.min(4, perChar * 0.8) && n <= text.length && frame < start + text.length * perChar;
    // Land on word: each word is typed as it is spoken (from its spoken frame, ~2 frames a letter, done before the next)
    const words = text.split(/\s+/).filter(Boolean);
    const sp = wordSpans(p, words.length, (i, a, next) => a + Math.max(1, Math.min(Math.round(words[i].length * 2.5), next - a - 1)));
    const times = sp ? sp.at : null;
    if (sp && times) {
        n = 0; keyOn = false;
        let w = 0;
        const re = /\S+/g;
        let mt: RegExpExecArray | null;
        while ((mt = re.exec(text))) {
            const t0 = times[w];
            const pc = Math.max(0.5, (sp.end[w] - t0) / mt[0].length);   // typed from its in to its end frame
            w++;
            if (real < t0) break;
            const typedN = Math.min(mt[0].length, Math.floor((real - t0) / pc) + 1);
            n = mt.index + typedN;
            if (typedN < mt[0].length || real - t0 < mt[0].length * pc + 2) { sinceKey = (real - t0) % pc; keyOn = sinceKey < Math.min(4, pc * 0.8) && typedN <= mt[0].length; }
            if (typedN >= mt[0].length) { const sp = /^\s+/.exec(text.slice(n)); if (sp && w < times.length && real >= times[w] - 1) n += sp[0].length; }
        }
        shown = text.slice(0, n);
    }
    const last = shown.slice(-1).toLowerCase();

    const dk = !!p.dark;
    const bg = dk ? '#2b2b2d' : '#d1d3d9', key = dk ? '#6b6b6e' : '#ffffff', key2 = dk ? '#474749' : '#abb0ba', ink = dk ? '#fff' : '#111';
    const partial = shown.split(/\s+/).pop() || '';
    const sug = (p.suggestions && p.suggestions.length ? p.suggestions : ['the', 'your', 'what']).slice(0, 3);
    const bar = partial ? [sug[0], partial, sug[2] || sug[1]] : sug;
    const caret = Math.floor(frame / 9) % 2 === 0;
    const slide = interpolate(inn, [0, 1], [520, 0]);
    const kp = { keyOn, last, keyBg: key, key2Bg: key2, ink, dk };

    return (
        <Place p={p}>
            <div style={{ width: 900, transform: `translateY(${slide}px)`, opacity: out * Math.min(1, inn * 2) }}>
                {/* text field */}
                <div style={{ background: dk ? '#1c1c1e' : '#fff', borderRadius: 30, padding: '16px 18px 16px 30px', display: 'flex',
                    alignItems: 'center', marginBottom: 14, boxShadow: '0 8px 24px rgba(0,0,0,.25)' }}>
                    <div style={{ flex: 1, fontFamily: FONT.sans, fontSize: 40, color: ink }}>
                        {shown}{caret ? <span style={{ color: p.accent, fontWeight: 300 }}>|</span> : null}
                    </div>
                    <div style={{ width: 56, height: 56, borderRadius: 56, background: shown ? p.accent : '#ccc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width={28} height={28} viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7" stroke="#111" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </div>
                </div>
                {/* keyboard */}
                <div style={{ background: bg, borderRadius: 26, padding: '10px 10px 18px' }}>
                    <div style={{ display: 'flex', height: 70, alignItems: 'center', fontFamily: FONT.sans, fontSize: 32, color: ink }}>
                        {bar.map((s, i) => (
                            <div key={i} style={{ flex: 1, textAlign: 'center', borderLeft: i ? `2px solid ${key2}` : 'none',
                                fontWeight: i === 1 && partial ? 600 : 400 }}>{i === 1 && partial ? `“${s}”` : s}</div>
                        ))}
                    </div>
                    {ROWS.map((r, ri) => (
                        <div key={ri} style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 14 }}>
                            {ri === 2 && <Key {...kp} ch="shift" w={104} dark label="⇧" />}
                            {r.split('').map((c) => <Key key={c} {...kp} ch={c} />)}
                            {ri === 2 && <Key {...kp} ch="del" w={104} dark label="⌫" />}
                        </div>
                    ))}
                    <div style={{ display: 'flex', gap: 12, marginTop: 14, justifyContent: 'center' }}>
                        <Key {...kp} ch="123" w={110} dark label="123" />
                        <Key {...kp} ch=" " w={480} label="space" />
                        <Key {...kp} ch="ret" w={190} dark label="return" />
                    </div>
                </div>
            </div>
        </Place>
    );
};
