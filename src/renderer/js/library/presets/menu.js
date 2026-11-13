// The preset list (js/library/presets/: menu, tags section, reorder, view modes, list and cards, variation stacks).
// This file: toggling a tag on a preset and the row menu.

async function toggleTagOn(id, tagId) {
    const a = libEntry(id);
    if (!a) return false;
    const mine = Array.isArray(a.tags) ? a.tags : [];
    const next = mine.includes(tagId) ? mine.filter(x => x !== tagId) : mine.concat(tagId);
    takeLib(await window.sa.updateAnimation(a.id, { tags: next }));
    return next.includes(tagId);
}

// The ⋯ menu on a library row: tick tags on/off, make a new tag, or delete the preset.
function openRowMenu(anchor, a) {
    openPop(anchor, 'pop-menu', (el) => {
        const head = document.createElement('div');
        head.className = 'pop-title'; head.textContent = 'Tags';
        el.appendChild(head);
        const mine = Array.isArray(a.tags) ? a.tags : [];
        if (!allTags().length) {
            const e = document.createElement('div');
            e.className = 'pop-empty'; e.textContent = 'No tags yet';
            el.appendChild(e);
        }
        for (const t of allTags()) {
            const it = document.createElement('button');
            it.className = 'pop-item' + (mine.includes(t.id) ? ' on' : '');
            const ck = document.createElement('span'); ck.className = 'pop-check'; ck.textContent = '✓';
            const d = tagMarkEl(t);
            const n = document.createElement('span'); n.className = 'pop-label'; n.textContent = t.name;
            it.append(ck, d, n);
            it.addEventListener('click', async () => { it.classList.toggle('on', await toggleTagOn(a.id, t.id)); });
            el.appendChild(it);
        }
        const nt = document.createElement('button');
        nt.className = 'pop-item';
        nt.innerHTML = '<span class="pop-check">+</span><span class="pop-label">New tag…</span>';
        nt.addEventListener('click', () => { closePop(); openNewTagPop(anchor, a.id); });
        el.appendChild(nt);
        const sep = document.createElement('div'); sep.className = 'pop-sep';
        el.appendChild(sep);
        const rev = document.createElement('button');
        rev.className = 'pop-item';
        rev.innerHTML = '<span class="pop-check">↺</span><span class="pop-label">Revert to original version</span>';
        rev.addEventListener('click', () => {
            closePop();
            openConfirmPop(anchor, {
                title: 'Revert to original version?',
                message: 'Restore "' + a.name + '" back to its original .settings file, text design, alignment, and sound? Any saved updates will be overwritten.',
                confirmText: 'Revert',
                danger: true,
                onConfirm: async () => {
                    const res = await window.sa.revertAnimation(a.id);
                    if (takeLib(res)) {
                        setStatus('Reverted "' + a.name + '" to original version.', 'ok');
                    }
                }
            });
        });
        el.appendChild(rev);
        const del = document.createElement('button');
        del.className = 'pop-item danger';
        del.innerHTML = '<span class="pop-check">🗑</span><span class="pop-label">Delete preset</span>';
        del.addEventListener('click', async () => {
            closePop();
            if (!confirm('Delete "' + a.name + '" from your library?')) return;
            if (state.selectedId === a.id) state.selectedId = null;
            if (state.createId === a.id) state.createId = null;
            stopPreview();
            takeLib(await window.sa.removeAnimation(a.id));
        });
        el.appendChild(del);
    });
}
