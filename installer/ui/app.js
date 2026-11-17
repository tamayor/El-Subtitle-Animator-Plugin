// The installer window: a checklist built from the main process's scan, an Install button, and what to do afterwards.
'use strict';

const api = window.installer;
const $ = (id) => document.getElementById(id);
const BADGE = { ok: 'Installed', missing: 'Not installed', update: 'Needs update', blocked: 'Not available' };

let state = null;
let busy = false;
const rows = new Map();          // id -> { box, badge, log, error }
const ticked = new Map();        // id -> the user's own choice, kept across rescans
const errors = new Map();        // id -> why its last install failed, kept across rescans

function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
}

function setBadge(row, cls, text) {
    row.badge.className = 'badge ' + cls;
    row.badge.textContent = text;
    row.badge.title = text;
}

function showError(row, text) {
    setBadge(row, 'error', 'Failed');
    row.log.textContent = '';
    row.error.textContent = text;
    row.error.hidden = false;
}

// Ticked to start with: the panel always, and anything that is missing or out of date.
function defaultTick(item) { return item.required || item.state === 'missing' || item.state === 'update'; }

function render() {
    const list = $('list');
    list.textContent = '';
    rows.clear();
    $('lost').hidden = state.found;
    $('folder').textContent = state.found ? state.mainDir : 'Not found';
    $('folder').title = state.found ? state.mainDir : '';
    for (const group of state.groups) {
        const items = state.items.filter(i => i.group === group.id);
        if (!items.length) continue;
        list.append(el('div', 'group', group.title));
        for (const item of items) {
            const wrap = el('label', 'item' + (item.state === 'blocked' ? ' blocked' : ''));
            const box = el('input');
            box.type = 'checkbox';
            box.disabled = item.required || item.state === 'blocked';
            box.checked = item.state !== 'blocked' && (item.required || (ticked.has(item.id) ? ticked.get(item.id) : defaultTick(item)));
            box.addEventListener('change', () => { ticked.set(item.id, box.checked); refresh(); });
            const title = el('div', 'title', item.title);
            if (item.size) title.append(el('span', 'size', 'about ' + item.size));
            const row = { item, box, badge: el('div'), log: el('div', 'log'), error: el('div', 'error') };
            row.error.hidden = true;
            setBadge(row, item.state, item.note || BADGE[item.state]);
            wrap.append(box, title, row.badge, el('div', 'detail', item.detail), row.log, row.error);
            list.append(wrap);
            rows.set(item.id, row);
            if (errors.has(item.id)) showError(row, errors.get(item.id));
        }
    }
    refresh();
}

function chosen() { return [...rows.values()].filter(r => r.box.checked).map(r => r.item.id); }

function refresh() {
    const n = chosen().length;
    $('install').disabled = busy || !state || !state.found || !n;
    $('install').textContent = busy ? 'Installing…' : 'Install';
    $('stop').hidden = !busy;
    for (const id of ['all', 'none', 'choose']) $(id).disabled = busy;
    for (const r of rows.values()) r.box.disabled = busy || r.item.required || r.item.state === 'blocked';
    if (!busy) $('summary').textContent = state && state.found ? n + (n === 1 ? ' item' : ' items') + ' selected' : '';
}

function showResolve() {
    const btn = $('resolveBtn');
    $('stepRestart').textContent = state.resolveRunning
        ? 'DaVinci Resolve is open: quit it completely and open it again.'
        : 'Open DaVinci Resolve.';
    btn.textContent = state.resolveRunning ? 'Restart DaVinci Resolve' : 'Open DaVinci Resolve';
    btn.hidden = !state.resolveInstalled || (state.resolveRunning && !state.canRestart);
    btn.onclick = async () => {
        btn.disabled = true;
        $('resolveMsg').textContent = state.resolveRunning ? 'Waiting for Resolve to quit (it may ask to save)…' : 'Opening…';
        const r = state.resolveRunning ? await api.restartResolve() : await api.openResolve();
        $('resolveMsg').textContent = r.ok ? 'Resolve is starting.' : r.error;
        state.resolveRunning = (await api.state()).resolveRunning;
        btn.disabled = false;
        showResolve();
    };
}

async function load() {
    state = await api.state();
    render();
}

async function install() {
    const ids = chosen();
    if (!ids.length || busy) return;
    busy = true;
    $('finished').hidden = true;
    errors.clear();
    for (const id of ids) { const r = rows.get(id); setBadge(r, '', 'Waiting'); r.log.textContent = ''; r.error.hidden = true; }
    refresh();
    const result = await api.install(ids);
    busy = false;
    const failed = (result.results || []).filter(r => !r.ok);
    for (const f of failed) errors.set(f.id, f.error);
    for (const id of ids) ticked.set(id, errors.has(id));          // what failed stays ticked for another try
    await load();
    const pluginOk = (result.results || []).some(r => r.id === 'plugin' && r.ok);
    const claudeOk = (result.results || []).some(r => (r.id === 'mcp' || r.id === 'skills') && r.ok);
    $('finished').hidden = !pluginOk && !claudeOk && failed.length > 0;
    $('finishedTitle').textContent = failed.length ? 'Installed, with ' + failed.length + (failed.length === 1 ? ' item' : ' items') + ' that failed (see below).' : 'Everything is installed.';
    $('stepClaude').hidden = !claudeOk;
    showResolve();
    $('summary').textContent = result.stopped ? 'Stopped' : failed.length ? failed.length + ' failed' : 'Done';
    document.querySelector('main').scrollTop = 0;
}

api.onProgress((msg) => {
    const r = rows.get(msg.id);
    if (!r) return;
    if (msg.phase === 'start') { setBadge(r, 'working', 'Installing…'); $('summary').textContent = r.item.title; }
    else if (msg.phase === 'log') { r.log.textContent = msg.text; r.log.title = msg.text; }
    else if (msg.phase === 'done') { setBadge(r, 'ok', msg.note || 'Installed'); r.log.textContent = ''; }
    else if (msg.phase === 'error') showError(r, msg.text);
    else if (msg.phase === 'skipped') setBadge(r, '', 'Skipped');
});

async function chooseFolder() {
    const r = await api.chooseFolder();
    if (r.ok) { ticked.clear(); await load(); }
    else if (r.error) $('summary').textContent = r.error;
}

$('install').addEventListener('click', install);
$('stop').addEventListener('click', () => { $('summary').textContent = 'Stopping…'; api.stop(); });
$('choose').addEventListener('click', chooseFolder);
$('chooseLost').addEventListener('click', chooseFolder);
$('folder').addEventListener('click', () => api.showFolder());
$('all').addEventListener('click', () => { for (const r of rows.values()) if (!r.box.disabled) { r.box.checked = true; ticked.set(r.item.id, true); } refresh(); });
$('none').addEventListener('click', () => { for (const r of rows.values()) if (!r.box.disabled) { r.box.checked = false; ticked.set(r.item.id, false); } refresh(); });
window.addEventListener('focus', () => { if (!busy) load(); });

load();
