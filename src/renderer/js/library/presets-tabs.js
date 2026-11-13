// Presets section: Text / Effects sub-tabs. Only toggles which section shows; both stay in the DOM.
bindTabGroup(document.getElementById('presetsWrap'), { key: 'pt', values: ['text', 'fx'], buttons: '.presets-tab[data-pt]', storageKey: 'presetsTab' });
