// Hand-made look for any B-roll effect (common prop `hand`): stop motion (the whole effect held on twos with
// Remotion's Freeze, so every build, count and swipe moves in steps) and a line boil (an SVG displacement whose noise
// changes every `every` frames, so circles, strokes and letters keep redrawing slightly differently, like a pen
// sketch). Same feel as the collage's brand.motion "hand" (collage/cards.tsx Wiggle / stepT).
import React from 'react';
import { AbsoluteFill, Freeze, useCurrentFrame, useVideoConfig } from 'remotion';

type HandProps = { hand?: boolean; handStep?: number; handWiggle?: number };

export function withHand<P extends HandProps>(Comp: React.FC<P>): React.FC<P> {
    const Wrapped: React.FC<P> = (p) => {
        if (!p.hand) return <Comp {...p} />;
        return <Hand {...p} Comp={Comp} />;
    };
    return Wrapped;
}

const Hand: React.FC<HandProps & { Comp: React.FC<any> }> = ({ Comp, ...p }) => {
    const frame = useCurrentFrame();
    const { width } = useVideoConfig();
    const step = Math.max(1, Math.round(p.handStep ?? 2));
    const amp = (p.handWiggle ?? 4) * (width / 1080);   // displacement in output px (4 at 1080 wide)
    const every = 4;
    const seed = 1 + (Math.floor(frame / every) % 7);
    const id = 'hand-boil';
    return (
        <AbsoluteFill>
            <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
                <filter id={id} x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
                    <feTurbulence type="fractalNoise" baseFrequency={0.02 * (1080 / width)} numOctaves={2} seed={seed} result="n" />
                    <feDisplacementMap in="SourceGraphic" in2="n" scale={amp} xChannelSelector="R" yChannelSelector="G" />
                </filter>
            </svg>
            <AbsoluteFill style={{ filter: amp > 0 ? `url(#${id})` : undefined }}>
                <Freeze frame={Math.floor(frame / step) * step}>
                    <Comp {...p} />
                </Freeze>
            </AbsoluteFill>
        </AbsoluteFill>
    );
};
