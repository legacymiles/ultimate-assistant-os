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


class DynamicCombo(unittest.TestCase):
    """SaveVideo's `format` is a dynamic combo, and a plain string is dropped
    before it reaches the node. Two renders died at the final node over this,
    after the model had already loaded, sampled and decoded.
    """

    def setUp(self):
        import h3.comfy as comfy

        self.comfy = comfy
        codec = ["COMFY_DYNAMICCOMBO_V3", {"options": [{"key": "auto"}, {"key": "h264"}, {"key": "av1"}]}]
        comfy._object_info = {
            "SaveVideo": {
                "input": {
                    "required": {
                        "video": ["VIDEO", {}],
                        "filename_prefix": ["STRING", {}],
                        "format": [
                            "COMFY_DYNAMICCOMBO_V3",
                            {
                                "options": [
                                    {"key": "auto", "inputs": {"required": {"codec": codec}}},
                                    {"key": "mp4", "inputs": {"required": {"codec": codec}}},
                                ]
                            },
                        ],
                    },
                    "optional": {"codec": codec},
                }
            }
        }

    def tearDown(self):
        self.comfy._object_info = None

    def test_detects_a_dynamic_combo(self):
        self.assertTrue(self.comfy.is_dynamic_combo("SaveVideo", "format"))
        self.assertFalse(self.comfy.is_dynamic_combo("SaveVideo", "filename_prefix"))

    def test_value_is_a_plain_key_not_a_dict(self):
        """_expand_schema_for_dynamic compares the value to option["key"].

        Anything but a bare string matches no option, so the socket never
        enters the finalized schema and the node is called without it.
        """
        got = self.comfy.dynamic_combo_inputs("SaveVideo", "format", ["auto", "mp4"])
        self.assertIsInstance(got["format"], str)
        self.assertEqual(got["format"], "auto")

    def test_nested_inputs_use_dotted_paths(self):
        # finalize_prefix joins parent and child with a dot.
        self.assertEqual(
            self.comfy.dynamic_combo_inputs("SaveVideo", "format", ["auto", "mp4"]),
            {"format": "auto", "format.codec": "auto"},
        )

    def test_honours_preference_order(self):
        self.assertEqual(
            self.comfy.dynamic_combo_inputs("SaveVideo", "format", ["mp4"])["format"], "mp4"
        )

    def test_falls_back_to_a_real_option(self):
        self.assertIn(
            self.comfy.dynamic_combo_inputs("SaveVideo", "format", ["nonsense"])["format"],
            ["auto", "mp4"],
        )


if __name__ == "__main__":
    unittest.main()
