// MultiText row links (src/renderer/js/timeline/clip-controls/row-links.js): Upper / Lower Y and the two gaps.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPanelScripts } = require('../helpers/renderer');

const R = loadPanelScripts(['timeline/clip-controls/row-links.js']);
const base = { ue: 40, el: 60, uy: 0.1, ly: -0.1, fh: 1000, equal: false, lock: false };
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, msg + ': ' + a + ' vs ' + b);

test('moving the upper row up opens the gap above by dy x frame height; the lower row stays', () => {
    const r = R.rowLinkEdit('UpperY', 0.12, base);
    close(r.uy, 0.12, 'uy'); close(r.ue, 60, 'gap above +20 px'); close(r.el, 60, 'gap below unchanged'); close(r.ly, -0.1, 'lower row stays');
});

test('a gap edit moves its row: gap below +30 px puts the lower row 0.03 lower', () => {
    const r = R.rowLinkEdit('RowsSetEL', 90, base);
    close(r.el, 90, 'el'); close(r.ly, -0.13, 'ly'); close(r.ue, 40, 'ue'); close(r.uy, 0.1, 'uy');
});

test('Equal Gaps: both gaps stay one value and the partner row follows', () => {
    const r = R.rowLinkEdit('RowsSetUE', 50, Object.assign({}, base, { equal: true }));
    close(r.ue, 50, 'ue'); close(r.el, 50, 'el = ue'); close(r.uy, 0.11, 'upper row'); close(r.ly, -0.09, 'lower row closes 10 px');
});

test('Lock Gaps: both gaps move by the same amount, even when they differ', () => {
    const r = R.rowLinkEdit('LowerY', -0.11, Object.assign({}, base, { lock: true }));
    close(r.el, 70, 'gap below +10'); close(r.ue, 50, 'gap above +10'); close(r.uy, 0.11, 'upper row follows');
});

test('Equalize: both gaps become their mean and the rows move to match', () => {
    const r = R.rowLinkEqualize(base);
    close(r.ue, 50, 'ue'); close(r.el, 50, 'el'); close(r.uy, 0.11, 'uy'); close(r.ly, -0.09, 'ly');
});
