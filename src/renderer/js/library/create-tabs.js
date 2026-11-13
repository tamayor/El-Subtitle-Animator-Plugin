// Create tab: ScratchPad / SelfServe sub-tabs.
//   ScratchPad  the boilerplates (Text+ / MultiText): put one on the timeline, animate it (js/library/boilerplates.js)
//   SelfServe   select the clip in your own timeline (or drop a file) and save it with a name and a sound
// Only toggles which section shows; both stay in the DOM (same pattern as js/library/presets-tabs.js).

const CREATE_TABS = ['scratch', 'selfserve'];

const createTabs = bindTabGroup(document.getElementById('createWrap'), {
    key: 'ct', values: CREATE_TABS, buttons: '.presets-tab[data-ct]', storageKey: 'createTab'
});

function showCreateTab(ct) {
    createTabs.show(ct);
}
