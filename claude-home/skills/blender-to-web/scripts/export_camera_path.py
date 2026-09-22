"""Sample an authored Blender camera move into a Y-up JSON track for a scroll-driven Three.js camera.

    blender -b world.blend --python export_camera_path.py -- --out site/assets/camera.json
    blender -b world.blend --python export_camera_path.py -- --camera ShotCam --step 1 \
        --bake-action --glb site/assets/camera.glb

Output (all positions/quaternions already converted to three.js Y-up, glTF convention):
{
  "version": 1, "fps": 24, "frameStart": 1, "frameEnd": 480, "step": 1,
  "aspect": 1.7778, "fovConstant": true, "near": 0.1, "far": 200,
  "frames":  [{"f": 1, "p": [x, y, z], "q": [x, y, z, w], "fov": 38.2, "hfov": 63.1}, ...],
             # always starts at frameStart and ends at frameEnd (the end frame is appended when
             # the step does not land on it), so map scroll t -> frame, never t -> array index
  "markers": [{"name": "intro", "frame": 1, "t": 0.0}, ...]     # timeline markers -> sections
}
fov/hfov are VERTICAL/HORIZONTAL degrees for the authored render aspect (three uses vertical fov).

Why sample instead of relying on glTF only: Follow Path / Track To constraints, drivers and
parenting are evaluated by frame_set(), so matrix_world is exactly what Blender renders. Animated
focal length does not survive glTF (it needs KHR_animation_pointer), but it does survive here.

--bake-action also bakes visual keys onto the camera (nla.bake, constraints cleared) and --glb
exports just that camera as an animated glTF, if you prefer AnimationMixer in the browser.
Run it on a copy: --bake-action modifies the scene (the source .blend is never saved by this script).
"""

import argparse
import json
import math
import os
import sys

try:
    import bpy
    from mathutils import Matrix
except ImportError:  # py_compile / plain Python
    bpy = None
    Matrix = None


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser(description="Export a Blender camera move to Y-up JSON")
    p.add_argument("--camera", default="", help="camera object name (default scene.camera)")
    p.add_argument("--out", default="camera.json")
    p.add_argument("--start", type=int, default=None)
    p.add_argument("--end", type=int, default=None)
    p.add_argument("--step", type=int, default=1, help="sample every N frames (1-2 is plenty)")
    p.add_argument("--bake-action", action="store_true", help="bake visual keys onto the camera")
    p.add_argument("--glb", default="", help="also export the camera alone as an animated .glb")
    return p.parse_args(argv)


def fovs(cam_data, render):
    """Vertical and horizontal FOV in degrees, honouring sensor_fit like Blender's renderer."""
    ax = render.resolution_x * render.pixel_aspect_x
    ay = render.resolution_y * render.pixel_aspect_y
    aspect = ax / ay
    if cam_data.type == "ORTHO":
        return None, None, aspect
    lens = cam_data.lens
    fit = cam_data.sensor_fit
    if fit == "VERTICAL":
        sensor_v = cam_data.sensor_height
        sensor_h = sensor_v * aspect
    elif fit == "HORIZONTAL" or (fit == "AUTO" and aspect >= 1.0):
        sensor_h = cam_data.sensor_width
        sensor_v = sensor_h / aspect
    else:  # AUTO on a portrait render: the sensor width maps to the vertical side
        sensor_v = cam_data.sensor_width
        sensor_h = sensor_v * aspect
    vfov = math.degrees(2.0 * math.atan(sensor_v / (2.0 * lens)))
    hfov = math.degrees(2.0 * math.atan(sensor_h / (2.0 * lens)))
    return vfov, hfov, aspect


def bake_visual(cam, start, end, step):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    cam.select_set(True)
    bpy.context.view_layer.objects.active = cam
    kwargs = {"frame_start": start, "frame_end": end, "step": step, "only_selected": True,
              "visual_keying": True, "clear_constraints": True, "clear_parents": True,
              "use_current_action": False, "bake_types": {"OBJECT"}}
    props = bpy.ops.nla.bake.get_rna_type().properties.keys()
    bpy.ops.nla.bake(**{k: v for k, v in kwargs.items() if k in props})
    print("[camera] baked visual keys onto", cam.name)


def export_glb(cam, path):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    cam.select_set(True)
    kwargs = {"filepath": os.path.abspath(path), "export_format": "GLB", "use_selection": True,
              "export_cameras": True, "export_animations": True, "export_force_sampling": True,
              "export_yup": True, "export_apply": False}
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    bpy.ops.export_scene.gltf(**{k: v for k, v in kwargs.items() if k in props})
    print("[camera] exported", path)


def main():
    if bpy is None:
        raise SystemExit("Run inside Blender: blender -b file.blend --python export_camera_path.py -- ...")
    args = parse_args()
    scene = bpy.context.scene
    cam = bpy.data.objects.get(args.camera) if args.camera else scene.camera
    if cam is None or cam.type != "CAMERA":
        raise SystemExit(f"[camera] no camera found (got {cam!r}); pass --camera NAME")

    start = scene.frame_start if args.start is None else args.start
    end = scene.frame_end if args.end is None else args.end
    step = max(1, args.step)
    fps = scene.render.fps / scene.render.fps_base

    if args.bake_action:
        bake_visual(cam, start, end, step)

    # Blender Z-up -> glTF/three Y-up: (x, y, z) -> (x, z, -y). Cameras look down local -Z with +Y
    # up in BOTH apps, so the conversion is a pure left-multiply (no local correction needed).
    to_y_up = Matrix.Rotation(-math.pi / 2.0, 4, "X")

    if end <= start:
        raise SystemExit(f"[camera] frame range {start}..{end} is empty")
    sample_frames = list(range(start, end + 1, step))
    if sample_frames[-1] != end:  # always land on the last frame, whatever the step
        sample_frames.append(end)

    frames, fov_values = [], []
    for f in sample_frames:
        scene.frame_set(f)
        m = to_y_up @ cam.matrix_world
        loc, rot, _scale = m.decompose()
        vfov, hfov, aspect = fovs(cam.data, scene.render)
        row = {"f": f, "p": [round(v, 5) for v in loc],
               "q": [round(rot.x, 6), round(rot.y, 6), round(rot.z, 6), round(rot.w, 6)]}
        if vfov is not None:
            row["fov"] = round(vfov, 4)
            row["hfov"] = round(hfov, 4)
            fov_values.append(vfov)
        else:
            row["orthoScale"] = round(cam.data.ortho_scale, 5)
        frames.append(row)

    # keep quaternions in one hemisphere so slerp between neighbours never takes the long way
    for a, b in zip(frames, frames[1:]):
        if sum(x * y for x, y in zip(a["q"], b["q"])) < 0:
            b["q"] = [-v for v in b["q"]]

    span = max(1, end - start)
    markers = sorted(
        ({"name": mk.name, "frame": mk.frame, "t": round((mk.frame - start) / span, 5)}
         for mk in scene.timeline_markers if start <= mk.frame <= end),
        key=lambda m: m["frame"])

    cd = cam.data
    if abs(cd.shift_x) > 1e-6 or abs(cd.shift_y) > 1e-6:
        print("[camera] WARNING lens shift", cd.shift_x, cd.shift_y,
              "-> reproduce with camera.setViewOffset() or remove it before export")
    const = bool(fov_values) and (max(fov_values) - min(fov_values)) < 0.01
    out = {
        "version": 1, "camera": cam.name, "fps": round(fps, 4), "frameStart": start,
        "frameEnd": end, "step": step, "aspect": round(fovs(cd, scene.render)[2], 5),
        "type": cd.type, "fovConstant": const, "near": round(cd.clip_start, 5),
        "far": round(cd.clip_end, 5), "frames": frames, "markers": markers,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print(f"[camera] {len(frames)} samples, {len(markers)} markers, fovConstant={const} -> {args.out}")
    if not const and args.glb:
        print("[camera] NOTE focal length is animated: the GLB will only carry the first fov; use the JSON")

    if args.glb:
        if not args.bake_action:
            print("[camera] NOTE constraints/paths may not export; add --bake-action for a clean track")
        export_glb(cam, args.glb)


if __name__ == "__main__":
    main()
