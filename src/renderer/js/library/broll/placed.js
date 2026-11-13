// B-roll tab: Placed (the overlays on the timeline: sync, finalize, edit).

// ------------------------------------------------------------------ placed

async function brLoadPlaced() {
    const r = await window.sa.brollList({});
    if (!r || r.error) return;
    brUI.placed = r.placed;
    $('brPlacedCount').textContent = r.placed.length ? String(r.placed.length) : '';
    const drafts = r.drafts || 0;
    $('brFinalizeAll').classList.toggle('hidden', !drafts);
    $('brFinalizeAll').textContent = drafts > 1 ? 'Finalize ' + drafts + ' drafts' : 'Finalize draft';
    const dn = $('brDraftNote');
    dn.classList.toggle('hidden', !drafts);
    dn.textContent = drafts ? drafts + (drafts > 1 ? ' clips are' : ' clip is') + ' a half-size draft (orange on the timeline). Finalize before you export.' : '';
    const box = $('brPlacedList');
    box.textContent = '';
    if (!r.placed.length) { box.append(createEl('div', { class: 'cr-sub', text: 'No B-roll placed on ' + (r.timeline || 'this timeline') + ' yet.' })); return; }
    for (const p of r.placed) {
        const sec = p.fps ? (p.frames / p.fps).toFixed(1) + ' s' : '';
        box.append(createEl('div', { class: 'br-item' + (p.onTimeline === false ? ' gone' : '') }, [
            createEl('span', { class: 'br-num', text: p.subtitle ? '#' + p.subtitle.index : '·' }),
            createEl('div', { class: 'br-item-main' }, [
                createEl('div', { class: 'br-item-text' }, [p.draft ? createEl('span', { class: 'br-draft', text: 'draft' }) : null,
                    p.name + ' · ' + (p.track || '') + ' · ' + sec + (p.onTimeline === false ? ' · not on the timeline' : '')]),
                createEl('div', { class: 'br-item-props', text: brPropsLine(p.props) })
            ]),
            createEl('button', { class: 'ghost br-id', text: p.id, title: 'Copy the id (for Claude: adjust_broll ' + p.id + ' …)', onclick: () => { try { navigator.clipboard.writeText(p.id); } catch (e) { /* ignore */ } } }),
            p.draft ? createEl('button', { class: 'ghost', text: 'Finalize', disabled: p.onTimeline === false, title: 'Re-render at full size, in place', onclick: () => brFinalize({ id: p.id }) }) : null,
            createEl('button', { class: 'ghost', text: 'Sync', disabled: p.onTimeline === false, title: 'Re-time it so the animation lands as its key word is spoken', onclick: () => brSync({ id: p.id }) }),
            createEl('button', { class: 'ghost', text: 'Edit', disabled: p.onTimeline === false, onclick: () => { brEdit(p); brSubTab('make'); } }),
            createEl('button', { class: 'ghost', text: '×', title: 'Remove from the timeline', onclick: async () => {
                const x = await window.sa.brollRemove({ id: p.id });
                if (brUI.editing && brUI.editing.id === p.id) brEdit(null);
                if (x && x.error) brStatus(x.error, 'bad');
                brLoadPlaced();
            } })
        ]));
    }
}

// Sync to words: one clip ({ id }) or every one on the timeline ({ all: true }).
async function brSync(o) {
    if (brUI.busy) return;
    brBusy(true);
    brStatus(o.all ? 'Syncing every B-roll to its word…' : 'Syncing to the word…', '', 'brPlacedStatus');
    const r = await window.sa.brollSync(o);
    brBusy(false);
    if (!r || r.error) { brStatus((r && r.error) || 'Failed', 'bad', 'brPlacedStatus'); return; }
    const ok = r.results.filter(x => x.ok), bad = r.results.filter(x => !x.ok);
    const words = ok.map(x => '“' + x.word + '”' + (x.source === 'speech' ? '' : '*')).join(', ');
    brStatus((ok.length ? ok.length + ' synced' + (words ? ': ' + words : '') : '') + (bad.length ? (ok.length ? '; ' : '') + bad.length + ' failed: ' + bad.map(b => b.error).join('; ') : '')
        + (r.note ? ' — * ' + r.note : ''), bad.length ? 'bad' : 'ok', 'brPlacedStatus');
    brLoadPlaced();
}

// Finalize: drafts re-rendered at full size under the same clip (one { id } or { all: true }).
async function brFinalize(o) {
    if (brUI.busy) return;
    brBusy(true);
    brStatus(o.all ? 'Finalizing the drafts at full size…' : 'Finalizing at full size…', '', 'brPlacedStatus');
    const r = await window.sa.brollFinalize(o);
    brBusy(false);
    if (!r || r.error) { brStatus((r && r.error) || 'Failed', 'bad', 'brPlacedStatus'); return; }
    const bad = r.results.filter(x => !x.ok);
    brStatus(r.note || (r.finalized + ' finalized' + (bad.length ? ', ' + bad.length + ' failed: ' + bad.map(b => b.error).join('; ') : '')), bad.length ? 'bad' : 'ok', 'brPlacedStatus');
    if (brUI.editing && r.results.some(x => x.ok && x.id === brUI.editing.id)) brUI.editing.draft = undefined;
    brLoadPlaced();
}
