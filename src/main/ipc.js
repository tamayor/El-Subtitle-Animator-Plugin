// Every IPC channel the panel can call (see src/preload.js for the renderer side).

const fs = require('fs');
const path = require('path');
const { app, ipcMain, shell } = require('electron');

const state = require('./state');
const { DATA_DIR, FONTS_DIR } = require('./config');
const { getAppVersion, setAppVersion } = require('./app-version');
const { apply } = require('./apply');
const { cancelNativeColor, pickNativeColor } = require('./color-picker');
const { listSystemFonts } = require('./fonts');
const { libForUI } = require('./library');
const {
    addAnimationFile, createCombo, draftFromTimeline, pickFile, removeAnimation, reorderAnimations,
    replaceAnimationFile, revertAnimation, saveAnimationVariant, saveSelectedAsAnimation, saveTags,
    setAnimationSfx, setDefaultSfx, setUseOrder, updateAnimation
} = require('./library-actions');
const {
    overwriteAudioFromCurrent, overwriteAudioFromFile, overwriteAudioFromTimeline,
    overwriteSettingFromCurrent, overwriteSettingFromFile, overwriteSettingFromTimeline, pickFileOrFolder,
    revertAnimationAudio
} = require('./library-overwrite');
const { cleanup } = require('./lifecycle');
const { adjustHighlights } = require('./automation');
const { liveAlive, liveFinish, liveRemove, liveUpdate, loopOn, loopRestore, waitIdle } = require('./live-preview');
const { dlog } = require('./log');
const { liveFrame, parkUntilFocus, poll, seek } = require('./poll');
const { captureFromSelection, makePreview, previewData, scanClip } = require('./previews');
const { listSubtitles } = require('./resolve');
const { fxGet, fxList, fxParam, fxSet, fxSetTags, fxStrength } = require('./effect-presets');
const { trackCancel, trackEngine, trackInstall, trackRun, trackSettings, trackSource } = require('./subject-track');
const { spotCancel, spotEngine, spotGet, spotInfo, spotInstall, spotRecut, spotRemove, spotRun, spotSet, spotSource } = require('./spotlight');
const {
    addSfxOriginal, listSfxOriginals, readSfx, removeSfxOriginal, saveAttachedClip, saveSfxClip, useOriginalSfx
} = require('./sfx');
const { syncLiveTransform, updateLatest } = require('./timeline-sync');
const { fitWidth, setAutoCollapse, setLayoutMode, setOnTop } = require('./window');
const { FIX_DEFAULTS, getFixes, setFixes } = require('./fusion-fixes');
const { PERF_DEFAULTS, getPerf, perfReset, perfSummary, record, setPerf } = require('./perf');
const { clipTiming, setClipTiming, fitClipToWords, wordTimingStatus, activateWordTimings } = require('./anim-timing');
const { clipControls, setClipControls, clipRows, setClipRows, setClipGradient } = require('./clip-controls');
const { boilerplateList, insertBoilerplate } = require('./boilerplates');
const { matchCutCancel, matchCutDefaults, matchCutOpen, matchCutRun } = require('./match-cut');
const BROLL = require('./broll');
const { cutAnalyze, cutBuild, cutCancel, cutDefaults, cutInstall, cutListen, cutSetPrefs } = require('./auto-cut');
const { cutToolsRun, cutToolsCheck, cutToolsStatus, cancelCutTools, cutToolsInstall, cutToolsMarkers, cutToolsWave, cutToolsGoto, cutToolsDeletePauses, cutToolsPlayhead } = require('./cut-tools');

// A thrown error is returned to the panel as { error } instead of rejecting the call.
function wrap(fn) {
    return async (...args) => {
        try { return await fn(...args); } catch (e) { return { error: String(e && e.message || e) }; }
    };
}

// Handlers called as fn(event, ...args); a thrown error comes back as { error }.
const SAFE_HANDLERS = {
    'app:liveFrame': liveFrame,
    'timing:get': clipTiming,
    'timing:set': setClipTiming,
    'timing:fitWords': fitClipToWords,
    'timing:wordsStatus': wordTimingStatus,
    'timing:wordsActivate': activateWordTimings,
    'boilerplate:list': () => boilerplateList(),
    'boilerplate:insert': insertBoilerplate,
    'fx:list': fxList,
    'fx:get': fxGet,
    'fx:set': fxSet,
    'fx:setTags': fxSetTags,
    'fx:strength': fxStrength,
    'fx:param': fxParam,
    'track:engine': trackEngine,
    'track:install': trackInstall,
    'track:source': trackSource,
    'track:run': trackRun,
    'track:cancel': trackCancel,
    'track:settings': trackSettings,
    'spot:info': spotInfo,
    'spot:engine': spotEngine,
    'spot:install': spotInstall,
    'spot:source': spotSource,
    'spot:run': spotRun,
    'spot:cancel': spotCancel,
    'spot:get': spotGet,
    'spot:set': spotSet,
    'spot:recut': spotRecut,
    'spot:remove': spotRemove,
    'controls:get': clipControls,
    'controls:set': setClipControls,
    'controls:rows': clipRows,
    'controls:setRows': setClipRows,
    'controls:setGradient': setClipGradient,
    // Header "Match Cut" button: a news-article match cut of one word (match-cut.js); progress as matchcut:progress
    'matchcut:defaults': () => matchCutDefaults(),
    'matchcut:run': matchCutRun,
    'matchcut:cancel': () => matchCutCancel(),
    'matchcut:open': () => matchCutOpen(),
    // B-roll tab: Remotion overlays rendered at the timeline's size and placed (broll.js); progress as broll:progress
    'broll:effects': () => BROLL.brollEffects(),
    'broll:preview': BROLL.brollPreview,
    'broll:strip': BROLL.brollStrip,
    'broll:trace': BROLL.brollTrace,
    'broll:sync': BROLL.brollSync,
    'broll:place': BROLL.brollPlace,
    'broll:placeMany': BROLL.brollPlaceMany,
    'broll:adjust': BROLL.brollAdjust,
    'broll:remove': BROLL.brollRemove,
    'broll:list': BROLL.brollList,
    'broll:suggest': BROLL.brollSuggest,
    'broll:cancel': () => BROLL.brollCancel(),
    'broll:open': BROLL.brollOpenFolder,
    'broll:frame': () => BROLL.brollFrame(),
    // Cut tab: rough cut of the source track into a new "(cut)" timeline (auto-cut.js); progress as cut:progress
    'cut:defaults': () => cutDefaults(),
    'cut:prefs': cutSetPrefs,
    'cut:analyze': cutAnalyze,
    'cut:build': cutBuild,
    'cut:cancel': () => cutCancel(),
    'cut:install': () => cutInstall(),
    'cut:listen': cutListen,
    // Cut tab "Analyse media": pauses, shot changes, beats, word timings, render check (cut-tools.js); progress as cuttools:progress
    'cuttools:status': () => cutToolsStatus(),
    'cuttools:run': cutToolsRun,
    'cuttools:check': cutToolsCheck,
    'cuttools:cancel': () => cancelCutTools(),
    'cuttools:install': cutToolsInstall,
    'cuttools:markers': cutToolsMarkers,
    'cuttools:wave': cutToolsWave,
    'cuttools:goto': cutToolsGoto,
    'cuttools:playhead': () => cutToolsPlayhead(),
    'cuttools:deletePauses': cutToolsDeletePauses,
    'app:getVersion': getAppVersion,
    // Header "Fusion" button: which Fusion fixes are applied to placed titles (fusion-fixes.js)
    'fusion:getFixes': () => ({ fixes: getFixes(), defaults: FIX_DEFAULTS }),
    'fusion:setFixes': setFixes,
    // Performance measuring (perf.js): settings, the live summary, and measurements the panel reports about itself
    'perf:get': () => ({ perf: getPerf(), defaults: PERF_DEFAULTS }),
    'perf:set': (e, patch) => setPerf(patch),
    'perf:summary': (e, top) => perfSummary(Number(top) || 0),
    'perf:reset': () => { perfReset(); return true; },
    'perf:record': (e, name, ms, meta) => { if (typeof name === 'string' && /^[\w.#-]{1,80}$/.test(name)) record('renderer.' + name, ms, meta); return true; },
    'app:setVersion': setAppVersion,
    'act:scanClip': scanClip,
    'act:updateLatest': updateLatest,
    'act:syncLiveTransform': syncLiveTransform,
    'act:seek': seek,
    'lib:get': () => ({ lib: libForUI() }),
    'lib:addAnimationFile': addAnimationFile,
    'lib:saveSelected': saveSelectedAsAnimation,
    'lib:create': createCombo,
    'lib:draftFromTimeline': draftFromTimeline,
    'lib:saveVariant': saveAnimationVariant,
    'lib:capture': captureFromSelection,
    'lib:update': updateAnimation,
    'lib:revert': revertAnimation,
    'lib:overwriteSettingFromTimeline': overwriteSettingFromTimeline,
    'lib:overwriteSettingFromFile': overwriteSettingFromFile,
    'lib:overwriteSettingFromCurrent': overwriteSettingFromCurrent,
    'lib:revertAudio': revertAnimationAudio,
    'lib:overwriteAudioFromTimeline': overwriteAudioFromTimeline,
    'lib:overwriteAudioFromFile': overwriteAudioFromFile,
    'lib:overwriteAudioFromCurrent': overwriteAudioFromCurrent,
    'lib:pickFileOrFolder': pickFileOrFolder,
    'lib:remove': removeAnimation,
    'lib:saveTags': saveTags,
    'lib:reorder': reorderAnimations,
    'lib:useOrder': setUseOrder,
    'lib:setDefaultSfx': setDefaultSfx,
    'lib:setAnimationSfx': setAnimationSfx,
    'lib:replaceFile': replaceAnimationFile,
    'lib:makePreview': makePreview,
    'lib:previewData': previewData,
    'dialog:pick': pickFile,
    'sfx:read': readSfx,
    'sfx:saveClip': saveSfxClip,
    'sfx:saveAttachedClip': saveAttachedClip,
    'sfx:useOriginal': useOriginalSfx,
    'sfx:listOriginals': listSfxOriginals,
    'sfx:addOriginal': addSfxOriginal,
    'sfx:removeOriginal': removeSfxOriginal,
    'win:setOnTop': setOnTop,
    'win:setAutoCollapse': setAutoCollapse,
    'win:setLayoutMode': setLayoutMode,
    'win:fitWidth': fitWidth,
    // Prompt tab HIGHLIGHT_BOX "Apply to placed": the highlight box values on every highlight clip of the timeline.
    'highlight:adjust': async (e, args) => {
        try { return { ok: true, result: await adjustHighlights(args || {}) }; } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
    },
    // The Prompt tab text, mirrored to a file so Claude Code (/elsa-prompt) can read it.
    'prompt:saveFile': (e, text) => {
        if (typeof text !== 'string' || !text.trim()) return false;
        const file = path.join(DATA_DIR, 'job-prompt.md');
        const tmp = file + '.tmp';
        fs.writeFileSync(tmp, text, 'utf8');
        fs.renameSync(tmp, file);
        return true;
    },
    // Prompts dropped into <library>/prompt-inbox.json (by Claude Code, or by hand) for the Prompt tab to save under
    // their titles: [{ title, text, load }] or one such object. The file is taken (deleted) once read.
    'prompt:takeInbox': () => {
        const file = path.join(DATA_DIR, 'prompt-inbox.json');
        if (!fs.existsSync(file)) return [];
        let data;
        try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return []; }
        try { fs.unlinkSync(file); } catch (e) { /* ignore */ }
        const list = Array.isArray(data) ? data : [data];
        return list.filter(p => p && typeof p.title === 'string' && p.title.trim() && typeof p.text === 'string' && p.text.trim())
            .map(p => ({ title: p.title.trim(), text: p.text, load: p.load !== false }));
    },
};

// Handlers that deal with their own errors (or must not be wrapped).
const RAW_HANDLERS = {
    'app:poll': poll,
    'app:subtitles': listSubtitles,
    'app:openFolder': () => shell.openPath(DATA_DIR),
    'app:openFontsFolder': () => shell.openPath(FONTS_DIR),
    'act:apply': apply,
    'live:update': liveUpdate,
    'live:alive': liveAlive,
    // Remove: a preview being placed right now would land after the delete and stay (Chocolate) - wait for it first
    'live:remove': async () => { await waitIdle(20000); return liveRemove(false); },
    'live:drop': async () => { await waitIdle(6000); return liveRemove('keep'); },      // switching presets: the In/Out stay put
    'live:loopOn': (e, already) => loopOn(!!already),
    'live:loopRestore': () => loopRestore(),
    'live:finish': liveFinish,
    'fonts:list': async () => await listSystemFonts(),
    // the answer is also written to the B-roll colour trace (_app/broll-trace.log) while that tab is being debugged
    'color:pick': async (event, hex) => {
        const t0 = Date.now();
        BROLL.brollTrace(null, 'pickColor asked from ' + hex);
        const r = await pickNativeColor(event, hex);
        BROLL.brollTrace(null, 'pickColor answered ' + JSON.stringify(r) + ' after ' + (Date.now() - t0) + ' ms');
        return r;
    },
    'color:cancel': cancelNativeColor,
    'win:park': () => parkUntilFocus(),
    'win:emojiPanel': () => { try { app.showEmojiPanel(); return true; } catch (e) { return false; } },      // macOS Character Viewer
    'place:set': (e, o) => { state.placePrefs = (o && typeof o === 'object') ? o : null; return true; },
    'dbg:log': (e, ...parts) => { dlog('[panel]', ...parts); return true; },
    'resolve:cleanup': cleanup,
};

function registerIpcHandlers() {
    for (const [channel, fn] of Object.entries(SAFE_HANDLERS)) ipcMain.handle(channel, wrap(fn));
    for (const [channel, fn] of Object.entries(RAW_HANDLERS)) ipcMain.handle(channel, fn);
}

module.exports = { registerIpcHandlers };
