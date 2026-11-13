// Loading panel scripts (src/renderer/js) in Node for tests. They are classic browser scripts sharing one global
// scope, so they are run as-is in a vm context: their top-level names become properties of the returned context.
//
//   const ctx = loadPanelScripts(['core/color.js']);
//   ctx.hexToRgb('#fff')
//
// `globals` adds what the scripts expect from the browser (localStorage, document, ...). Only scripts that work
// without a real DOM belong in these tests: pure logic (js/core, parsers, geometry) is the point of splitting it out.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.join(__dirname, '..', '..', 'src', 'renderer', 'js');

function loadPanelScripts(files, globals) {
    const ctx = vm.createContext(Object.assign({ console, setTimeout, clearTimeout, Date, Math, JSON }, globals || {}));
    for (const f of files) {
        const file = path.join(JS_DIR, f);
        // const / let at the top of a classic script are not properties of the global object; turning them into var
        // (only at the start of a line, outside any block) exposes them to the test the way the panel shares them.
        const src = fs.readFileSync(file, 'utf8').replace(/^(const|let) /gm, 'var ');
        vm.runInContext(src, ctx, { filename: file });
    }
    return ctx;
}

// A localStorage stand-in; `broken: true` makes every call throw, like blocked storage.
function fakeLocalStorage(broken) {
    const m = new Map();
    const guard = () => { if (broken) throw new Error('storage blocked'); };
    return {
        getItem(k) { guard(); return m.has(String(k)) ? m.get(String(k)) : null; },
        setItem(k, v) { guard(); m.set(String(k), String(v)); },
        removeItem(k) { guard(); m.delete(String(k)); },
        get size() { return m.size; }
    };
}

module.exports = { JS_DIR, loadPanelScripts, fakeLocalStorage };
