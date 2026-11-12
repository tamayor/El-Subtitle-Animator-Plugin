// Tag stack: small labelled tags drop one by one and pile up in a wobbly stack. (x, y) is the bottom of the stack.
import React from 'react';
import { spring } from 'remotion';
import { Common, FONT, Place, rand, useInOut } from '../lib/common';

type P = Common & { tags: string[]; dark: boolean };

export const TagStack: React.FC<P> = (p) => {
    const { frame, fps, durationInFrames: D, out } = useInOut(p, (D0) => {
        const n = Math.max(1, Math.min(14, (p.tags || []).length || 1));
        return (n - 1) * Math.max(3, Math.min(8, Math.floor((D0 * 0.6) / n))) + 10;   // the last tag has landed
    });
    const tags = (p.tags && p.tags.length ? p.tags : ['Tag']).slice(0, 14);
    const gapF = Math.max(3, Math.min(8, Math.floor((D * 0.6) / tags.length)));
    const tagH = 58;

    return (
        <Place p={p}>
            <div style={{ position: 'relative', width: 10, height: 10, opacity: out }}>
                {tags.map((t, i) => {
                    const s = spring({ frame: frame - i * gapF, fps, config: { damping: 11, stiffness: 170, mass: 0.7 } });
                    if (frame < i * gapF) return null;
                    const rot = (rand(i + 1) - 0.5) * 16;
                    const dx = (rand(i + 11) - 0.5) * 60;
                    const y = -(i + 1) * (tagH - 8);
                    return (
                        <div key={i} style={{ position: 'absolute', left: dx, top: y + (1 - s) * -500, transform: `translateX(-50%) rotate(${rot * s + (1 - s) * 40}deg)`,
                            display: 'flex', alignItems: 'center', gap: 10, height: tagH, padding: '0 22px 0 14px', whiteSpace: 'nowrap',
                            background: p.dark ? '#1d2620' : '#f4f1ea', color: p.dark ? '#fff' : '#1a1a1a', borderRadius: 8,
                            border: `2px solid ${p.dark ? '#3a4a3e' : '#d8d2c4'}`, boxShadow: '0 6px 16px rgba(0,0,0,.35)',
                            fontFamily: FONT.mono, fontWeight: 700, fontSize: 26 }}>
                            <div style={{ width: 12, height: 12, borderRadius: 12, border: `3px solid ${p.accent}` }} />
                            {t}
                        </div>
                    );
                })}
            </div>
        </Place>
    );
};
