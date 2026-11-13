// Tab bars and segmented controls: one button per value, the root gets data-<key>=<value> (CSS shows the matching
// section), the active button gets `.on` and aria-selected. Use this for every sub-tab bar.
//
//   const tabs = bindTabGroup($('presetsWrap'), {
//       key: 'pt',                         buttons carry data-pt="text"; the root gets data-pt
//       values: ['text', 'fx'],            optional: anything else is ignored
//       buttons: '.presets-tab[data-pt]',  optional selector (default: '[data-<key>]' inside root)
//       storageKey: 'presetsTab',          optional: remembered per computer and restored on bind
//       onChange: (value) => { ... }       optional: after a click or show() (restoreFires: true = also on the restored value)
//       panes: { root, selector, key }     optional: sections under `root` matching `selector` get .hidden unless
//                                          their data-<key> is the value (for bars that show panes, not CSS states)
//   });
//   tabs.show('fx'); tabs.value
//
// The bar stays controlled by its buttons: it never reads `state` itself.

// A <details> that remembers whether the user left it open (per computer). Only a click on its summary is saved, so
// code that opens it for a reason (`el.open = true`) does not change what is remembered.
function rememberDetails(el, storageKey) {
    if (!el || !storageKey) return;
    const saved = store.get(storageKey, null);
    if (saved === '1') el.open = true;
    else if (saved === '0') el.open = false;
    const summary = el.querySelector(':scope > summary');
    if (summary) summary.addEventListener('click', () => setTimeout(() => store.set(storageKey, el.open ? '1' : '0'), 0));
}

function bindTabGroup(root, opts) {
    const o = opts || {};
    const key = o.key;
    const attr = 'data-' + key.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
    const sel = o.buttons || ('[' + attr + ']');
    const ok = (v) => typeof v === 'string' && v !== '' && (!Array.isArray(o.values) || o.values.includes(v));
    const api = {
        value: root ? (root.dataset[key] || null) : null,
        show(v, quiet) {
            if (!root || !ok(v)) return false;
            root.dataset[key] = v;
            api.value = v;
            root.querySelectorAll(sel).forEach((b) => {
                const on = b.dataset[key] === v;
                b.classList.toggle('on', on);
                b.setAttribute('aria-selected', on ? 'true' : 'false');
            });
            if (o.panes && o.panes.root) {
                const pk = o.panes.key || key;
                o.panes.root.querySelectorAll(o.panes.selector).forEach(p => p.classList.toggle('hidden', p.dataset[pk] !== v));
            }
            if (o.storageKey) store.set(o.storageKey, v);
            if (!quiet && typeof o.onChange === 'function') o.onChange(v);
            return true;
        }
    };
    if (!root) return api;
    root.querySelectorAll(sel).forEach((b) => b.addEventListener('click', () => api.show(b.dataset[key])));
    if (o.storageKey) {
        const saved = store.get(o.storageKey, null);
        if (ok(saved)) api.show(saved, !o.restoreFires);
    }
    return api;
}
