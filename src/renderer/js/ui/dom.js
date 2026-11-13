// Building DOM nodes. Every panel file uses this one helper instead of its own (the old mk / brEl / ccEl).
//
//   createEl('div', 'cc-head', 'Gradient')                 tag, class name, text
//   createEl('button', { class: 'btn small', text: 'Add', type: 'button', onclick: fn }, [child, 'text', null])
//   createEl('div', { class: 'row', dataset: { id: 'x' }, style: { width: '40px' }, title: 'tip' }, kids)
//
// props: class / className, text (textContent), on<event> listeners, dataset and style objects; anything else is an
// attribute (true -> present, false / null / undefined -> left out). kids: nodes, strings or numbers; null, undefined
// and false are skipped. Prefer this to building HTML strings (no escaping mistakes).

function createEl(tag, props, kids) {
    const el = document.createElement(tag);
    if (typeof props === 'string') {
        if (props) el.className = props;
        if (kids !== undefined && kids !== null && typeof kids !== 'object') { el.textContent = String(kids); return el; }
    } else {
        for (const [k, v] of Object.entries(props || {})) {
            if (v === undefined || v === null || v === false) continue;
            if (k === 'class' || k === 'className') el.className = v;
            else if (k === 'text') el.textContent = v;
            else if (k === 'dataset') Object.assign(el.dataset, v);
            else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
            else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
            else el.setAttribute(k, v === true ? '' : v);
        }
    }
    appendKids(el, kids);
    return el;
}

function appendKids(el, kids) {
    if (kids === undefined || kids === null || kids === false) return el;
    for (const c of [].concat(kids)) {
        if (c === null || c === undefined || c === false) continue;
        el.append(c.nodeType ? c : String(c));
    }
    return el;
}
