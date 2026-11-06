#!/usr/bin/env node
// El Subtitle Animator MCP server (stdio, no dependencies).
// Lets Claude Code animate a Resolve timeline's subtitles with your presets, through the open plugin panel.
//
// Register once:
//   claude mcp add el-subtitle-animator -- node "/path/to/El Subtitle Animator Plugin/mcp/el-sa-mcp.js"
// The plugin panel must be open in Resolve: it writes its local address and token to
// ~/.el-subtitle-animator/mcp-endpoint.json when it starts (see src/main/automation.js).

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ENDPOINT_FILE = path.join(os.homedir(), '.el-subtitle-animator', 'mcp-endpoint.json');
const SERVER_INFO = { name: 'el-subtitle-animator', version: '1.0.0' };

const INSTRUCTIONS = `El Subtitle Animator turns a DaVinci Resolve timeline's subtitles into animated Text+/MultiText clips (with sound effects) from the user's preset library.

Workflow for editing a video:
1. Call get_rules first and follow them. The user's "notes" are their own editing rules. If the user states rules for this video (allowed emoji tags, font, layer, placement, max text size, line spacing), save them with set_rules before placing anything.
2. list_presets returns only presets allowed by the rules' tags. Never use a preset outside that list.
3. list_subtitles, then plan: which subtitles get an animation (not necessarily all of them; vary presets and avoid repeating the same one back to back), which preset fits each line (one-word / one-line / multi-line / money / emphasis presets by name and tag), and for MultiText presets which word(s) to emphasize (pass parts {upper, emphasis, lower} that together spell the subtitle).
4. Layout: if the user gives a safe-zone reference image, call set_layout with its path (look at the image yourself and pass the labels you read as guideNames top to bottom / zoneNames). A layout only applies to timelines of the same shape as its image (a 9:16 social safe zone is ignored on a 16:9 timeline; get_layout says appliesToThisTimeline). When it applies, place keeps every clip inside its safe area and off its zones (shrinking textSize if needed), and the user can say e.g. "centre the subtitle on the captions line" (guide: "captions") or "in the captions area" (guide: "captions", align: "below").
5. When rules.position.avoidFaces is true, call get_frame for the subtitle and look at it. Choose x/y (0..1, top-left origin = where the text's centre goes) so the text sits on empty space and never over a face, eyes or mouth, and stays inside the safe area. Check get_tracks if layer placement matters.
6. Call place for each subtitle. Long lines: pass text with a "\\n" line break, and if the text would run off the frame pass textSize (e.g. 0.66) rather than scale. After the first few, call get_frame (at: "end", when all words are in) to check the result, and use remove_placed to fix mistakes.
7. Report what you placed, where, and any warnings.
Show the user your plan before placing more than about 10 clips.`;

const S = (props, required) => ({ type: 'object', properties: props || {}, required: required || [], additionalProperties: false });
const subtitleArg = { type: 'integer', description: 'Subtitle number (index from list_subtitles, starting at 1)' };

const TOOLS = [
    { name: 'status', description: 'Connection check: current timeline, size, fps, subtitle count and the active editing rules.', inputSchema: S() },
    { name: 'get_rules', description: 'The editing rules every placement follows (allowed emoji tags, forced font, video layer policy, safe area, MultiText emphasis, sound, free-text notes).', inputSchema: S() },
    {
        name: 'set_rules',
        description: 'Change the editing rules (saved to edit-rules.json in the user\'s library folder; only the given fields change). Use when the user says e.g. "only use 🔥 and 💰 presets", "use only Poppins ExtraBold", "keep text on V4", "never cover faces".',
        inputSchema: S({
            allowedTags: { type: 'array', items: { type: 'string' }, description: 'Emoji, tag names or ids. Empty array = all presets allowed.' },
            tagMatch: { type: 'string', enum: ['any', 'all'], description: 'any: preset has at least one of the tags; all: every tag' },
            font: { type: ['object', 'null'], properties: { font: { type: 'string' }, style: { type: 'string' } }, description: 'Force this font on every clip, e.g. {"font":"Poppins","style":"ExtraBold"}. null = keep each preset\'s font.' },
            track: { type: 'object', properties: { mode: { type: 'string', enum: ['top', 'first-empty', 'fixed'] }, fixed: { type: 'integer', minimum: 2 } }, description: 'Video layer: top = above everything at that time, first-empty = lowest free layer above V1, fixed = always V<fixed>' },
            position: {
                type: 'object',
                properties: {
                    defaultZone: { type: ['string', 'null'], enum: ['top', 'upper', 'center', 'lower', 'bottom', null] },
                    safeTop: { type: 'number' }, safeBottom: { type: 'number' }, safeLeft: { type: 'number' }, safeRight: { type: 'number' },
                    avoidFaces: { type: 'boolean' }
                }
            },
            multitext: { type: 'object', properties: { emphasis: { type: 'string', enum: ['auto', 'last', 'first', 'center'] }, uppercaseEmphasis: { type: 'boolean' } } },
            text: {
                type: 'object',
                properties: {
                    maxSize: { type: ['number', 'null'], description: 'Largest text Size allowed, as the Inspector shows it (e.g. 0.08). MultiText: the biggest layer, and the whole group shrinks with it. null = no cap' },
                    lineSpacing: { type: ['number', 'null'], description: 'Line Spacing, as the Inspector shows it (1 = normal). MultiText: each layer\'s, and the gaps between layers grow/shrink by the same ratio. null = the preset\'s' }
                },
                description: 'Text size and spacing for every placed clip. Use when the user says e.g. "max text size 0.08", "line spacing 1.2"'
            },
            sound: { type: 'boolean', description: 'Place the presets\' sound effects' },
            notes: { type: 'string', description: 'Free-text editing rules to remember (style, pacing, what to emphasize...)' }
        })
    },
    { name: 'get_layout', description: 'The safe-zone layout read from the user\'s reference image: named guide lines (y or x, 0..1), zones to keep text off (e.g. "head"), the safe area as bands of x spans, and the region below each guide.', inputSchema: S() },
    {
        name: 'set_layout',
        description: 'Read a safe-zone reference image (PNG, ideally the timeline\'s size, e.g. 1080x1920): transparent or white = safe area, black = off-limits, dark lines (solid or dashed) across the safe area = guides, dark boxes = zones (e.g. a head box) text must not cover. Saved in the rules, so every place call fits text inside it. Without image: rename the current layout\'s guides/zones. image: "default" restores the built-in social-media 9:16 safe zone (the default; guides eye, captions, graphics; zone head). image: null clears it.',
        inputSchema: S({
            image: { type: ['string', 'null'], description: 'Path of the PNG, "default" for the built-in social 9:16 safe zone, or null to clear' },
            guideNames: { type: 'array', items: { type: 'string' }, description: 'Names for the horizontal guides, top to bottom (read the labels on the image), e.g. ["eye","captions","graphics"]' },
            verticalNames: { type: 'array', items: { type: 'string' }, description: 'Names for the vertical guides, left to right' },
            zoneNames: { type: 'array', items: { type: 'string' }, description: 'Names for the zones, top to bottom, e.g. ["head"]' },
            fit: {
                type: 'object',
                properties: {
                    enabled: { type: 'boolean', description: 'Keep placed text inside the safe area (default true)' },
                    avoidZones: { type: 'boolean', description: 'Move text off the zones (default true)' },
                    widthFactor: { type: 'number', description: 'Average glyph width per em for the text-size estimate (default 0.6; raise it if text still overflows, lower it if text is shrunk too much)' },
                    pad: { type: 'number', description: 'Margin kept from the safe edges, 0..0.1 of the frame (default 0.01)' }
                }
            }
        })
    },
    { name: 'reset_rules', description: 'Reset the editing rules to the defaults.', inputSchema: S() },
    { name: 'list_tags', description: 'The preset tags with their emoji, name and how many presets have each.', inputSchema: S() },
    {
        name: 'list_presets',
        description: 'Presets with their tags, MultiText flag, text layers, font and sound. Without arguments: only presets allowed by the rules.',
        inputSchema: S({
            tags: { type: 'array', items: { type: 'string' }, description: 'Filter by these emoji / tag names instead of the rules' },
            match: { type: 'string', enum: ['any', 'all'] },
            all: { type: 'boolean', description: 'List every preset, ignoring the rules' }
        })
    },
    { name: 'list_subtitles', description: 'The timeline\'s subtitles: index, text, frames, timecode, word count, and whether one was already placed this session.', inputSchema: S({ from: { type: 'integer' }, to: { type: 'integer' } }) },
    {
        name: 'get_frame',
        description: 'Image of the composited timeline frame at a subtitle (middle by default) or at a frame. Use it to find faces and empty space before choosing x/y, and to check a placed clip.',
        inputSchema: S({ subtitle: subtitleArg, frame: { type: 'integer' }, at: { type: 'string', enum: ['start', 'middle', 'end'] }, maxSize: { type: 'integer', description: 'Longest side in pixels (256-1280, default 768)' }, overlay: { type: 'boolean', description: 'Draw the layout (safe area, guides, zones) over the frame. Default true when a layout is set' } })
    },
    { name: 'get_tracks', description: 'Video layers (top first) with name, locked/enabled, and the clips on each during a subtitle or frame range.', inputSchema: S({ subtitle: subtitleArg, start: { type: 'integer' }, end: { type: 'integer' } }) },
    {
        name: 'place',
        description: 'Animate one subtitle with one preset. The rules are enforced (allowed tags, font, layer, safe area). x/y = where the text\'s centre goes (0..1, 0,0 = top-left); omit them to keep the preset\'s own position or use zone.',
        inputSchema: S({
            subtitle: subtitleArg,
            presetId: { type: 'string', description: 'Preset id (or exact name) from list_presets' },
            x: { type: 'number', minimum: 0, maximum: 1 },
            y: { type: 'number', minimum: 0, maximum: 1 },
            zone: { type: 'string', enum: ['top', 'upper', 'center', 'lower', 'bottom'] },
            guide: { type: 'string', description: 'Layout guide name (horizontal line, see get_layout). Sets y: centred on the line, or in the area below/above it with align' },
            align: { type: 'string', enum: ['on', 'below', 'above'], description: 'on: text centred on the guide (default); below/above: centred in the area between this guide and the next one (or the safe edge), and kept between the two lines (shrunk to fit if needed)' },
            guideX: { type: 'string', description: 'Vertical layout guide name: sets x' },
            fit: { type: 'boolean', description: 'false = do not fit this clip into the layout' },
            shrink: { type: 'boolean', description: 'false = never reduce textSize to fit the layout (only move it)' },
            scale: { type: 'number', minimum: 0.1, maximum: 5, description: 'Edit-page zoom of the whole clip. To make long text fit, use textSize instead' },
            textSize: { type: 'number', minimum: 0.2, maximum: 3, description: 'Multiplier on the preset\'s own text size (0.66 = two thirds). Text+: the font size. MultiText: every layer\'s font size, layout box and the gaps between layers scale together around the group\'s centre. Use it when the text runs off the frame or is too big. The rules\' text.maxSize still caps the result' },
            maxSize: { type: 'number', minimum: 0.01, maximum: 1, description: 'This clip only: Size cap (overrides the rules\' text.maxSize)' },
            lineSpacing: { type: 'number', minimum: 0.3, maximum: 3, description: 'This clip only: Line Spacing (overrides the rules\' text.lineSpacing)' },
            text: { type: 'string', description: 'Override the text (default: the subtitle\'s text)' },
            parts: { type: 'object', properties: { upper: { type: 'string' }, emphasis: { type: 'string' }, lower: { type: 'string' } }, description: 'MultiText presets: how the subtitle splits into the upper line, the emphasized word(s) and the lower line' },
            track: { type: 'integer', minimum: 2, description: 'Force a video layer for this clip (overrides the rules)' },
            sound: { type: 'boolean', description: 'false = no sound effect for this clip' },
            dryRun: { type: 'boolean', description: 'Only show what would be placed' }
        }, ['subtitle', 'presetId'])
    },
    { name: 'list_placed', description: 'Clips placed through this tool during the current panel session.', inputSchema: S() },
    { name: 'remove_placed', description: 'Remove a clip placed through this tool (and its sound) from the timeline.', inputSchema: S({ itemId: { type: 'string' } }, ['itemId']) }
];

// ------------------------------------------------------------------ talking to the plugin

async function callPlugin(tool, args) {
    let ep;
    try { ep = JSON.parse(fs.readFileSync(ENDPOINT_FILE, 'utf8')); } catch (e) {
        throw new Error('El Subtitle Animator is not running. Open DaVinci Resolve and the panel (Workspace > Workflow Integrations > El Subtitle Animator).');
    }
    let res;
    try {
        res = await fetch('http://127.0.0.1:' + ep.port + '/call', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-sa-token': ep.token },
            body: JSON.stringify({ tool, args: args || {} }),
            signal: AbortSignal.timeout(180000)
        });
    } catch (e) {
        throw new Error('Could not reach the El Subtitle Animator panel. Is it open in Resolve? (' + (e && e.message || e) + ')');
    }
    const body = await res.json().catch(() => null);
    if (!body) throw new Error('The panel sent an unreadable answer (HTTP ' + res.status + ').');
    if (!body.ok) throw new Error(body.error || 'Failed');
    return body.result;
}

function toContent(result) {
    if (result && result.image) {
        return [{ type: 'image', data: result.image, mimeType: result.mime || 'image/jpeg' }, { type: 'text', text: result.note || '' }];
    }
    return [{ type: 'text', text: JSON.stringify(result, null, 2) }];
}

// ------------------------------------------------------------------ MCP over stdio (newline-delimited JSON-RPC)

function write(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
function reply(id, result) { write({ jsonrpc: '2.0', id, result }); }
function fail(id, code, message) { write({ jsonrpc: '2.0', id, error: { code, message } }); }

async function onMessage(msg) {
    const { id, method, params } = msg;
    const isRequest = id !== undefined && id !== null;
    try {
        switch (method) {
            case 'initialize':
                return reply(id, {
                    protocolVersion: (params && params.protocolVersion) || '2025-06-18',
                    capabilities: { tools: {} },
                    serverInfo: SERVER_INFO,
                    instructions: INSTRUCTIONS
                });
            case 'ping': return reply(id, {});
            case 'tools/list': return reply(id, { tools: TOOLS });
            case 'tools/call': {
                const name = params && params.name;
                if (!TOOLS.some(t => t.name === name)) return fail(id, -32602, 'Unknown tool ' + name);
                try {
                    return reply(id, { content: toContent(await callPlugin(name, (params && params.arguments) || {})) });
                } catch (e) {
                    return reply(id, { content: [{ type: 'text', text: String(e && e.message || e) }], isError: true });
                }
            }
            default:
                if (isRequest) return fail(id, -32601, 'Method not found: ' + method);
        }
    } catch (e) {
        if (isRequest) fail(id, -32603, String(e && e.message || e));
    }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch (e) { fail(null, -32700, 'Parse error'); continue; }
        if (Array.isArray(msg)) msg.forEach(onMessage); else onMessage(msg);
    }
});
process.stdin.on('end', () => process.exit(0));
