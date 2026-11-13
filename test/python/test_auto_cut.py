"""The Cut tab's analysis (src/python/auto_cut.py) on synthetic envelopes and words: no ffmpeg, no Resolve.

Run:  python3 -m unittest discover -s test/python -v     (skipped when this Python has no numpy)"""

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(HERE)), "src", "python"))
sys.dont_write_bytecode = True

import auto_cut as ac  # noqa: E402

np = ac.np


def env(spans, total, floor=-70.0, voice=-25.0):
    """A 10 ms dB envelope: `voice` inside the (a, b) second spans, `floor` elsewhere."""
    db = np.full(int(total * 100), floor, np.float32)
    for a, b in spans:
        db[int(a * 100):int(b * 100)] = voice
    return db


@unittest.skipIf(np is None, "numpy is not installed for this Python")
class PlanKeeps(unittest.TestCase):
    def setUp(self):
        self.p = dict(ac.DEFAULTS)

    def test_long_pause_is_shortened_and_short_one_kept(self):
        # speech 1.0-2.0, a 0.2 s breath gap (kept), 2.2-3.0, a 1.5 s pause (cut), 4.5-5.5; 7 s of audio
        pl = ac.plan_keeps(env([(1.0, 2.0), (2.2, 3.0), (4.5, 5.5)], 7.0), self.p, [], 7.0)
        kinds = [c["kind"] for c in pl["cuts"]]
        self.assertEqual(kinds, ["head", "pause", "tail"])
        self.assertEqual(len(pl["keeps"]), 2)
        (a0, b0), (a1, b1) = pl["keeps"]
        self.assertAlmostEqual(a0, 1.0 - self.p["headLead"], places=2)
        self.assertAlmostEqual(b0, 3.0 + self.p["pauseKeep"] * 0.6, places=2)
        self.assertAlmostEqual(a1, 4.5 - self.p["pauseKeep"] * 0.4, places=2)
        self.assertAlmostEqual(b1, 5.5 + self.p["tailKeep"], places=2)

    def test_click_inside_a_pause_does_not_split_it(self):
        db = env([(1.0, 2.0), (4.0, 5.0)], 6.0)
        db[300:303] = -25.0                      # a 30 ms click at 3.0 s
        pl = ac.plan_keeps(db, self.p, [], 6.0)
        self.assertEqual([c["kind"] for c in pl["cuts"]].count("pause"), 1)

    def test_breath_without_voice_is_not_speech(self):
        db = env([(1.0, 2.0), (4.0, 5.0)], 6.0)
        db[290:310] = -60.0                      # 0.2 s over the pause line but under the speech line
        pl = ac.plan_keeps(db, self.p, [], 6.0)
        self.assertEqual(len(pl["keeps"]), 2)

    def test_gap_inside_a_word_is_not_cut(self):
        words = [{"a": 0.9, "b": 3.3, "w": "desyat"}]
        pl = ac.plan_keeps(env([(1.0, 2.0), (2.6, 3.2)], 4.0), self.p, words, 4.0)
        self.assertEqual(len(pl["keeps"]), 1)

    def test_silent_clip(self):
        pl = ac.plan_keeps(env([], 3.0), self.p, [], 3.0)
        self.assertEqual(pl["keeps"], [])


@unittest.skipIf(np is None, "numpy is not installed for this Python")
class Text(unittest.TestCase):
    def words(self, text, start=0.0, step=0.3, gap_after=None):
        out, t = [], start
        for i, w in enumerate(text.split()):
            out.append({"a": t, "b": t + step - 0.05, "w": w})
            t += step + (gap_after.get(i, 0) if gap_after else 0)
        return out

    def test_retake_keeps_the_last_attempt(self):
        ws = self.words("So the thing is we So the thing is we never planned it.", gap_after={4: 0.8})
        P = ac.phrases_of({"1": ws}, ["1"], 0.45)
        drops = ac.find_retakes(P, ac.DEFAULTS)
        self.assertEqual(len(drops), 1)
        self.assertEqual(drops[0]["text"], "So the thing is we")
        self.assertLess(drops[0]["b"], ws[5]["a"])          # the kept attempt starts after the cut

    def test_retake_takes_the_talk_between_takes_too(self):
        ws = self.words("I started it because I care. Oh wait, no, okay. I started it because I care about you.", gap_after={5: 0.8, 9: 0.8})
        P = ac.phrases_of({"1": ws}, ["1"], 0.45)
        d = ac.find_retakes(P, ac.DEFAULTS)
        self.assertEqual(len(d), 1)
        self.assertIn("Oh wait", d[0]["text"])
        self.assertAlmostEqual(d[0]["b"], ws[10]["a"] - 0.07, places=3)

    def test_retake_span_never_swallows_another_line(self):
        ws = self.words("We have helped over 800 people. Nah, wait. I started it all. We have helped over 600 people get there.",
                        gap_after={5: 0.8, 7: 0.8, 11: 0.8})
        P = ac.phrases_of({"1": ws}, ["1"], 0.45)
        d = [x for x in ac.find_retakes(P, ac.DEFAULTS) if x["text"].startswith("We have helped over 800")]
        self.assertEqual(len(d), 1)
        self.assertLess(d[0]["b"], ws[8]["a"])          # "I started it all." stays

    def test_outtakes(self):
        for t in ["Wait, sorry.", "Okay, I go again.", "Let's go again.", "Okay."]:
            self.assertTrue(ac.is_outtake([ac.norm(w) for w in t.split()]), t)
        for t in ["We handle all the paperwork.", "I started SIC because I believe in foreign talent."]:
            self.assertFalse(ac.is_outtake([ac.norm(w) for w in t.split()]), t)

    def test_script_keeps_the_last_complete_take(self):
        ws = self.words("Hi I am Al. I sell bread every. Wait sorry. I sell bread every day. Bye now.",
                        gap_after={3: 0.6, 7: 0.8, 9: 0.8, 14: 0.6})
        lines = ac.script_lines("Hi, I am Al. I sell bread every day. Bye now.")
        drops, warn = ac.script_takes({"1": ws}, ["1"], lines, ac.DEFAULTS)
        self.assertEqual(warn, [])
        self.assertEqual(len(drops), 1)
        self.assertTrue(drops[0]["text"].startswith("I sell bread every."))
        self.assertLess(drops[0]["b"], ws[10]["a"])          # the kept take keeps its first word

    def test_different_lines_are_not_retakes(self):
        ws = self.words("We grew up in Penang. My grandfather sold bread there.", gap_after={4: 0.8})
        self.assertEqual(ac.find_retakes(ac.phrases_of({"1": ws}, ["1"], 0.45), ac.DEFAULTS), [])

    def test_stutter_and_filler(self):
        ws = self.words("I think I think um we should go")
        st = ac.find_stutters(ws, "1")
        self.assertEqual([d["text"] for d in st], ["I think"])
        fl = ac.find_fillers(ws, "1")
        self.assertEqual([d["text"] for d in fl], ["um"])

    def test_subtract_and_snap(self):
        keeps = ac.subtract([[0.0, 4.0]], [{"a": 1.0, "b": 2.0}])
        self.assertEqual(keeps, [[0.0, 1.0], [2.0, 4.0]])
        self.assertEqual(ac.snap(keeps, 25, 4.0, 0.2), [[0, 25], [50, 100]])


@unittest.skipIf(np is None, "numpy is not installed for this Python")
class QuietSounds(unittest.TestCase):
    def test_murmur_far_under_the_voice_is_not_speech(self):
        # a gated mic: floor -80, voice -25, an off-mic murmur at -48 between two lines
        db = env([(1.0, 4.0), (8.0, 11.0)], 13.0, floor=-80.0)
        db[550:620] = -48.0
        pl = ac.plan_keeps(db, dict(ac.DEFAULTS), [], 13.0)
        self.assertEqual([[round(a), round(b)] for a, b in pl["speech"]], [[1, 4], [8, 11]])

    def test_pieces_without_words_go(self):
        words = [{"a": 1.0, "b": 2.0, "w": "Hello"}, {"a": 5.0, "b": 5.4, "w": "Yeah."}, {"a": 8.0, "b": 9.0, "w": "there"}]
        drops = [{"a": 4.95, "b": 5.48}]
        keeps = [[0.9, 2.2], [3.0, 3.4], [4.6, 4.95], [5.48, 5.8], [7.9, 9.2]]
        stay, gone = ac.drop_wordless(keeps, words, drops)
        self.assertEqual(stay, [[0.9, 2.2], [7.9, 9.2]])
        self.assertEqual(gone, [[3.0, 3.4], [4.6, 4.95], [5.48, 5.8]])


if __name__ == "__main__":
    unittest.main()
