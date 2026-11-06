// Every IPC channel the panel can call (see src/preload.js for the renderer side).

const { ipcMain, shell } = require('electron');

const { DATA_DIR, FONTS_DIR } = require('./config');
const { getAppVersion, setAppVersion } = require('./app-version');
const { apply } = require('./apply');
const { cancelNativeColor, pickNativeColor } = require('./color-picker');
const { listSystemFonts } = require('./fonts');
const { libForUI } = require('./library');
const {
    addAnimationFile, createCombo, draftFromTimeline, pickFile, removeAnimation, reorderAnimations,
    replaceAnimationFile, revertAnimation, saveAnimationVariant, saveSelectedAsAnimation, saveTags,
    setAnimationSfx, setDefaultSfx, updateAnimation
} = require('./library-actions');
const {
    overwriteAudioFromCurrent, overwriteAudioFromFile, overwriteAudioFromTimeline,
    overwriteSettingFromCurrent, overwriteSettingFromFile, overwriteSettingFromTimeline, pickFileOrFolder,
    revertAnimationAudio
} = require('./library-overwrite');
const { cleanup } = require('./lifecycle');
const { liveAlive, liveFinish, liveRemove, liveUpdate, loopOn, loopRestore, waitIdle } = require('./live-preview');
const { dlog } = require('./log');
const { liveFrame, parkUntilFocus, poll, seek } = require('./poll');
const { captureFromSelection, makePreview, previewData, scanClip } = require('./previews');
const { listSubtitles } = require('./resolve');
const {
    addSfxOriginal, listSfxOriginals, readSfx, removeSfxOriginal, saveAttachedClip, saveSfxClip, useOriginalSfx
} = require('./sfx');
const { syncLiveTransform, updateLatest } = require('./timeline-sync');
const { fitWidth, setLayoutMode, setOnTop } = require('./window');

// A thrown error is returned to the panel as { error } instead of rejecting the call.
function wrap(fn) {
    return async (...args) => {
        try { return await fn(...args); } catch (e) { return { error: String(e && e.message || e) }; }
    };
}

// Handlers called as fn(event, ...args); a thrown error comes back as { error }.
const SAFE_HANDLERS = {
    'app:liveFrame': liveFrame,
    'app:getVersion': getAppVersion,
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
    'win:setLayoutMode': setLayoutMode,
    'win:fitWidth': fitWidth,
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
    'live:remove': () => liveRemove(false),
    'live:drop': async () => { await waitIdle(6000); return liveRemove('keep'); },      // switching presets: the In/Out stay put
    'live:loopOn': (e, already) => loopOn(!!already),
    'live:loopRestore': () => loopRestore(),
    'live:finish': liveFinish,
    'fonts:list': async () => await listSystemFonts(),
    'color:pick': pickNativeColor,
    'color:cancel': cancelNativeColor,
    'win:park': () => parkUntilFocus(),
    'dbg:log': (e, ...parts) => { dlog('[panel]', ...parts); return true; },
    'resolve:cleanup': cleanup,
};

function registerIpcHandlers() {
    for (const [channel, fn] of Object.entries(SAFE_HANDLERS)) ipcMain.handle(channel, wrap(fn));
    for (const [channel, fn] of Object.entries(RAW_HANDLERS)) ipcMain.handle(channel, fn);
}

module.exports = { registerIpcHandlers };
