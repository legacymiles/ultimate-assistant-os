"""studio_lib — Blender helpers for the animation-director skill.

Import from a script run with `blender -b [file.blend] -P script.py -- args`:

    import sys
    sys.path.insert(0, r"<skill>/scripts")
    import studio_lib as S

Written for Blender 4.2 LTS through 5.x. Version differences (EEVEE engine id, video media_type,
sequencer strips collection, slotted actions) are handled here so job scripts stay short.
"""

from __future__ import annotations

import glob
import json
import math
import os
import random
from dataclasses import dataclass, field

import bpy
from mathutils import Vector

# --------------------------------------------------------------------------------------------
# job + scene basics
# --------------------------------------------------------------------------------------------

ASPECT_SIZE = {"16:9": (1280, 720), "9:16": (720, 1280), "1:1": (1080, 1080)}


def load_job(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_status(job_dir: str, stage: str, note: str) -> None:
    os.makedirs(os.path.join(job_dir, "studio"), exist_ok=True)
    with open(os.path.join(job_dir, "studio", "status.json"), "w", encoding="utf-8") as f:
        json.dump({"stage": stage, "note": note}, f)


def reset_scene() -> bpy.types.Scene:
    """Empty file, keeping user preferences (never factory settings: that can drop FFmpeg)."""
    bpy.ops.wm.read_homefile(use_empty=True)
    return bpy.context.scene


def hex_rgba(h: str, alpha: float = 1.0):
    h = h.lstrip("#")
    srgb = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return (*lin, alpha)


def setup_render(aspect: str = "16:9", fps: int = 24, engine: str = "EEVEE", quality: str = "final") -> None:
    scene = bpy.context.scene
    w, h = ASPECT_SIZE.get(aspect, (1280, 720))
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.resolution_percentage = 50 if quality == "draft" else 100
    scene.render.fps = fps
    if engine.upper() == "CYCLES":
        scene.render.engine = "CYCLES"
        scene.cycles.samples = 24 if quality == "draft" else 64
        scene.cycles.use_denoising = True
        enable_gpu()
    else:
        for eid in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
            try:
                scene.render.engine = eid
                break
            except TypeError:
                continue
        try:
            scene.eevee.taa_render_samples = 16 if quality == "draft" else 48
        except AttributeError:
            pass
    try:
        scene.view_settings.view_transform = "AgX"
    except TypeError:
        scene.view_settings.view_transform = "Filmic"


def enable_gpu() -> str | None:
    prefs = bpy.context.preferences.addons.get("cycles")
    if not prefs:
        return None
    cprefs = prefs.preferences
    for backend in ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL"):
        try:
            cprefs.compute_device_type = backend
            cprefs.get_devices()
            if any(d.type == backend for d in cprefs.devices):
                for d in cprefs.devices:
                    d.use = True
                bpy.context.scene.cycles.device = "GPU"
                return backend
        except TypeError:
            continue
    return None


def frame_range(duration_sec: float, fps: int = 24) -> int:
    frames = max(1, round(duration_sec * fps))
    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = 1, frames
    return frames


# --------------------------------------------------------------------------------------------
# sets
# --------------------------------------------------------------------------------------------


def world(sky_hex: str, strength: float = 1.0) -> None:
    w = bpy.context.scene.world or bpy.data.worlds.new("World")
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = hex_rgba(sky_hex)
    bg.inputs["Strength"].default_value = strength


_materials: dict = {}


def material(hex_color: str, style: str = "stylized-3d", emission: float = 0.0) -> bpy.types.Material:
    key = (hex_color, style, emission)
    if key in _materials:
        return _materials[key]
    mat = bpy.data.materials.new(f"{style}-{hex_color}")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = hex_rgba(hex_color)
    bsdf.inputs["Roughness"].default_value = {"claymation": 1.0, "low-poly": 0.9, "cinematic": 0.6}.get(style, 0.5)
    if emission:
        bsdf.inputs["Emission Color"].default_value = hex_rgba(hex_color)
        bsdf.inputs["Emission Strength"].default_value = emission
    if style in ("claymation", "paper-craft"):
        noise = nt.nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 40.0 if style == "claymation" else 90.0
        bump = nt.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.15 if style == "claymation" else 0.05
        nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
        nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    if style == "anime-toon":
        out = nt.nodes.get("Material Output")
        to_rgb = nt.nodes.new("ShaderNodeShaderToRGB")
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.interpolation = "CONSTANT"
        ramp.color_ramp.elements[0].position = 0.0
        ramp.color_ramp.elements[0].color = tuple(c * 0.55 for c in hex_rgba(hex_color)[:3]) + (1,)
        ramp.color_ramp.elements[1].position = 0.35
        ramp.color_ramp.elements[1].color = hex_rgba(hex_color)
        emit = nt.nodes.new("ShaderNodeEmission")
        nt.links.new(bsdf.outputs["BSDF"], to_rgb.inputs["Shader"])
        nt.links.new(to_rgb.outputs["Color"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], emit.inputs["Color"])
        nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    _materials[key] = mat
    return mat


def _prim(kind: str, name: str, location, scale=(1, 1, 1), color="#cccccc", style="stylized-3d", **kw) -> bpy.types.Object:
    op = {
        "cube": bpy.ops.mesh.primitive_cube_add,
        "cylinder": bpy.ops.mesh.primitive_cylinder_add,
        "cone": bpy.ops.mesh.primitive_cone_add,
        "sphere": bpy.ops.mesh.primitive_uv_sphere_add,
        "ico": bpy.ops.mesh.primitive_ico_sphere_add,
        "plane": bpy.ops.mesh.primitive_plane_add,
        "torus": bpy.ops.mesh.primitive_torus_add,
    }[kind]
    op(location=location, **kw)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(material(color, style))
    if style == "low-poly":
        bpy.ops.object.shade_flat()
    else:
        bpy.ops.object.shade_smooth()
    return obj


def ground(hex_color: str, style: str = "stylized-3d", size: float = 160) -> bpy.types.Object:
    return _prim("plane", "Ground", (0, 0, 0), (size / 2, size / 2, 1), hex_color, style)


def sun(time_of_day: str = "day") -> bpy.types.Object:
    data = bpy.data.lights.new("Sun", "SUN")
    data.energy = {"day": 4.0, "golden": 3.5, "night": 0.6}.get(time_of_day, 4.0)
    data.color = {"day": (1, 1, 1), "golden": (1.0, 0.72, 0.45), "night": (0.62, 0.7, 1.0)}.get(time_of_day, (1, 1, 1))
    data.angle = math.radians(3)
    obj = bpy.data.objects.new("Sun", data)
    bpy.context.collection.objects.link(obj)
    elev = {"day": 55, "golden": 12, "night": 40}.get(time_of_day, 55)
    obj.rotation_euler = (math.radians(90 - elev), 0, math.radians(35))
    if time_of_day == "night":
        fill = bpy.data.lights.new("Warm", "POINT")
        fill.energy = 400
        fill.color = (1.0, 0.8, 0.55)
        f = bpy.data.objects.new("Warm", fill)
        f.location = (2, -3, 3)
        bpy.context.collection.objects.link(f)
    return obj


def _spot(rng: random.Random, depth: float = 1.0):
    x = (rng.random() - 0.5) * 26 * depth
    y = 3 + rng.random() * 14 * depth  # +Y is "behind the stage" (camera looks toward +Y)
    if abs(x) < 3.5 and y < 5:
        x += 4 if x >= 0 else -4
    return x, y


def dress_set(props: list[str], style: str = "stylized-3d", seed: int = 7) -> None:
    """Primitive set dressing from the plan's prop keywords. Replace with real assets when available."""
    rng = random.Random(seed)
    for p in [s.lower() for s in (props or ["shapes"])]:
        if "tree" in p or "pine" in p or "forest" in p:
            for i in range(12):
                x, y = _spot(rng)
                s = 0.8 + rng.random() * 0.8
                _prim("cylinder", f"Trunk{i}", (x, y, 0.7 * s), (0.2 * s, 0.2 * s, 0.7 * s), "#7a4e2d", style, vertices=8)
                _prim("cone", f"Crown{i}", (x, y, 2.3 * s), (1.0 * s, 1.0 * s, 1.2 * s), "#2f6b3f" if "pine" in p else "#4f9d5a", style, vertices=8 if style == "low-poly" else 24)
        elif "building" in p or "tower" in p or "city" in p:
            tones = ["#8093a8", "#a3b1c2", "#6c7a8c", "#c2b8a3"]
            for i in range(16):
                hgt = 3 + rng.random() * 9
                x = -16 + (i % 8) * 4.6
                y = 9 + rng.random() * 2 if i < 8 else 16 + rng.random() * 3
                _prim("cube", f"Building{i}", (x, y, hgt / 2), (1.0 + rng.random() * 0.7, 1.0 + rng.random() * 0.7, hgt / 2), tones[i % 4], style)
        elif "rock" in p:
            for i in range(12):
                x, y = _spot(rng)
                _prim("ico", f"Rock{i}", (x, y, 0.2), (0.4 + rng.random(),) * 3, "#8b8680", style, subdivisions=1)
        elif "mountain" in p:
            for i in range(6):
                hgt = 12 + rng.random() * 12
                _prim("cone", f"Mountain{i}", (-40 + i * 16, 45 + rng.random() * 10, hgt / 2), (10, 10, hgt / 2), "#8391a6", style, vertices=6 if style == "low-poly" else 32)
        elif "lamp" in p:
            for i in range(4):
                _prim("cylinder", f"Pole{i}", (-6 + i * 4, 4, 1.3), (0.05, 0.05, 1.3), "#374151", style)
                bulb = _prim("sphere", f"Bulb{i}", (-6 + i * 4, 4, 2.7), (0.18,) * 3, "#fff3b0", style)
                bulb.data.materials[0] = material("#ffd166", style, emission=6.0)
        elif "water" in p or "sea" in p:
            _prim("plane", "Water", (0, 36, 0.03), (60, 30, 1), "#2f9bd6", style)
        elif "desk" in p or "bench" in p or "counter" in p or "table" in p:
            for i in range(5):
                _prim("cube", f"Desk{i}", (-6 + i * 3, 4.5 + (i % 2) * 2, 0.5), (1.1, 0.45, 0.5), "#a0704a", style)
        elif "star" in p:
            world_obj = bpy.context.scene.world
            if world_obj and world_obj.use_nodes:
                nt = world_obj.node_tree
                noise = nt.nodes.new("ShaderNodeTexNoise")
                noise.inputs["Scale"].default_value = 800
                ramp = nt.nodes.new("ShaderNodeValToRGB")
                ramp.color_ramp.elements[0].position = 0.72
                ramp.color_ramp.elements[1].position = 0.74
                mix = nt.nodes.new("ShaderNodeMix")
                mix.data_type = "RGBA"
                mix.blend_type = "ADD"
                bg = nt.nodes.get("Background")
                mix.inputs[6].default_value = bg.inputs["Color"].default_value
                nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
                nt.links.new(ramp.outputs["Color"], mix.inputs[7])
                nt.links.new(mix.outputs[2], bg.inputs["Color"])
        elif "platform" in p or "stage" in p:
            _prim("cylinder", "Platform", (0, 0, 0.06), (3.5, 3.5, 0.06), "#e5e7eb", style, vertices=48)
        else:
            for i in range(6):
                x, y = _spot(rng, 0.8)
                _prim("torus" if i % 2 else "ico", f"Shape{i}", (x, y, 1.5 + rng.random() * 3), (0.7,) * 3, "#ffffff", style)


# --------------------------------------------------------------------------------------------
# characters
# --------------------------------------------------------------------------------------------


@dataclass
class StandIn:
    root: bpy.types.Object
    pivots: dict = field(default_factory=dict)
    kind: str = "humanoid"


def _empty(name: str, parent=None, location=(0, 0, 0)) -> bpy.types.Object:
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.1
    bpy.context.collection.objects.link(e)
    e.parent = parent
    e.location = location
    return e


def _part(kind, name, parent, location, scale, color, style="stylized-3d"):
    obj = _prim(kind, name, (0, 0, 0), scale, color, style)
    obj.parent = parent
    obj.location = location
    return obj


def stand_in_character(name: str, colors: dict, kind: str = "humanoid", style: str = "stylized-3d") -> StandIn:
    """A primitive rig with named pivots, for when no Mixamo character is available. Faces -Y (toward the camera)."""
    body, accent = colors.get("body", "#f97316"), colors.get("accent", "#1e293b")
    root = _empty(f"{name}_root")
    rig = StandIn(root=root, kind=kind)
    if kind == "humanoid":
        hips = _empty(f"{name}_hips", root, (0, 0, 0.95))
        _part("sphere", f"{name}_torso", hips, (0, 0, 0.42), (0.32, 0.26, 0.45), body, style)
        head = _empty(f"{name}_head", hips, (0, 0, 1.1))
        _part("sphere", f"{name}_skull", head, (0, 0, 0), (0.3, 0.3, 0.3), "#f3e5d8", style)
        for side, x in (("L", 0.44), ("R", -0.44)):
            arm = _empty(f"{name}_arm_{side}", hips, (x, 0, 0.72))
            _part("cylinder", f"{name}_armmesh_{side}", arm, (0, 0, -0.3), (0.08, 0.08, 0.3), body, style)
            rig.pivots[f"arm_{side}"] = arm
        for side, x in (("L", 0.16), ("R", -0.16)):
            leg = _empty(f"{name}_leg_{side}", root, (x, 0, 0.95))
            _part("cylinder", f"{name}_legmesh_{side}", leg, (0, 0, -0.45), (0.1, 0.1, 0.45), accent, style)
            rig.pivots[f"leg_{side}"] = leg
        rig.pivots.update(hips=hips, head=head)
    elif kind == "creature":
        hips = _empty(f"{name}_hips", root, (0, 0, 0.85))
        _part("sphere", f"{name}_body", hips, (0, 0, 0), (0.8, 0.35, 0.35), body, style)
        head = _empty(f"{name}_head", hips, (0.85, 0, 0.3))
        _part("sphere", f"{name}_skull", head, (0, 0, 0), (0.28,) * 3, body, style)
        for i, (x, y) in enumerate(((0.45, 0.2), (0.45, -0.2), (-0.45, 0.2), (-0.45, -0.2))):
            leg = _empty(f"{name}_leg_{i}", hips, (x, y, -0.15))
            _part("cylinder", f"{name}_legmesh_{i}", leg, (0, 0, -0.33), (0.08, 0.08, 0.33), body, style)
            rig.pivots[f"leg_{i}"] = leg
        rig.pivots.update(hips=hips, head=head)
    else:
        hips = _empty(f"{name}_hips", root, (0, 0, 0))
        _part("cube", f"{name}_body", hips, (0, 0, 0.5), (0.5, 0.5, 0.5), body, style)
        rig.pivots["hips"] = hips
    return rig


def ballistic_height(p: float, peak: float) -> float:
    """Height on a symmetric parabola at progress p in [0, 1]."""
    return 4 * peak * p * (1 - p)


def _key(obj, path, frame, value, index=-1):
    if path == "location":
        obj.location = value
    elif path == "rotation_euler":
        obj.rotation_euler = value
    elif path == "scale":
        obj.scale = value
    obj.keyframe_insert(data_path=path, frame=frame, index=index)


def key_motion(rig: StandIn, motion: str, start: int, end: int, fps: int = 24) -> None:
    """Procedural motion on a stand-in rig. Stunts use physics-plausible arcs (the Cascadeur fallback)."""
    pv = rig.pivots
    step = max(1, fps // 8)
    n = max(1, end - start)
    for f in range(start, end + 1, step):
        t = (f - start) / fps
        p = (f - start) / n
        s = math.sin
        hips, head = pv.get("hips"), pv.get("head")
        base_hips_z = 0.95 if rig.kind == "humanoid" else 0.85 if rig.kind == "creature" else 0.0
        hz, hrot = base_hips_z, (0.0, 0.0, 0.0)
        arms = {"L": (0.0, 0.0, 0.0), "R": (0.0, 0.0, 0.0)}
        legs = {"L": (0.0, 0.0, 0.0), "R": (0.0, 0.0, 0.0)}
        if motion in ("walk", "run", "chase", "move", "custom"):
            speed, amp = (12, 0.95) if motion in ("run", "chase") else (7, 0.55)
            legs = {"L": (s(t * speed) * amp, 0, 0), "R": (-s(t * speed) * amp, 0, 0)}
            arms = {"L": (-s(t * speed) * amp * 0.8, 0, 0), "R": (s(t * speed) * amp * 0.8, 0, 0)}
            hz += abs(s(t * speed)) * 0.05
        elif motion in ("jump",):
            hz += ballistic_height((t % 1.0), 1.0)
        elif motion == "flip":
            cyc = (t % 1.6) / 1.6
            air = min(1, max(0, (cyc - 0.15) / 0.7))
            hz += ballistic_height(air, 1.4)
            hrot = (-air * 2 * math.pi, 0, 0)
        elif motion == "fall":
            k = min(1.0, p * 1.6)
            k = k * k * (3 - 2 * k)
            hrot = (-k * 1.45, 0, 0)
            hz = base_hips_z * (1 - 0.7 * k)
        elif motion in ("dance", "cheer"):
            hz += abs(s(t * 6)) * (0.12 if motion == "dance" else 0.25)
            hrot = (0, 0, s(t * 3) * 0.5 if motion == "dance" else 0)
            arms = {"L": (0, -2.2 - s(t * 6) * 0.5, 0), "R": (0, 2.2 + s(t * 6) * 0.5, 0)}
        elif motion == "wave":
            arms["R"] = (0, 2.6 + s(t * 8) * 0.35, 0)
        elif motion == "talk":
            arms["R"] = (-0.6 + s(t * 2.4) * 0.35, 0.2, 0)
        elif motion == "fight":
            jab = (t * 3.5) % 2
            arms = {"L": (-1.55 * s(min(1, jab) * math.pi) if jab < 1 else -0.5, 0, 0), "R": (-1.55 * s(min(1, jab - 1) * math.pi) if jab >= 1 else -0.5, 0, 0)}
        elif motion == "climb":
            hz += p * 1.6
            arms = {"L": (0, -2.8 + s(t * 4) * 0.3, 0), "R": (0, 2.8 + s(t * 4) * 0.3, 0)}
        elif motion == "throw":
            k = (t * 1.2) % 1
            arms["R"] = ((1.2 * k / 0.6) if k < 0.6 else (-2.4 * (k - 0.6) / 0.4), 0, 0)
        else:  # idle and anything else: breathe
            hz += s(t * 2.2) * 0.01
        if hips:
            _key(hips, "location", f, (0, 0, hz))
            _key(hips, "rotation_euler", f, hrot)
        for side in ("L", "R"):
            if f"arm_{side}" in pv:
                _key(pv[f"arm_{side}"], "rotation_euler", f, arms[side])
            if f"leg_{side}" in pv:
                _key(pv[f"leg_{side}"], "rotation_euler", f, legs[side])
        if head and motion in ("look", "think"):
            _key(head, "rotation_euler", f, (0, 0, s(t * 1.3) * 0.8))


def path_move(obj: bpy.types.Object, start: int, end: int, from_xyz, to_xyz, face_travel: bool = True) -> None:
    obj.location = from_xyz
    obj.keyframe_insert("location", frame=start)
    obj.location = to_xyz
    obj.keyframe_insert("location", frame=end)
    if face_travel:
        d = Vector(to_xyz) - Vector(from_xyz)
        if d.length > 1e-4:
            obj.rotation_euler = (0, 0, math.atan2(d.x, -d.y))
            obj.keyframe_insert("rotation_euler", frame=start)


def step_keys(obj: bpy.types.Object, every: int = 2) -> None:
    """Claymation 'on twos': make every F-curve constant-interpolated and sampled every N frames."""
    ad = obj.animation_data
    if not ad or not ad.action:
        return
    for fc in _fcurves(ad.action):
        for kp in fc.keyframe_points:
            kp.interpolation = "CONSTANT"


# --------------------------------------------------------------------------------------------
# FBX + Mixamo / Cascadeur clips
# --------------------------------------------------------------------------------------------


@dataclass
class Imported:
    objects: list
    armature: bpy.types.Object | None


def import_fbx(path: str) -> Imported:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=True)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next((o for o in new if o.type == "ARMATURE"), None)
    return Imported(new, arm)


def export_fbx(obj: bpy.types.Object, path: str) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    for child in obj.children_recursive:
        child.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.fbx(filepath=path, use_selection=True, add_leaf_bones=False, bake_anim=True)


def _fcurves(action):
    fcs = getattr(action, "fcurves", None)
    if fcs is not None:
        try:
            return list(fcs)
        except TypeError:
            pass
    # Blender 5 layered actions
    out = []
    for layer in getattr(action, "layers", []):
        for strip in layer.strips:
            for bag in getattr(strip, "channelbags", []):
                out.extend(bag.fcurves)
    return out


def add_mixamo_clip(armature: bpy.types.Object, clip_fbx: str, start_frame: int, frame_count: int, fps: int = 24, source_fps: int = 30, blend: int = 6) -> bpy.types.NlaStrip:
    """Import a clip FBX (Mixamo 'Without Skin' or a Cascadeur export) and play it on `armature` as a looping NLA strip."""
    imp = import_fbx(clip_fbx)
    src = imp.armature
    if not src or not src.animation_data or not src.animation_data.action:
        for o in imp.objects:
            bpy.data.objects.remove(o, do_unlink=True)
        raise RuntimeError(f"No animation found in {clip_fbx}")
    action = src.animation_data.action
    action.name = os.path.splitext(os.path.basename(clip_fbx))[0]
    action.use_fake_user = True
    for o in imp.objects:
        bpy.data.objects.remove(o, do_unlink=True)

    ad = armature.animation_data or armature.animation_data_create()
    track = ad.nla_tracks.new()
    track.name = f"{action.name}@{start_frame}"
    strip = track.strips.new(action.name, start_frame, action)
    if hasattr(strip, "action_slot") and getattr(action, "slots", None) and len(action.slots):
        strip.action_slot = action.slots[0]
    scale = source_fps / fps if source_fps and fps else 1.0
    strip.scale = 1.0 / scale if scale else 1.0
    clip_len = max(1.0, (strip.action_frame_end - strip.action_frame_start) * strip.scale)
    strip.repeat = max(1.0, frame_count / clip_len)
    strip.blend_in = min(blend, frame_count / 3)
    strip.blend_out = min(blend, frame_count / 3)
    strip.extrapolation = "NOTHING"
    return strip


# --------------------------------------------------------------------------------------------
# cameras
# --------------------------------------------------------------------------------------------


def camera_move(spec: dict, target=(0, 0, 1.1), frames: int = 120, aspect: str = "16:9", follow: bpy.types.Object | None = None) -> bpy.types.Object:
    move, lens = spec.get("move", "static"), float(spec.get("lens", 35))
    cam_data = bpy.data.cameras.new("Camera")
    cam_data.lens = lens
    cam = bpy.data.objects.new("Camera", cam_data)
    bpy.context.collection.objects.link(cam)
    bpy.context.scene.camera = cam

    aim = _empty("CameraTarget", None, target)
    if follow is not None:
        c = aim.constraints.new("COPY_LOCATION")
        c.target = follow
        c.use_offset = True
    track = cam.constraints.new("TRACK_TO")
    track.target = aim
    track.track_axis = "TRACK_NEGATIVE_Z"
    track.up_axis = "UP_Y"

    push = {"9:16": 1.75, "1:1": 1.25}.get(aspect, 1.0)
    base = min(22.0, max(4.5, 7 * (lens / 35) ** 0.85)) * push

    def place(frame, angle, dist, height):
        tx, ty, tz = target
        cam.location = (tx + math.sin(angle) * dist, ty - math.cos(angle) * dist, height)
        cam.keyframe_insert("location", frame=frame)

    a, b = 1, frames
    if move == "dolly-in":
        place(a, 0.3, base * 1.45, 1.9)
        place(b, 0.3, base * 0.85, 1.9)
    elif move == "dolly-out":
        place(a, 0.3, base * 0.85, 1.9)
        place(b, 0.3, base * 1.7, 3.7)
    elif move == "orbit":
        for i in range(5):
            f = a + (b - a) * i / 4
            place(round(f), -0.7 + 1.6 * i / 4, base, 1.9)
    elif move == "pan":
        place(a, -0.35, base, 1.9)
        place(b, 0.35, base, 1.9)
    elif move == "crane-up":
        place(a, 0.3, base * 1.15, 0.5)
        place(b, 0.3, base, 6.0)
    elif move == "handheld":
        place(a, 0.25, base, 1.9)
        cam.keyframe_insert("rotation_euler", frame=a)
        for fc in _fcurves(cam.animation_data.action):
            if fc.data_path == "location":
                mod = fc.modifiers.new("NOISE")
                mod.scale, mod.strength = 30.0, 0.06
    else:  # static, tracking (tracking follows via the target constraint)
        place(a, 0.05 if move == "tracking" else 0.3, base, 1.9)
    return cam


# --------------------------------------------------------------------------------------------
# rendering + encoding
# --------------------------------------------------------------------------------------------


def _image_output(fmt: str = "PNG") -> None:
    s = bpy.context.scene.render.image_settings
    if hasattr(s, "media_type"):
        s.media_type = "IMAGE"
    s.file_format = fmt
    if fmt == "PNG":
        s.color_mode = "RGB"


def render_still(filepath: str, frame: int | None = None) -> str:
    scene = bpy.context.scene
    if frame is not None:
        scene.frame_set(frame)
    _image_output("PNG")
    scene.render.filepath = filepath
    bpy.ops.render.render(write_still=True)
    return filepath


def render_frames(out_dir: str) -> str:
    os.makedirs(out_dir, exist_ok=True)
    scene = bpy.context.scene
    _image_output("PNG")
    scene.render.use_overwrite = False
    scene.render.use_placeholder = True
    scene.render.filepath = os.path.join(out_dir, "####")
    bpy.ops.render.render(animation=True)
    return out_dir


def encode_scenes(frame_dirs: list[str], out_mp4: str, fps: int = 24, size=(1280, 720), audio: str | None = None) -> str:
    """Concatenate PNG sequences (one dir per scene, in order) into an H.264 MP4 with Blender's sequencer."""
    scene = bpy.data.scenes.new("Edit")
    bpy.context.window.scene = scene if bpy.context.window else scene
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.fps = fps
    se = scene.sequence_editor_create()
    strips = getattr(se, "strips", None)
    if strips is None:
        strips = se.sequences

    frame = 1
    for i, d in enumerate(frame_dirs):
        files = sorted(os.path.basename(p) for p in glob.glob(os.path.join(d, "*.png")))
        if not files:
            raise RuntimeError(f"No frames in {d}")
        strip = strips.new_image(name=f"S{i + 1}", filepath=os.path.join(d, files[0]), channel=1, frame_start=frame)
        for name in files[1:]:
            strip.elements.append(name)
        frame += len(files)
    if audio and os.path.exists(audio):
        strips.new_sound(name="Audio", filepath=audio, channel=2, frame_start=1)
    scene.frame_start, scene.frame_end = 1, frame - 1

    img = scene.render.image_settings
    if hasattr(img, "media_type"):
        img.media_type = "VIDEO"
    img.file_format = "FFMPEG"
    ff = scene.render.ffmpeg
    ff.format = "MPEG4"
    ff.codec = "H264"
    ff.constant_rate_factor = "HIGH"
    ff.ffmpeg_preset = "GOOD"
    ff.gopsize = fps
    ff.audio_codec = "AAC" if audio else "NONE"

    out_dir = os.path.dirname(out_mp4)
    os.makedirs(out_dir, exist_ok=True)
    before = set(glob.glob(os.path.join(out_dir, "*.mp4")))
    scene.render.filepath = os.path.splitext(out_mp4)[0]
    bpy.ops.render.render(animation=True, scene=scene.name)

    # Blender may append the frame range ("final0001-0720.mp4"); normalise to the requested name.
    made = sorted(set(glob.glob(os.path.join(out_dir, "*.mp4"))) - before, key=os.path.getmtime)
    if os.path.exists(out_mp4) and not made:
        return out_mp4
    if not made:
        raise RuntimeError("Encoding produced no MP4 — check that this Blender build has FFmpeg and that --factory-startup was not used.")
    if os.path.abspath(made[-1]) != os.path.abspath(out_mp4):
        if os.path.exists(out_mp4):
            os.remove(out_mp4)
        os.replace(made[-1], out_mp4)
    return out_mp4
