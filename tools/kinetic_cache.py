"""Shared by gen-kinetic-cloud.py and gen-kinetic-lines.py: the row layout, worked out once per set of inputs.

Fusion does not cache expression results: every read of an expression-driven input runs its Lua again, at full cost.
The Kinetic presets used to keep the word-wrap / row geometry in ONE expression (Template.Comments) and the natural
length in another (Template.AnimNatural, which itself read Comments). Every Row expression (6 per row) and every
follower input (evaluated once per LETTER, every frame) read those, so the word-wrap ran several hundred times per
frame (measured: ~1.1 ms per AnimNatural read).

cached(core, glob) returns a Lua prelude that keeps the result of `core` in a Lua global table keyed by every
Template input `core` reads. Expressions in a comp share Lua globals, so the word-wrap runs once per distinct input
set (and once per Lua state); afterwards a lookup costs a few plain input reads. The cache is cleared when it holds
256 entries (typing / slider drags create new keys). `core` is the body of a function(T) returning
{ cnt, c, acc, sz, cx, cy, nat }; the prelude leaves T, R and the locals c, acc, sz, cx, cy, cnt.
The global's name carries a hash of `core`, so a changed generator never reads an older layout."""
import hashlib
import re


def _key(core):
    ids = []
    for m in re.finditer(r'\bT\.(\w+)', core):
        if m.group(1) not in ids:
            ids.append(m.group(1))
    return ' .. "\\1" .. '.join('tostring(T.%s%s)' % (i, '.Value' if i == 'StyledText' else '') for i in ids)


def cache_name(core, glob):
    return '%s_%s' % (glob, hashlib.sha1(core.encode()).hexdigest()[:10])


def cached(core, glob):
    """The full prelude: looks the layout up and works it out (and stores it) on a miss. Only Template.Comments
    carries it: Fusion compiles an expression's text on every evaluation, so the long word-wrap code must not sit in
    the expressions that run per row and per letter."""
    name = cache_name(core, glob)
    return ('local T = Template\n'
            'local KEY = ' + _key(core) + '\n'
            'local CC = ' + name + '\n'
            'if not CC then CC = { n = 0, m = {} } ' + name + ' = CC end\n'
            'local R = CC.m[KEY]\n'
            'if not R then\n'
            'R = (function(T)\n' + core.rstrip('\n') + '\nend)(T)\n'
            'if CC.n >= 256 then CC.m = {} CC.n = 0 end\n'
            'CC.m[KEY] = R CC.n = CC.n + 1\n'
            'end\n'
            'local c, acc, sz, cx, cy, cnt = R.c, R.acc, R.sz, R.cx, R.cy, R.cnt\n')


def lookup(core, glob, nat):
    """The short prelude for every other expression: a cache lookup. On a miss it reads Template.Comments, whose
    expression (cached()) fills the cache; if this Lua state still has no entry (Fusion keeps several states), it parses
    the Comments text like the presets did before the cache. `nat` is the Lua expression of the natural length in terms
    of cnt and T (only used on that last path)."""
    name = cache_name(core, glob)
    return ('local T = Template\n'
            'local KEY = ' + _key(core) + '\n'
            'local CC = ' + name + '\n'
            'local R = CC and CC.m[KEY]\n'
            'if not R then\n'
            'local txt = tostring(T.Comments.Value or "")\n'
            'CC = ' + name + '\n'
            'R = CC and CC.m[KEY]\n'
            'if not R then\n'
            'local c, acc, sz, cx, cy = {}, {}, {}, {}, {}\n'
            'local first = true\n'
            'for ln in txt:gmatch("[^\\n]+") do\n'
            '  if first then first = false else\n'
            '    local a, s1, x1, y1, t = ln:match("^(%d)\\t([^\\t]*)\\t([^\\t]*)\\t([^\\t]*)\\t(.*)$")\n'
            '    if a then\n'
            '      local k = #c + 1\n'
            '      c[k] = t; acc[k] = a == "1"; sz[k] = tonumber(s1) or 0.01; cx[k] = tonumber(x1) or 0; cy[k] = tonumber(y1) or 0\n'
            '    end\n'
            '  end\n'
            'end\n'
            'local cnt = #c\n'
            'R = { cnt = cnt, c = c, acc = acc, sz = sz, cx = cx, cy = cy }\n'
            'R.nat = ' + nat + '\n'
            'end\n'
            'end\n'
            'local c, acc, sz, cx, cy, cnt = R.c, R.acc, R.sz, R.cx, R.cy, R.cnt\n')


# the Comments read-out (same text as before the cache: row count, then "accent<TAB>size<TAB>x<TAB>y<TAB>text")
COMMENTS = r'''local o = { tostring(cnt) }
for k = 1, cnt do
  o[#o + 1] = string.format("%d\t%.17g\t%.17g\t%.17g\t%s", acc[k] and 1 or 0, sz[k], cx[k], cy[k], c[k])
end
return table.concat(o, "\n")'''

# the rows' text and accent flag, as the Comments text used to hand them on
ROW_TABLES = r'''local rc, ra = {}, {}
for k = 1, cnt do
  local r = c[k]
  ra[k] = r:find("%*") and true or false
  rc[k] = (r:gsub("%*", ""):gsub("[\t\r\n]", " "))
end
'''
