// Runs a command and passes its output on line by line. One command runs at a time, so Stop can end it.

const { spawn } = require('child_process');

let current = null;
let stopped = false;

function run(cmd, args, opts, onLine) {
    return new Promise((resolve) => {
        if (stopped) return resolve({ code: -1, out: '', err: 'Stopped' });
        let out = '', err = '', buf = '';
        let p;
        try { p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...(opts || {}) }); }
        catch (e) { return resolve({ code: -1, out, err: String(e.message || e) }); }
        current = p;
        const feed = (chunk, isErr) => {
            const s = String(chunk);
            if (isErr) err = (err + s).slice(-4000); else out = (out + s).slice(-200000);
            if (!onLine) return;
            buf += s;
            const lines = buf.split(/\r?\n|\r/);
            buf = lines.pop();
            for (const l of lines) if (l.trim()) onLine(l.trim());
        };
        p.stdout.on('data', d => feed(d, false));
        p.stderr.on('data', d => feed(d, true));
        p.on('error', e => { current = null; resolve({ code: -1, out, err: String(e.message || e) }); });
        p.on('close', code => {
            if (current === p) current = null;
            if (onLine && buf.trim()) onLine(buf.trim());
            resolve({ code: stopped ? -1 : code, out, err: stopped ? 'Stopped' : err });
        });
    });
}

// A quick yes / no check that never shows in the log.
function quiet(cmd, args, opts) {
    return new Promise((resolve) => {
        let out = '';
        let p;
        try { p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000, ...(opts || {}) }); }
        catch (e) { return resolve({ code: -1, out }); }
        p.stdout.on('data', d => { out += d; });
        p.on('error', () => resolve({ code: -1, out }));
        p.on('close', code => resolve({ code, out }));
    });
}

function stop() {
    stopped = true;
    if (current) { try { current.kill('SIGTERM'); } catch (e) { /* already gone */ } }
}
function reset() { stopped = false; }
function isStopped() { return stopped; }

// The last lines of a failed command, short enough to show beside its item.
function tail(r) {
    const text = (r.err || r.out || '').trim().split('\n').filter(Boolean).slice(-3).join(' | ');
    return text.slice(-400) || 'exit code ' + r.code;
}

module.exports = { run, quiet, stop, reset, isStopped, tail };
