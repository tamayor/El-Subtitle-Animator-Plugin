// Fusion helper: a long-running Python process (python/fusion_bridge.py) that performs the Fusion operations
// the Workflow Integration API cannot. Requests are JSON lines matched to replies by id.

module.exports = {
    bridgeCall
};

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const state = require('./state');
const { BRIDGE_SCRIPT } = require('./config');

// Resolve's JavaScript plugin interface cannot read the nodes inside a Fusion composition, but its Python
// scripting can, so a small helper (fusion_bridge.py) is kept running and asked to do those parts.
let bridgeBuf = '', bridgeErr = '';
let bridgeSeq = 1;
const bridgePending = new Map();

function pythonPath() {
    const list = [
        '/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Resources/ResolvePython/ResolvePython',
        '/usr/bin/python3', '/opt/homebrew/bin/python3', '/usr/local/bin/python3'
    ];
    return list.find(p => fs.existsSync(p)) || 'python3';
}

function startBridge() {
    const api = '/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting';
    const env = Object.assign({}, process.env, {
        RESOLVE_SCRIPT_API: api,
        RESOLVE_SCRIPT_LIB: '/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fusionscript.so',
        PYTHONPATH: path.join(api, 'Modules') + path.delimiter + (process.env.PYTHONPATH || '')
    });
    bridgeBuf = ''; bridgeErr = '';
    const proc = spawn(pythonPath(), [BRIDGE_SCRIPT], { env });
    proc.stdout.on('data', (d) => {
        bridgeBuf += d.toString();
        let i;
        while ((i = bridgeBuf.indexOf('\n')) >= 0) {
            const line = bridgeBuf.slice(0, i); bridgeBuf = bridgeBuf.slice(i + 1);
            try {
                const msg = JSON.parse(line);
                const p = bridgePending.get(msg.id);
                if (p) { bridgePending.delete(msg.id); clearTimeout(p.timer); msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error || 'Fusion helper error')); }
            } catch (e) { /* ignore stray output */ }
        }
    });
    proc.stderr.on('data', (d) => { bridgeErr = (bridgeErr + d.toString()).slice(-400); });
    proc.stdin.on('error', () => { /* helper went away: the exit handler rejects what was waiting */ });
    proc.stdout.on('error', () => { /* ignore */ });
    proc.stderr.on('error', () => { /* ignore */ });
    const fail = (why) => {
        for (const p of bridgePending.values()) { clearTimeout(p.timer); p.reject(new Error(why + (bridgeErr ? ' ' + bridgeErr : ''))); }
        bridgePending.clear();
        if (state.bridge === proc) state.bridge = null;
    };
    proc.on('error', (e) => fail('Could not start Python: ' + e.message));
    proc.on('exit', () => fail('The Fusion helper stopped.'));
    return proc;
}

function bridgeCall(op, args, timeoutMs) {
    if (!state.bridge || state.bridge.exitCode !== null || state.bridge.killed || !state.bridge.stdin || state.bridge.stdin.destroyed) state.bridge = startBridge();
    const id = bridgeSeq++;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            bridgePending.delete(id);
            reject(new Error('The Fusion helper did not answer'));
            if (op === 'capture') { try { if (state.bridge) state.bridge.kill(); } catch (e) { /* ignore */ } state.bridge = null; }      // a stuck render: the helper is started fresh next time
        }, op === 'capture' ? Math.min(timeoutMs || 90000, 90000) : (timeoutMs || 20000));
        bridgePending.set(id, { resolve, reject, timer });
        try { state.bridge.stdin.write(JSON.stringify({ id, op, args }) + '\n'); } catch (e) { bridgePending.delete(id); clearTimeout(timer); state.bridge = null; reject(e); }
    });
}
