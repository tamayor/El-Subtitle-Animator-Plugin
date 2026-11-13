// Sending a value to Resolve while it changes (slider drag, typing) without flooding the bridge: changes are merged
// and sent at most every `ms`. Use this instead of a private setTimeout/clearTimeout pair.
//
//   const sender = createThrottledSender(async (values) => { ... window.sa.something(values) ... }, { ms: 110 });
//   sender.push({ boxWidth: 0.4 });        merged with what is waiting (objects: later keys win; anything else: replaced)
//   sender.push({ boxWidth: 0.5 }, true);  send now (release, Enter, button) with whatever was waiting
//   sender.flush();                        send what is waiting now
//   sender.cancel();                       drop what is waiting (e.g. the clip changed)
//   sender.sentAt                          when the last send started (ms), for "don't overwrite a value just sent"
//
// mode 'throttle' (default): the first change goes out as soon as `ms` has passed since the last send, so a drag
// updates Resolve steadily. mode 'debounce': it goes out `ms` after the last change, so typing sends once.

function createThrottledSender(send, opts) {
    const ms = Math.max(0, Number(opts && opts.ms) || 0);
    const mode = (opts && opts.mode) === 'debounce' ? 'debounce' : 'throttle';
    const merge = (opts && typeof opts.merge === 'function') ? opts.merge : mergeSendValues;
    let pending, has = false, timer = 0, sentAt = -Infinity;     // never sent: the first change goes out at once

    function fire() {
        timer = 0;
        if (!has) return undefined;
        const v = pending;
        pending = undefined; has = false;
        sentAt = Date.now();
        return send(v);
    }
    return {
        push(value, now) {
            pending = has ? merge(pending, value) : merge(undefined, value);
            has = true;
            clearTimeout(timer); timer = 0;
            if (now) return fire();
            const wait = mode === 'debounce' ? ms : Math.max(0, ms - (Date.now() - sentAt));
            timer = setTimeout(fire, wait);
            return undefined;
        },
        flush() { clearTimeout(timer); return fire(); },
        cancel() { clearTimeout(timer); timer = 0; pending = undefined; has = false; },
        get waiting() { return has; },
        get sentAt() { return sentAt === -Infinity ? 0 : sentAt; }
    };
}

function mergeSendValues(a, b) {
    const plain = (x) => x && typeof x === 'object' && !Array.isArray(x);
    if (plain(b)) return Object.assign({}, plain(a) ? a : {}, b);
    return b;
}
