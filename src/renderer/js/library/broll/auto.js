// B-roll tab: Auto (suggest overlays from the subtitles, place the ticked ones).

// ------------------------------------------------------------------ auto

function brRenderAllow() {
    const box = $('brAllow');
    box.textContent = '';
    let off = store.getJSON('brAllowOff', []);
    if (!Array.isArray(off)) off = [];
    for (const e of brUI.effects) {
        const cb = createEl('input', { type: 'checkbox', 'data-id': e.id });
        cb.checked = !off.includes(e.id);
        cb.addEventListener('change', () => {
            const o = [...box.querySelectorAll('input')].filter(i => !i.checked).map(i => i.dataset.id);
            store.set('brAllowOff', JSON.stringify(o));
        });
        box.append(createEl('label', { class: 'br-chip' }, [cb, createEl('span', { text: e.name })]));
    }
}

function brPropsLine(p) {
    return Object.entries(p || {}).map(([k, v]) => k + ': ' + (Array.isArray(v) ? v.join(', ') : v)).join(' · ');
}

async function brSuggest() {
    if (brUI.busy) return;
    const effects = [...$('brAllow').querySelectorAll('input')].filter(i => i.checked).map(i => i.dataset.id);
    brStatus('Reading the subtitles…', '', 'brAutoStatus');
    const r = await window.sa.brollSuggest({ max: Number($('brMax').value) || 8, minGap: Number($('brGap').value), effects,
        from: Number($('brFrom').value) || undefined, to: Number($('brTo').value) || undefined, marks: $('brAutoMarks').checked });
    if (!r || r.error) { brStatus((r && r.error) || 'Failed', 'bad', 'brAutoStatus'); return; }
    brUI.suggestions = r.suggestions.map(s => ({ ...s, on: true }));
    brRenderSuggestions();
    brStatus(r.suggestions.length ? r.suggestions.length + ' suggestions from ' + r.subtitles + ' subtitles. Untick any you do not want, or Edit one first.'
        : 'Nothing in ' + r.subtitles + ' subtitles matched. Use Make for a hand-picked line.', r.suggestions.length ? 'ok' : '', 'brAutoStatus');
}

function brRenderSuggestions() {
    const box = $('brSuggestions');
    box.textContent = '';
    for (const s of brUI.suggestions) {
        const cb = createEl('input', { type: 'checkbox' });
        cb.checked = s.on;
        cb.addEventListener('change', () => { s.on = cb.checked; $('brPlaceTicked').disabled = brUI.busy || !brUI.suggestions.some(x => x.on); });
        const sel = createEl('select', { class: 'br-sel' }, brUI.effects.map(e => { const o = createEl('option', { value: e.id, text: e.name }); if (e.id === s.effect) o.selected = true; return o; }));
        sel.addEventListener('change', () => { s.effect = sel.value; s.props = {}; s.name = sel.selectedOptions[0].textContent; });
        box.append(createEl('div', { class: 'br-item' }, [
            cb,
            createEl('span', { class: 'br-num', text: '#' + s.subtitle }),
            createEl('div', { class: 'br-item-main' }, [createEl('div', { class: 'br-item-text', text: s.text }), createEl('div', { class: 'br-item-props', text: brPropsLine(s.props) + ' — ' + s.why })]),
            sel,
            createEl('button', { class: 'ghost', text: 'Edit', title: 'Open in Make with this subtitle', onclick: () => {
                brEdit(null);
                brPick(s.effect, s.props);
                $('brWhere').value = 'num'; $('brSub').value = s.subtitle; brWhereChanged();
                brSubTab('make');
            } })
        ]));
    }
    $('brPlaceTicked').disabled = brUI.busy || !brUI.suggestions.some(s => s.on);
}

async function brPlaceTicked() {
    const land = $('brLand').checked;
    const ext = Number($('brExtend').value) > 0 ? Number($('brExtend').value) : undefined;
    const draft = $('brDraft').checked || undefined;
    const list = brUI.suggestions.filter(s => s.on).map(s => ({ effect: s.effect, props: s.props, subtitle: s.subtitle, landOnWord: land || undefined, extend: ext, draft }));
    if (!list.length || brUI.busy) return;
    brBusy(true);
    brStatus('Placing ' + list.length + '…', '', 'brAutoStatus');
    const r = await window.sa.brollPlaceMany(list);
    brBusy(false);
    if (!r || r.error) { brStatus((r && r.error) || 'Failed', 'bad', 'brAutoStatus'); return; }
    const ok = r.filter(x => x.ok).length, bad = r.filter(x => !x.ok);
    brStatus(ok + ' placed' + (bad.length ? ', ' + bad.length + ' failed: ' + bad.map(b => '#' + b.subtitle + ' ' + b.error).join('; ') : ''), bad.length ? 'bad' : 'ok', 'brAutoStatus');
    for (const s of brUI.suggestions) if (s.on && r.some(x => x.ok && x.subtitle && x.subtitle.index === s.subtitle)) s.on = false;
    brUI.suggestions = brUI.suggestions.filter(s => !r.some(x => x.ok && x.subtitle && x.subtitle.index === s.subtitle));
    brRenderSuggestions();
    brLoadPlaced();
}
