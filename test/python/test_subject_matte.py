"""src/python/subject_matte.py, the parts that need no model: the edge colour fix, hole filling, the clean plate and
waiting for frames that are still being exported. Needs OpenCV + numpy, so it runs in the app's tracker venv
(`<userData>/tracker-venv/bin/python3 -B -m unittest discover -s test/python`) and is skipped elsewhere."""
import os
import sys
import tempfile
import threading
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src", "python"))

try:
    import cv2
    import numpy as np
    import subject_matte as M
except ImportError:  # no OpenCV in this Python
    M = None


@unittest.skipUnless(M is not None, "OpenCV / numpy not installed in this Python")
class SubjectMatteTest(unittest.TestCase):
    def test_decontaminate_matches_the_whole_frame_formula(self):
        rng = np.random.default_rng(1)
        img = rng.integers(0, 256, (60, 40, 3), dtype=np.uint8)
        fgr = rng.random((60, 40, 3), dtype=np.float32) * 1.2 - 0.1
        al = np.clip(rng.random((60, 40), dtype=np.float32) * 1.4 - 0.2, 0, 1)
        f8 = cv2.cvtColor((np.clip(fgr, 0, 1) * 255.0 + 0.5).astype(np.uint8), cv2.COLOR_RGB2BGR)
        wgt = (np.clip((1.0 - al) * 2.0, 0, 1) * (al > 0.35) * 0.6)[..., None]
        want = (img * (1.0 - wgt) + f8 * wgt + 0.5).astype(np.uint8)
        self.assertTrue((M.decontaminate(img, fgr, al) == want).all())

    def test_fill_holes_fills_inside_only(self):
        al = np.zeros((40, 40), np.float32)
        al[5:35, 5:35] = 1.0
        al[15:20, 15:20] = 0.2           # an eye: enclosed, becomes solid
        al[30:40, 18:22] = 0.0           # a gap open to the bottom edge: background
        out = M.fill_holes(al)
        self.assertEqual(out[17, 17], 1.0)
        self.assertEqual(out[38, 20], 0.0)
        self.assertEqual(out[0, 0], 0.0)

    def test_clean_plate_removes_the_subject_and_keeps_the_room(self):
        h, w = 320, 180
        room = np.zeros((h, w, 3), np.uint8)
        room[:] = (40, 120, 200)
        img = room.copy()
        al = np.zeros((h, w), np.float32)
        cv2.circle(img, (90, 150), 40, (10, 10, 10), -1)
        cv2.circle(al, (90, 150), 40, 1.0, -1)
        plate, small = M.clean_plate(img, al, None)
        self.assertEqual(plate.shape, img.shape)
        # the subject's middle is now room-coloured, the far corner untouched
        self.assertLess(np.abs(plate[150, 90].astype(int) - room[150, 90].astype(int)).max(), 12)
        self.assertTrue((plate[5, 5] == img[5, 5]).all())
        # a second frame blends with the first fill (no flicker)
        plate2, small2 = M.clean_plate(img, al, small)
        self.assertEqual(small2.shape, small.shape)

    def test_wait_for_reads_a_frame_once_the_next_one_lands(self):
        d = tempfile.mkdtemp()
        frames = [7, 8]
        cancel = os.path.join(d, "cancel")
        open(os.path.join(d, "f7.jpg"), "wb").close()

        def later():
            time.sleep(0.15)
            open(os.path.join(d, "f8.jpg"), "wb").close()
            time.sleep(0.1)
            open(os.path.join(d, "exported"), "wb").close()
        threading.Thread(target=later).start()
        t0 = time.time()
        self.assertTrue(M.wait_for(d, frames, 0, 5, cancel))
        self.assertGreater(time.time() - t0, 0.1)          # f7 alone may still be half written
        self.assertTrue(M.wait_for(d, frames, 1, 5, cancel))
        open(cancel, "wb").close()
        self.assertFalse(M.wait_for(d, [9], 0, 5, cancel))
        with self.assertRaises(RuntimeError):
            M.wait_for(d, [10], 0, 0.05, os.path.join(d, "none"))


if __name__ == "__main__":
    unittest.main()
