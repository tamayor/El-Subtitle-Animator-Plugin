// The panel's per-computer settings in localStorage, through one wrapper. localStorage can throw (blocked storage,
// quota), so every call is guarded and a read falls back to the default given.
//
//   store.get('presetsTab', 'text')         string, or the fallback when unset / unreadable
//   store.set('presetsTab', 'fx')           false when it could not be written
//   store.getJSON('fxParams', {})           parsed value, or the fallback when unset / not JSON
//   store.setJSON('fxParams', obj)
//   store.flag('sa.ccLockX')                '1' -> true, '0' -> false, unset -> fallback (default false)
//   store.setFlag('sa.ccLockX', on)
//   store.remove('key')
//
// Feature modules own their keys; shared components (js/ui, js/components) take values and callbacks instead of
// reading storage themselves.

const store = {
    get(key, fallback) {
        try { const v = localStorage.getItem(key); return v === null ? (fallback === undefined ? null : fallback) : v; }
        catch (e) { return fallback === undefined ? null : fallback; }
    },
    set(key, value) {
        try { localStorage.setItem(key, String(value)); return true; } catch (e) { return false; }
    },
    getJSON(key, fallback) {
        const raw = store.get(key, null);
        if (raw === null) return fallback === undefined ? null : fallback;
        try { return JSON.parse(raw); } catch (e) { return fallback === undefined ? null : fallback; }
    },
    setJSON(key, value) {
        let text;
        try { text = JSON.stringify(value); } catch (e) { return false; }
        return store.set(key, text);
    },
    flag(key, fallback) {
        const v = store.get(key, null);
        return v === null ? !!fallback : v === '1';
    },
    setFlag(key, on) {
        return store.set(key, on ? '1' : '0');
    },
    remove(key) {
        try { localStorage.removeItem(key); return true; } catch (e) { return false; }
    }
};
