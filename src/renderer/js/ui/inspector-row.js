// Inspector control rows shared by the panel's cards. A row is controlled: it shows the value it is given and reports
// changes through callbacks; it never reads `state` or storage.
//
//   const r = sliderRow({
//       label: 'Opacity', min: 0, max: 100, step: 1, value: 40,
//       format: v => v + '%',              text of the value read-out (default String)
//       tip: 'How strong ...',             tooltip of the row
//       onInput: v => ...,                 while dragging          onChange: v => ...   on release
//       onReset: () => 25,                 double-click: return the value to show (undefined = leave it)
//       onGrab / onRelease: () => ...,     pointer down / up on the slider (e.g. hold a card rebuild)
//       setup: rangeEl => ...,             anything else the caller wires on the slider
//       cls: { row, cap, val },            class names (default: the .fx-strength look of the effect cards)
//       tag: 'label',                      row element
//   });
//   card.appendChild(r.el); r.set(50); r.range / r.val
//
// step: null leaves the slider's step attribute unset (the browser default, 1).

function sliderRow(o) {
    const c = Object.assign({ row: 'fx-strength', cap: 'fx-strength-cap', val: 'fx-strength-val' }, o.cls || {});
    const fmt = typeof o.format === 'function' ? o.format : (v => String(v));
    const el = document.createElement(o.tag || 'label');
    el.className = c.row;
    if (o.tip) el.title = o.tip;
    const cap = document.createElement('span'); cap.className = c.cap; cap.textContent = o.label;
    const range = document.createElement('input');
    range.type = 'range'; range.min = String(o.min); range.max = String(o.max);
    if (o.step !== null) range.step = String(o.step || 1);
    range.value = String(o.value);
    const val = document.createElement('span'); val.className = c.val; val.textContent = fmt(Number(range.value));
    const set = (v) => { range.value = String(v); val.textContent = fmt(Number(range.value)); };
    if (o.setup) o.setup(range);
    if (o.onGrab) range.addEventListener('pointerdown', o.onGrab);
    if (o.onRelease) for (const ev of ['pointerup', 'pointercancel']) range.addEventListener(ev, o.onRelease);
    range.addEventListener('input', () => { const v = Number(range.value); val.textContent = fmt(v); if (o.onInput) o.onInput(v); });
    if (o.onChange) range.addEventListener('change', () => o.onChange(Number(range.value)));
    if (o.onReset) range.addEventListener('dblclick', () => { const v = o.onReset(); if (v !== undefined) set(v); });
    el.append(cap, range, val);
    return { el, range, val, set };
}
