"""Tests for the parts of the worker that need no GPU.

Run from runpod/h3-worker:   python -m unittest -v

The geometry is worth testing precisely because getting it wrong is expensive:
an illegal frame count or canvas is only rejected once the GPU is already
spun up and billing.
"""

import base64
import sys
import types
import unittest

# The handler imports the runpod SDK at module scope; stub it so these tests
# run anywhere, including a laptop with no CUDA.
if "runpod" not in sys.modules:
    stub = types.ModuleType("runpod")
    serverless = types.ModuleType("serverless")
    serverless.start = lambda *a, **k: None
    serverless.progress_update = lambda *a, **k: None
    stub.serverless = serverless
    sys.modules["runpod"] = stub
    sys.modules["runpod.serverless"] = serverless

from h3.geometry import (  # noqa: E402
    ASPECTS,
    CANVAS_MAX_PIXELS,
    CANVAS_MULTIPLE,
    MAX_FRAMES,
    MIN_FRAMES,
    canvas_for_aspect,
    canvas_for_resolution,
    frames_for_seconds,
    seconds_for_frames,
)


class FrameGrid(unittest.TestCase):
    def test_every_result_sits_on_the_grid(self):
        for tenths in range(0, 250):
            frames = frames_for_seconds(tenths / 10)
            self.assertEqual((frames - 5) % 17, 0, f"{tenths / 10}s -> {frames}")

    def test_clamped_to_the_trained_window(self):
        self.assertEqual(frames_for_seconds(0), MIN_FRAMES)
        self.assertEqual(frames_for_seconds(1), MIN_FRAMES)
        self.assertEqual(frames_for_seconds(999), MAX_FRAMES)

    def test_rounds_to_the_nearest_grid_point(self):
        # 6s is 144 frames, which sits between 141 (5.88s) and 158 (6.58s).
        self.assertEqual(frames_for_seconds(6), 141)
        self.assertEqual(frames_for_seconds(10), 243)

    def test_seconds_round_trip(self):
        self.assertAlmostEqual(seconds_for_frames(124), 5.17, places=2)
        self.assertAlmostEqual(seconds_for_frames(362), 15.08, places=2)

    def test_negative_and_garbage_do_not_escape_the_window(self):
        self.assertEqual(frames_for_seconds(-5), MIN_FRAMES)


class Canvas(unittest.TestCase):
    def test_legal_for_every_aspect(self):
        for aspect in list(ASPECTS) + ["nonsense"]:
            w, h = canvas_for_aspect(aspect)
            self.assertEqual(w % CANVAS_MULTIPLE, 0, aspect)
            self.assertEqual(h % CANVAS_MULTIPLE, 0, aspect)
            self.assertLessEqual(w * h, CANVAS_MAX_PIXELS, aspect)

    def test_widescreen_uses_the_full_budget(self):
        self.assertEqual(canvas_for_aspect("16:9"), (1344, 768))
        self.assertEqual(canvas_for_aspect("9:16"), (768, 1344))

    def test_aspect_survives_the_pixel_budget(self):
        # 21:9 at a 768 short edge overshoots; it must shrink proportionally
        # rather than collapsing into 16:9.
        w, h = canvas_for_aspect("21:9")
        self.assertNotEqual((w, h), canvas_for_aspect("16:9"))
        self.assertAlmostEqual(w / h, 21 / 9, delta=0.12)

    def test_draft_is_smaller_and_still_legal(self):
        full = canvas_for_aspect("16:9")
        draft = canvas_for_resolution("16:9", "draft")
        self.assertLess(draft[0] * draft[1], full[0] * full[1])
        self.assertEqual(draft[0] % CANVAS_MULTIPLE, 0)
        self.assertEqual(draft[1] % CANVAS_MULTIPLE, 0)


class DataUrls(unittest.TestCase):
    def setUp(self):
        import handler

        self.handler = handler

    def test_decodes_base64_payloads(self):
        raw = b"\x89PNG\r\n\x1a\n some bytes"
        url = "data:image/png;base64," + base64.b64encode(raw).decode()
        data, ext = self.handler._decode_data_url(url)
        self.assertEqual(data, raw)
        self.assertEqual(ext, ".png")

    def test_maps_known_mime_types(self):
        for mime, ext in [("image/jpeg", ".jpg"), ("video/mp4", ".mp4"), ("audio/wav", ".wav")]:
            url = f"data:{mime};base64,{base64.b64encode(b'x').decode()}"
            self.assertEqual(self.handler._decode_data_url(url)[1], ext)

    def test_rejects_anything_that_is_not_a_base64_data_url(self):
        for bad in ["", "https://example.com/a.png", "data:image/png,raw", "notaurl"]:
            with self.assertRaises(ValueError):
                self.handler._decode_data_url(bad)

    def test_rejects_corrupt_base64(self):
        with self.assertRaises(ValueError):
            self.handler._decode_data_url("data:image/png;base64,!!!not base64!!!")


class ComboOptions(unittest.TestCase):
    """ComfyUI has emitted combo widgets three different ways across versions.

    Getting this wrong cost a real failed render: KSamplerSelect reported
    "no selectable options" on a live worker because only the oldest shape
    was understood.
    """

    def setUp(self):
        from h3.comfy import _options_from

        self.parse = _options_from

    def test_classic_v1_list_of_choices(self):
        self.assertEqual(
            self.parse([["euler", "heun", "dpmpp_2m"], {"default": "euler"}]),
            ["euler", "heun", "dpmpp_2m"],
        )

    def test_typed_combo_with_options_dict(self):
        self.assertEqual(
            self.parse(["COMBO", {"options": ["euler", "res_multistep"]}]),
            ["euler", "res_multistep"],
        )

    def test_plain_dict_form(self):
        self.assertEqual(self.parse({"type": "COMBO", "options": ["simple", "beta"]}), ["simple", "beta"])

    def test_bare_list_of_strings(self):
        self.assertEqual(self.parse(["euler", "heun"]), ["euler", "heun"])

    def test_non_combo_sockets_yield_nothing(self):
        self.assertEqual(self.parse(["INT", {"default": 20}]), [])
        self.assertEqual(self.parse(None), [])
        self.assertEqual(self.parse([]), [])


if __name__ == "__main__":
    unittest.main()
