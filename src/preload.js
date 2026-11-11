// Bridge between the panel (src/renderer) and the main process (src/main). IPC channels: src/main/ipc.js.
const { contextBridge, ipcRenderer, webUtils } = require('electron/renderer');

contextBridge.exposeInMainWorld('sa', {
    // Resolve connection, playhead and subtitles
    poll: (force) => ipcRenderer.invoke('app:poll', !!force),
    liveFrame: (frame) => ipcRenderer.invoke('app:liveFrame', frame),
    clipTiming: (opts) => ipcRenderer.invoke('timing:get', opts || {}),
    setClipTiming: (itemId, ranges, wake) => ipcRenderer.invoke('timing:set', itemId, ranges, !!wake),
    fxList: () => ipcRenderer.invoke('fx:list'),
    fxGet: () => ipcRenderer.invoke('fx:get'),
    fxSet: (effectId, on, strength, params, hold) => ipcRenderer.invoke('fx:set', effectId, on, strength, params, hold),
    fxParam: (effectId, values) => ipcRenderer.invoke('fx:param', effectId, values),
    fxStrength: (effectId, value) => ipcRenderer.invoke('fx:strength', effectId, value),
    fxSetTags: (effectId, tags) => ipcRenderer.invoke('fx:setTags', effectId, tags),
    trackEngine: () => ipcRenderer.invoke('track:engine'),
    trackInstall: () => ipcRenderer.invoke('track:install'),
    trackSource: (frame) => ipcRenderer.invoke('track:source', frame),
    trackRun: (opts) => ipcRenderer.invoke('track:run', opts),
    trackCancel: () => ipcRenderer.invoke('track:cancel'),
    trackSettings: (itemId, values) => ipcRenderer.invoke('track:settings', itemId, values),
    onTrackProgress: (cb) => ipcRenderer.on('track:progress', (e, d) => { try { cb(d); } catch (err) { /* ignore */ } }),
    clipControls: () => ipcRenderer.invoke('controls:get'),
    setClipControls: (itemId, values) => ipcRenderer.invoke('controls:set', itemId, values),
    clipRows: (itemId) => ipcRenderer.invoke('controls:rows', itemId),
    setClipRows: (itemId, texts, frames) => ipcRenderer.invoke('controls:setRows', itemId, texts, frames),
    setClipGradient: (itemId, tool, index, stops) => ipcRenderer.invoke('controls:setGradient', itemId, tool, index, stops),
    seek: (frame) => ipcRenderer.invoke('act:seek', frame),
    subtitles: (force) => ipcRenderer.invoke('app:subtitles', force),
    cleanup: () => ipcRenderer.invoke('resolve:cleanup'),
    setPlaceOptions: (o) => ipcRenderer.invoke('place:set', o || null),

    // Library
    getLib: () => ipcRenderer.invoke('lib:get'),
    addAnimationFile: (p) => ipcRenderer.invoke('lib:addAnimationFile', p),
    saveSelected: (name) => ipcRenderer.invoke('lib:saveSelected', name),
    createCombo: (req) => ipcRenderer.invoke('lib:create', req),
    draftFromTimeline: (opts) => ipcRenderer.invoke('lib:draftFromTimeline', opts || null),
    saveVariant: (req) => ipcRenderer.invoke('lib:saveVariant', req),
    updateAnimation: (id, patch) => ipcRenderer.invoke('lib:update', id, patch),
    revertAnimation: (id) => ipcRenderer.invoke('lib:revert', id),
    overwriteSettingFromTimeline: (id) => ipcRenderer.invoke('lib:overwriteSettingFromTimeline', id),
    overwriteSettingFromFile: (id, p) => ipcRenderer.invoke('lib:overwriteSettingFromFile', id, p),
    overwriteSettingFromCurrent: (id) => ipcRenderer.invoke('lib:overwriteSettingFromCurrent', id),
    revertAudio: (id) => ipcRenderer.invoke('lib:revertAudio', id),
    overwriteAudioFromTimeline: (id) => ipcRenderer.invoke('lib:overwriteAudioFromTimeline', id),
    overwriteAudioFromFile: (id, p) => ipcRenderer.invoke('lib:overwriteAudioFromFile', id, p),
    overwriteAudioFromCurrent: (id) => ipcRenderer.invoke('lib:overwriteAudioFromCurrent', id),
    pickFileOrFolder: (kind) => ipcRenderer.invoke('lib:pickFileOrFolder', kind),
    removeAnimation: (id) => ipcRenderer.invoke('lib:remove', id),
    saveTags: (tags) => ipcRenderer.invoke('lib:saveTags', tags),
    reorderAnimations: (ids) => ipcRenderer.invoke('lib:reorder', ids),
    setUseOrder: (ids) => ipcRenderer.invoke('lib:useOrder', ids),
    setDefaultSfx: (p) => ipcRenderer.invoke('lib:setDefaultSfx', p),
    setAnimationSfx: (id, p) => ipcRenderer.invoke('lib:setAnimationSfx', id, p),
    replaceAnimationFile: (id, p, keep) => ipcRenderer.invoke('lib:replaceFile', id, p, keep),

    // Previews
    capturePreview: (id) => ipcRenderer.invoke('lib:capture', id),
    previewData: (id) => ipcRenderer.invoke('lib:previewData', id),
    makePreview: (id, customText, design, designKey, temp, boxList, opts) => ipcRenderer.invoke('lib:makePreview', id, customText, design, designKey, temp || false, boxList || null, opts || null),
    onPreviewDraft: (cb) => ipcRenderer.on('preview:draft', (e, d) => { try { cb(d); } catch (err) { /* ignore */ } }),
    scanClip: () => ipcRenderer.invoke('act:scanClip'),

    // Placing on the timeline
    apply: (req) => ipcRenderer.invoke('act:apply', req),
    updateLatest: (req) => ipcRenderer.invoke('act:updateLatest', req),
    syncLiveTransform: (req) => ipcRenderer.invoke('act:syncLiveTransform', req),

    // Preview in Resolve (live clip)
    liveUpdate: (req) => ipcRenderer.invoke('live:update', req),
    liveRemove: () => ipcRenderer.invoke('live:remove'),
    liveDrop: () => ipcRenderer.invoke('live:drop'),
    liveAlive: () => ipcRenderer.invoke('live:alive'),
    liveLoopOn: (already) => ipcRenderer.invoke('live:loopOn', !!already),
    liveLoopRestore: () => ipcRenderer.invoke('live:loopRestore'),
    liveFinish: (req) => ipcRenderer.invoke('live:finish', req),

    // Sounds
    readSfx: (p) => ipcRenderer.invoke('sfx:read', p),
    saveSfxClip: (name, bytes) => ipcRenderer.invoke('sfx:saveClip', name, bytes),
    saveAttachedClip: (animId, bytes, origName) => ipcRenderer.invoke('sfx:saveAttachedClip', animId, bytes, origName),
    useOriginalSfx: (animId) => ipcRenderer.invoke('sfx:useOriginal', animId),
    listSfxOriginals: () => ipcRenderer.invoke('sfx:listOriginals'),
    addSfxOriginal: (p) => ipcRenderer.invoke('sfx:addOriginal', p),
    removeSfxOriginal: (name) => ipcRenderer.invoke('sfx:removeOriginal', name),

    // Fonts, colours and file dialogs
    openFolder: () => ipcRenderer.invoke('app:openFolder'),
    openFontsFolder: () => ipcRenderer.invoke('app:openFontsFolder'),
    pickFile: (kind) => ipcRenderer.invoke('dialog:pick', kind),
    listFonts: () => ipcRenderer.invoke('fonts:list'),
    onColorLive: (cb) => ipcRenderer.on('color:live', (e, hex) => { try { cb(hex); } catch (err) { /* ignore */ } }),
    cancelColor: () => ipcRenderer.invoke('color:cancel'),
    pickColor: (hex) => ipcRenderer.invoke('color:pick', hex),

    // Window and app
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getFusionFixes: () => ipcRenderer.invoke('fusion:getFixes'),
    setFusionFixes: (patch) => ipcRenderer.invoke('fusion:setFixes', patch || {}),
    getPerf: () => ipcRenderer.invoke('perf:get'),
    setPerf: (patch) => ipcRenderer.invoke('perf:set', patch || {}),
    perfSummary: (top) => ipcRenderer.invoke('perf:summary', top || 0),
    perfReset: () => ipcRenderer.invoke('perf:reset'),
    perfRecord: (name, ms, meta) => ipcRenderer.invoke('perf:record', name, ms, meta || null),
    setVersion: (v) => ipcRenderer.invoke('app:setVersion', v),
    onWinIdle: (cb) => ipcRenderer.on('win:idle', (e, v, why) => { try { cb(!!v, why); } catch (err) { /* ignore */ } }),
    parkUntilFocus: () => ipcRenderer.invoke('win:park'),
    showEmojiPanel: () => ipcRenderer.invoke('win:emojiPanel'),
    setOnTop: (flag) => ipcRenderer.invoke('win:setOnTop', !!flag),
    setAutoCollapse: (flag) => ipcRenderer.invoke('win:setAutoCollapse', !!flag),
    onCollapsed: (cb) => ipcRenderer.on('win:collapsed', (e, phase, size) => { try { cb(phase, size || null); } catch (err) { /* ignore */ } }),
    setLayoutMode: (mode) => ipcRenderer.invoke('win:setLayoutMode', mode),
    dlog: (...parts) => ipcRenderer.invoke('dbg:log', ...parts),
    fitWidth: (width, mode) => ipcRenderer.invoke('win:fitWidth', width, mode),
    saveJobPromptFile: (text) => ipcRenderer.invoke('prompt:saveFile', text),
    // Prompt tab HIGHLIGHT_BOX "Apply to placed": { highlight: { auto, width, height, x, y }, save } (automation.adjust_highlights)
    adjustHighlights: (args) => ipcRenderer.invoke('highlight:adjust', args || {}),
    takePromptInbox: () => ipcRenderer.invoke('prompt:takeInbox'),

    // Files: the real disk path of a file dropped onto the panel.
    pathForFile: (file) => {
        try { return webUtils.getPathForFile(file); } catch (e) { return file.path || ''; }
    }
});
