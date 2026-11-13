// The automation tools' schemas (src/main/tool-schemas.js), shared by the MCP script and the HTTP server.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const env = require('../helpers/env');

const T = env.main('tool-schemas');

test('every tool has a name, a description and an object schema; names are unique', () => {
    const names = new Set();
    for (const t of T.TOOLS) {
        assert.ok(/^[a-z_]+$/.test(t.name), t.name);
        assert.ok(!names.has(t.name), 'duplicate ' + t.name);
        names.add(t.name);
        assert.ok(t.description && t.description.length > 10, t.name + ' description');
        assert.equal(t.inputSchema.type, 'object', t.name);
    }
});

test('every tool the MCP script lists is served by the plugin or by the MCP script itself', () => {
    const auto = fs.readFileSync(path.join(env.MAIN_DIR, 'automation.js'), 'utf8');
    const mcp = fs.readFileSync(path.join(env.ROOT, 'mcp', 'el-sa-mcp.js'), 'utf8');
    const lt = mcp.indexOf('const LOCAL_TOOLS = {');
    const local = mcp.slice(lt, mcp.indexOf('\n};', lt));
    for (const t of T.TOOLS) {
        const served = new RegExp('\\n    (async )?' + t.name + '[(:]').test(auto) || new RegExp('\\b' + t.name + '\\s*[(:]').test(local);
        assert.ok(served, t.name + ' has a handler');
    }
});

test('calls are checked: required and typed arguments; extras and text numbers are let through', () => {
    const place = T.toolSchema('place');
    const req = place.required || [];
    assert.ok(req.length > 0, 'place has required arguments');
    assert.match(T.checkToolArgs('place', {}), /is required/);
    const ok = {};
    for (const k of req) ok[k] = place.properties[k].type === 'integer' ? 3 : 'x';
    assert.equal(T.checkToolArgs('place', Object.assign({ somethingExtra: true }, ok)), null);
    const intKey = req.find(k => place.properties[k].type === 'integer');
    if (intKey) {
        assert.equal(T.checkToolArgs('place', Object.assign({}, ok, { [intKey]: '3' })), null, 'a number as text');
        assert.match(T.checkToolArgs('place', Object.assign({}, ok, { [intKey]: { n: 3 } })), /must be integer/);
    }
    assert.equal(T.checkToolArgs('remove_placed', { itemId: 123 }), null, 'a number where an id string is expected');
    assert.match(T.checkToolArgs('remove_placed', { itemId: { x: 1 } }), /must be string/);
    assert.match(T.checkToolArgs('status', []), /must be an object/);
    assert.equal(T.checkToolArgs('no_such_tool', { a: 1 }), null, 'unknown tools are answered by the router');
});
