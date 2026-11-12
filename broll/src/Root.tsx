// One composition per entry in effects.json. Size, frame rate and length come from the props the renderer passes
// (_w, _h, _fps, _frames: the timeline's), so a render always matches the timeline it goes on.
import React from 'react';
import { Composition } from 'remotion';
import registry from '../effects.json';
import { LiveCursor } from './effects/LiveCursor';
import { CommentDrop } from './effects/CommentDrop';
import { PredictKeys } from './effects/PredictKeys';
import { DayDial } from './effects/DayDial';
import { PostWall } from './effects/PostWall';
import { VoiceNote } from './effects/VoiceNote';
import { SketchWords } from './effects/SketchWords';
import { MoneyCounter } from './effects/MoneyCounter';
import { TagStack } from './effects/TagStack';
import { ChapterList } from './effects/ChapterList';

const COMPONENTS: Record<string, React.FC<any>> = {
    'live-cursor': LiveCursor, 'comment-drop': CommentDrop, 'predict-keys': PredictKeys, 'day-dial': DayDial,
    'post-wall': PostWall, 'voice-note': VoiceNote, 'sketch-words': SketchWords, 'money-counter': MoneyCounter,
    'tag-stack': TagStack, 'chapter-list': ChapterList
};

function defaultsFor(e: any) {
    const out: Record<string, unknown> = {};
    for (const f of registry.common) out[f.key] = f.default;
    for (const f of e.fields) out[f.key] = f.default;
    return { ...out, ...(e.defaults || {}) };
}

export const Root: React.FC = () => (
    <>
        {registry.effects.filter((e: any) => COMPONENTS[e.id]).map((e: any) => (
            <Composition key={e.id} id={e.id} component={COMPONENTS[e.id]} defaultProps={defaultsFor(e)}
                width={1920} height={1080} fps={30} durationInFrames={Math.round((e.seconds || 3) * 30)}
                calculateMetadata={({ props }: any) => ({
                    width: Math.round(props._w || 1920), height: Math.round(props._h || 1080), fps: props._fps || 30,
                    durationInFrames: Math.max(1, Math.round(props._frames || (e.seconds || 3) * (props._fps || 30)))
                })} />
        ))}
    </>
);
