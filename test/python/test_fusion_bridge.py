"""The Fusion helper (src/python/fusion_bridge.py) without DaVinci Resolve: its request loop, retry rules, handle
caches and a few plain operations, against the fake Resolve module in fakes/.

Run:  python3 -m unittest discover -s test/python -v     (or: npm run test:py)"""

import json
import os
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
FAKES = os.path.join(HERE, "fakes")
BRIDGE_DIR = os.path.join(ROOT, "src", "python")
BRIDGE = os.path.join(BRIDGE_DIR, "fusion_bridge.py")

sys.dont_write_bytecode = True
sys.path.insert(0, FAKES)
sys.path.insert(0, BRIDGE_DIR)

import DaVinciResolveScript as dvr  # noqa: E402  (the fake)
import fusion_bridge as fb  # noqa: E402


def text_clip(uid="clip-1"):
    template = dvr.Tool("Template", "TextPlus", {"Size": 0.08, "Font": "Poppins"})
    glow = dvr.Tool("Glow1", "SoftGlow")
    comp = dvr.Comp([template, glow])
    return dvr.Item(uid, comps=[comp]), comp


class BridgeCase(unittest.TestCase):
    def setUp(self):
        self.use(None)

    def use(self, resolve):
        """Connects the helper to a fake Resolve and forgets everything it cached."""
        dvr.RESOLVE = resolve
        fb._resolve = None
        fb._items.clear()
        fb._comps.clear()
        fb.comp_attrs_forget()
        fb.req_cache_clear()

    def call(self, op, args=None, req_id=7):
        return fb.handle({"id": req_id, "op": op, "args": args or {}})


class RequestHandling(BridgeCase):
    def test_unknown_operation_is_answered_not_raised(self):
        self.assertEqual(self.call("no_such_op"), {"id": 7, "ok": False, "error": "Unknown operation"})

    def test_ping_reports_an_unreachable_resolve(self):
        out = self.call("ping")
        self.assertFalse(out["ok"])
        self.assertIn("Could not connect to DaVinci Resolve", out["error"])
        self.assertEqual(out["id"], 7)

    def test_ping_connects_once_and_keeps_the_connection(self):
        self.use(dvr.Resolve(dvr.Timeline([[]])))
        before = dvr.CALLS["scriptapp"]
        self.assertEqual(self.call("ping")["result"], True)
        self.assertEqual(self.call("ping")["result"], True)
        self.assertEqual(dvr.CALLS["scriptapp"] - before, 1)

    def test_every_answer_carries_timing_and_call_counters(self):
        item, _ = text_clip()
        self.use(dvr.Resolve(dvr.Timeline([[item]])))
        perf = self.call("tools", {"item": "clip-1"})["perf"]
        self.assertGreaterEqual(perf["ms"], 0)
        self.assertEqual(perf["counters"], {"toolLists": 1, "getAttrs": 2})

    def test_no_timeline_and_missing_clip_are_plain_errors(self):
        self.use(dvr.Resolve(project=None))
        self.assertEqual(self.call("tools", {"item": "clip-1"})["error"], "Open a timeline in Resolve")
        self.use(dvr.Resolve(dvr.Timeline([[]])))
        out = self.call("tools", {"item": "clip-1"})
        self.assertIn("not on the timeline any more", out["error"])
        self.assertIn("trace", out)

    def test_a_failed_operation_is_tried_once_more(self):
        seen = []

        def flaky(a):
            seen.append(1)
            if len(seen) == 1:
                raise RuntimeError("stale handle")
            return "second time"

        fb.OPS["_flaky"] = flaky
        try:
            self.assertEqual(self.call("_flaky")["result"], "second time")
            self.assertEqual(len(seen), 2)
        finally:
            fb.OPS.pop("_flaky")

    def test_renders_and_watchers_are_never_tried_twice(self):
        seen = []

        def fails(a):
            seen.append(1)
            raise RuntimeError("render failed")

        real = fb.OPS["capture"]
        fb.OPS["capture"] = fails
        try:
            self.assertEqual(self.call("capture")["error"], "render failed")
            self.assertEqual(len(seen), 1)
        finally:
            fb.OPS["capture"] = real
        self.assertTrue({"capture", "live_frame", "probe_render", "seg_watch", "seg_sweep", "ping"} <= fb.NO_RETRY)

    def test_no_second_attempt_after_a_wake_ran(self):
        seen = []

        def wakes_then_fails(a):
            seen.append(1)
            fb.WAKE_RAN[0] = True
            raise RuntimeError("after the wake")

        fb.OPS["_wake"] = wakes_then_fails
        try:
            self.assertFalse(self.call("_wake")["ok"])
            self.assertEqual(len(seen), 1)
        finally:
            fb.OPS.pop("_wake")

    def test_a_failure_forgets_only_the_handles_of_its_own_clip(self):
        fb._items["clip-1"] = object()
        fb._items["clip-2"] = object()
        fb._comps[("clip-1", "")] = object()

        def fails(a):
            raise RuntimeError("no")

        fb.OPS["_fails"] = fails
        try:
            self.call("_fails", {"item": "clip-1"})
        finally:
            fb.OPS.pop("_fails")
        self.assertEqual(list(fb._items), ["clip-2"])
        self.assertEqual(fb._comps, {})

    def test_cancelled_is_reported_as_cancelled(self):
        def cancelled(a):
            raise fb.Cancelled()

        fb.OPS["_cancel"] = cancelled
        try:
            self.assertEqual(self.call("_cancel")["error"], "cancelled")
        finally:
            fb.OPS.pop("_cancel")


class Operations(BridgeCase):
    def test_tools_lists_name_and_type_of_every_tool(self):
        item, _ = text_clip()
        self.use(dvr.Resolve(dvr.Timeline([[], [item]])))
        self.assertEqual(self.call("tools", {"item": "clip-1"})["result"],
                         {"tools": [["Template", "TextPlus"], ["Glow1", "SoftGlow"]]})

    def test_a_clip_found_once_is_not_searched_for_again(self):
        item, _ = text_clip()
        tl = dvr.Timeline([[], [item]])
        self.use(dvr.Resolve(tl))
        self.call("tools", {"item": "clip-1"})
        walked = tl.calls["GetItemListInTrack"]
        self.call("tools", {"item": "clip-1"})
        self.assertEqual(tl.calls["GetItemListInTrack"], walked)

    def test_tool_list_and_attributes_are_read_once_per_request(self):
        item, comp = text_clip()
        self.use(dvr.Resolve(dvr.Timeline([[item]])))
        got = fb.get_comp("clip-1")
        self.assertIs(got, comp)
        first = fb.tool_list(comp)
        second = fb.tool_list(comp)
        self.assertEqual(first, second)
        self.assertIsNot(first, second)
        self.assertEqual(comp.calls["GetToolList"], 1)
        fb.attrs(first[0])
        fb.attrs(first[0])
        self.assertEqual(first[0].calls["GetAttrs"], 1)
        fb.req_cache_clear()
        fb.comp_attrs_forget()
        fb.tool_list(comp)
        self.assertEqual(comp.calls["GetToolList"], 2)

    def test_config_only_takes_settings_it_knows(self):
        before = dict(fb.FIX)
        try:
            out = self.call("config", {"wakeLock": True, "notASetting": 1})["result"]
            self.assertTrue(out["wakeLock"])
            self.assertNotIn("notASetting", out)
            self.assertEqual(set(out), set(before))
        finally:
            fb.FIX.update(before)

    def test_every_operation_in_the_table_is_callable(self):
        self.assertGreaterEqual(len(fb.OPS), 40)
        for name, fn in fb.OPS.items():
            self.assertTrue(callable(fn), name)

    def test_small_helpers(self):
        self.assertEqual(fb.hex_to_rgb("#ff0000"), (1.0, 0.0, 0.0))
        self.assertEqual(fb.hex_to_rgb("0f0"), (0.0, 1.0, 0.0))
        self.assertEqual(fb.hex_to_rgb("nonsense"), (1.0, 1.0, 1.0))
        self.assertEqual(fb.hex_to_rgb(None), (1.0, 1.0, 1.0))
        self.assertEqual(fb.as_list(None), [])
        self.assertEqual(fb.as_list({1.0: "a", 2.0: "b"}), ["a", "b"])
        self.assertEqual(fb.as_list(("a",)), ["a"])


class Process(unittest.TestCase):
    """The helper as the panel starts it: one JSON request per line on stdin, one JSON answer per line on stdout."""

    def run_bridge(self, lines, with_fake=True):
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
        env["PYTHONPATH"] = FAKES if with_fake else ""
        flags = [] if with_fake else ["-S"]      # -S: no site-packages, so a real Resolve module is not found either
        for key in ("RESOLVE_SCRIPT_API", "RESOLVE_SCRIPT_LIB"):
            env.pop(key, None)
        p = subprocess.run([sys.executable] + flags + [BRIDGE], input="\n".join(lines) + "\n", env=env,
                           capture_output=True, text=True, timeout=60)
        return p.returncode, [json.loads(x) for x in p.stdout.splitlines() if x.strip()]

    def test_answers_each_request_and_skips_lines_that_are_not_requests(self):
        code, out = self.run_bridge(["", "not json", "[1, 2]", json.dumps({"id": 1, "op": "nope"}),
                                     json.dumps({"id": 2, "op": "ping"})])
        self.assertEqual(code, 0)
        self.assertEqual([o["id"] for o in out], [1, 2])
        self.assertEqual(out[0]["error"], "Unknown operation")
        self.assertFalse(out[1]["ok"])      # the fake module has no Resolve to hand out

    def test_says_so_and_exits_when_resolves_python_module_is_missing(self):
        code, out = self.run_bridge([json.dumps({"id": 1, "op": "ping"})], with_fake=False)
        self.assertEqual(code, 1)
        self.assertEqual(len(out), 1)
        self.assertIn("Cannot load Resolve's Python module", out[0]["error"])


if __name__ == "__main__":
    unittest.main()
