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
import { ReceiptPrinter } from './effects/ReceiptPrinter';
import { VersusSplit } from './effects/VersusSplit';
import { StatBar } from './effects/StatBar';
import { MarkerHighlight } from './effects/MarkerHighlight';
import { QuoteCard } from './effects/QuoteCard';
import { StampVerdict } from './effects/StampVerdict';
import { YearTimeline } from './effects/YearTimeline';
import { KeyCombo } from './effects/KeyCombo';
import { UrlBar } from './effects/UrlBar';
import { RingGauge } from './effects/RingGauge';
import { MiniChart } from './effects/MiniChart';
import { AudioPulse } from './effects/AudioPulse';
import { StickerPop } from './effects/StickerPop';
import { StepBadge } from './effects/StepBadge';
import { LowerThird } from './effects/LowerThird';
import { NewsTicker } from './effects/NewsTicker';
import { PullQuote } from './effects/PullQuote';
import { DoodleCallout } from './effects/DoodleCallout';
import { DoodleIcon } from './effects/DoodleIcon';
import { DoodleBoil } from './effects/DoodleBoil';
import { JournalNote } from './effects/JournalNote';
import { CutoutPop } from './effects/CutoutPop';
import { PaperFrame } from './effects/PaperFrame';
import { CutoutPuppet } from './effects/CutoutPuppet';
import { RansomText } from './effects/RansomText';
import { HeadlineWall } from './effects/HeadlineWall';
import { ZoomThroughCut } from './effects/ZoomThroughCut';
import { PhoneMockup } from './effects/PhoneMockup';
import { ViewfinderZoom } from './effects/ViewfinderZoom';
import { UiWorld } from './effects/UiWorld';
import { StickyText } from './effects/StickyText';
import { BeforeAfterWipe } from './effects/BeforeAfterWipe';
import { EditorReveal } from './effects/EditorReveal';
import { VideoWall } from './effects/VideoWall';
import { PaperCut } from './effects/PaperCut';
import { DepthScatter } from './effects/DepthScatter';
import { OrbitCarousel } from './effects/OrbitCarousel';
import { FrameBreakCard } from './effects/FrameBreakCard';
import { VertigoDolly } from './effects/VertigoDolly';
import { GreenScreenStage } from './effects/GreenScreenStage';
import { NotificationStack } from './effects/NotificationStack';
import { ChecklistCard } from './effects/ChecklistCard';
import { AvatarSplit } from './effects/AvatarSplit';
import { TimelineArc } from './effects/TimelineArc';
import { CollageTrack } from './collage/CollageTrack';
import { CollageCaptions } from './collage/Captions';

const COMPONENTS: Record<string, React.FC<any>> = {
    'live-cursor': LiveCursor, 'comment-drop': CommentDrop, 'predict-keys': PredictKeys, 'day-dial': DayDial,
    'post-wall': PostWall, 'voice-note': VoiceNote, 'sketch-words': SketchWords, 'money-counter': MoneyCounter,
    'tag-stack': TagStack, 'chapter-list': ChapterList, 'receipt-printer': ReceiptPrinter,
    'versus-split': VersusSplit, 'stat-bar': StatBar, 'marker-highlight': MarkerHighlight, 'quote-card': QuoteCard,
    'stamp-verdict': StampVerdict, 'year-timeline': YearTimeline, 'key-combo': KeyCombo, 'url-bar': UrlBar,
    'ring-gauge': RingGauge, 'mini-chart': MiniChart, 'audio-pulse': AudioPulse, 'sticker-pop': StickerPop,
    'step-badge': StepBadge, 'lower-third': LowerThird, 'news-ticker': NewsTicker, 'pull-quote': PullQuote,
    'doodle-callout': DoodleCallout, 'doodle-icon': DoodleIcon, 'doodle-boil': DoodleBoil,
    'journal-note': JournalNote, 'cutout-pop': CutoutPop, 'paper-frame': PaperFrame, 'cutout-puppet': CutoutPuppet,
    'ransom-text': RansomText, 'headline-wall': HeadlineWall, 'zoom-through-cut': ZoomThroughCut,
    'phone-mockup': PhoneMockup, 'viewfinder-zoom': ViewfinderZoom, 'ui-world': UiWorld, 'sticky-text': StickyText,
    'before-after-wipe': BeforeAfterWipe, 'editor-reveal': EditorReveal, 'video-wall': VideoWall,
    'paper-cut': PaperCut, 'depth-scatter': DepthScatter, 'orbit-carousel': OrbitCarousel,
    'frame-break-card': FrameBreakCard, 'vertigo-dolly': VertigoDolly, 'green-screen-stage': GreenScreenStage,
    'notification-stack': NotificationStack, 'checklist-card': ChecklistCard, 'avatar-split': AvatarSplit, 'timeline-arc': TimelineArc
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
        {/* collage b-roll pipeline (broll/collage/): not panel effects, so not in effects.json */}
        <Composition id="collage-track" component={CollageTrack as React.FC<any>} defaultProps={{ beats: [], from: 0 }}
            width={1080} height={1920} fps={30} durationInFrames={90} calculateMetadata={sizedByProps} />
        <Composition id="collage-captions" component={CollageCaptions as React.FC<any>} defaultProps={{ words: [], from: 0 }}
            width={1080} height={1920} fps={30} durationInFrames={90} calculateMetadata={sizedByProps} />
    </>
);

function sizedByProps({ props }: any) {
    return { width: Math.round(props._w || 1080), height: Math.round(props._h || 1920), fps: props._fps || 30,
        durationInFrames: Math.max(1, Math.round(props._frames || 90)) };
}
