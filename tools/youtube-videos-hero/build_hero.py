"""
YouTube Videos hero — the Blender source of truth (blender-to-web, tier 1).

Run headless:
    python build_hero.py --direction reel --out ../../public/youtube-videos   (bpy wheel)
    blender --background --python build_hero.py -- --direction reel --out ...

Builds one of three directions, renders a 16:9 hero still and a 9:16 phone
still, and exports a compressed GLB whose moving parts are separate objects
with stable names the browser drives:

    core            the play prism at the centre (pulses, follows the pointer)
    tile_00..tile_N saved-video tiles (lean toward the pointer, deal on scroll,
                    a new one flies in when a link is saved)
    fleck_00..      foreground flecks (the near parallax plane)

Lighting is NOT exported (Cycles light does not survive glTF); the page
rebuilds it from the RIG values printed at the end, so render and web match.
Recorded: Blender 5.0.1 (bpy wheel), Cycles CPU, glTF exporter defaults +
Draco level 6.
"""

import argparse
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
ap = argparse.ArgumentParser()
ap.add_argument("--direction", default="reel", choices=["reel", "deck", "jellies"])
ap.add_argument("--out", default="out")
ap.add_argument("--samples", type=int, default=64)
ap.add_argument("--no-render", action="store_true")
args = ap.parse_args(argv)
os.makedirs(args.out, exist_ok=True)


def hexrgb(h, a=1.0):
    h = h.lstrip("#")
    srgb = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return (*lin, a)


# ---- the three directions ---------------------------------------------------
# Divergent on ground value, material, assembly and light (brief.md axes).
DIRS = {
    # A · safe — dark like the rest of Jarvis, glass tiles in a rising helix
    "reel": dict(
        ground="#07080c",
        core="#ff4b3e",
        tiles=["#ff4b3e", "#ff7a59", "#3fd6ff", "#9a7bff", "#ffd166", "#23f0c7", "#ff4b8b", "#5b8cff"],
        tile_mat="glass",
        assembly="helix",
        light="night",
        flecks="#ffffff",
    ),
    # B · bold — high-key paper studio, matte ceramic tiles fanned like a hand of cards
    "deck": dict(
        ground="#ece6dc",
        core="#e5412d",
        tiles=["#e5412d", "#1d1b19", "#f2c14e", "#f7f3ec", "#e5412d", "#2f5d50", "#f2c14e", "#1d1b19"],
        tile_mat="ceramic",
        assembly="fan",
        light="studio",
        flecks="#1d1b19",
    ),
    # C · unexpected — dusk violet, rounded CRT bubbles drifting like jellyfish
    "jellies": dict(
        ground="#2b2440",
        core="#ffb38a",
        tiles=["#8ff0c8", "#ffb38a", "#b9a6ff", "#ffe08a", "#8fd3ff", "#ff9ec7", "#8ff0c8", "#b9a6ff"],
        tile_mat="crt",
        assembly="cluster",
        light="dusk",
        flecks="#ffe8d6",
    ),
}
D = DIRS[args.direction]

# ---- clean scene ------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
try:
    scene.cycles.device = "CPU"
except TypeError:
    pass
scene.cycles.samples = args.samples
scene.cycles.use_denoising = True
scene.render.film_transparent = False
try:
    scene.view_settings.view_transform = "AgX"
except TypeError:
    scene.view_settings.view_transform = "Filmic"

world = bpy.data.worlds.new("world")
scene.world = world
world.use_nodes = True
bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs[0].default_value = hexrgb(D["ground"])
bg.inputs[1].default_value = 0.35 if D["light"] != "studio" else 0.9


def principled(mat):
    return next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


def setin(node, names, value):
    for name in names:
        if name in node.inputs:
            try:
                node.inputs[name].default_value = value
                return
            except (TypeError, ValueError):
                continue


def material(name, color, kind, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = principled(m)
    setin(p, ["Base Color"], hexrgb(color))
    if kind == "glass":
        setin(p, ["Roughness"], 0.08)
        setin(p, ["Transmission Weight", "Transmission"], 0.6)
        setin(p, ["IOR"], 1.45)
        setin(p, ["Coat Weight", "Clearcoat"], 1.0)
    elif kind == "ceramic":
        setin(p, ["Roughness"], 0.42)
        setin(p, ["Coat Weight", "Clearcoat"], 0.35)
        setin(p, ["Coat Roughness"], 0.2)
    elif kind == "crt":
        setin(p, ["Roughness"], 0.15)
        setin(p, ["Transmission Weight", "Transmission"], 0.35)
        setin(p, ["Subsurface Weight", "Subsurface"], 0.25)
    elif kind == "gloss":
        setin(p, ["Roughness"], 0.18)
        setin(p, ["Coat Weight", "Clearcoat"], 1.0)
    if emit > 0:
        setin(p, ["Emission Color", "Emission"], hexrgb(color))
        setin(p, ["Emission Strength"], emit)
    return m


def shade_smooth(obj):
    for poly in obj.data.polygons:
        poly.use_smooth = True


def apply_mods(obj):
    bpy.context.view_layer.objects.active = obj
    for mod in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def rounded_slab(name, w, h, d, r, mat, screen=None):
    """A video tile: a rounded slab with an inset glowing screen as its own material slot."""
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.active_object
    o.name = name
    o.scale = (w, d, h)
    bpy.ops.object.transform_apply(scale=True)
    bev = o.modifiers.new("bevel", "BEVEL")
    bev.width = r
    bev.segments = 6
    bev.limit_method = "NONE"
    apply_mods(o)
    shade_smooth(o)
    o.data.materials.append(mat)
    if screen is not None:
        bpy.ops.mesh.primitive_plane_add(size=1)
        s = bpy.context.active_object
        s.name = f"{name}_screen"
        s.scale = (w * 0.84, h * 0.78, 1)
        s.rotation_euler = (math.radians(90), 0, 0)
        s.location = (0, -d / 2 - 0.004, 0)
        bpy.ops.object.transform_apply(scale=True, rotation=True, location=True)
        s.data.materials.append(screen)
        s.parent = o
    return o


def play_prism(name, size, mat):
    bpy.ops.mesh.primitive_cylinder_add(vertices=3, radius=size, depth=size * 0.55)
    o = bpy.context.active_object
    o.name = name
    o.rotation_euler = (math.radians(90), math.radians(90), 0)
    bpy.ops.object.transform_apply(rotation=True)
    bev = o.modifiers.new("bevel", "BEVEL")
    bev.width = size * 0.16
    bev.segments = 8
    sub = o.modifiers.new("sub", "SUBSURF")
    sub.levels = 1
    sub.render_levels = 1
    apply_mods(o)
    shade_smooth(o)
    o.data.materials.append(mat)
    return o


def crt_bubble(name, r, mat, screen):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=48, ring_count=24)
    o = bpy.context.active_object
    o.name = name
    o.scale = (1.15, 0.8, 0.92)
    bpy.ops.object.transform_apply(scale=True)
    shade_smooth(o)
    o.data.materials.append(mat)
    bpy.ops.mesh.primitive_plane_add(size=1)
    s = bpy.context.active_object
    s.name = f"{name}_screen"
    s.scale = (r * 1.25, r * 0.95, 1)
    s.rotation_euler = (math.radians(90), 0, 0)
    s.location = (0, -r * 0.78, 0)
    bpy.ops.object.transform_apply(scale=True, rotation=True, location=True)
    s.data.materials.append(screen)
    s.parent = o
    return o


# ---- the centerpiece ----------------------------------------------------------
core_mat = material("core", D["core"], "gloss", emit=0.6 if D["light"] != "studio" else 0.0)
core = play_prism("core", 0.62, core_mat)
core.location = (0, 0, 0.05)

tiles = []
n = 9
for i in range(n):
    col = D["tiles"][i % len(D["tiles"])]
    body = material(f"tile_{i:02d}", "#11131a" if D["tile_mat"] == "glass" else col, D["tile_mat"] if D["tile_mat"] != "crt" else "crt")
    screen = material(f"screen_{i:02d}", col, "gloss", emit=2.2 if D["light"] != "studio" else 0.0)
    if D["tile_mat"] == "crt":
        t = crt_bubble(f"tile_{i:02d}", 0.34 + 0.06 * ((i * 7) % 3), body, screen)
    else:
        t = rounded_slab(f"tile_{i:02d}", 0.96, 0.54, 0.07 if D["tile_mat"] == "glass" else 0.11, 0.03, body, screen if D["tile_mat"] == "glass" else None)
    tiles.append(t)

    if D["assembly"] == "helix":
        # A loose rising helix around the core. Tiles stay face-on to the
        # camera (they wear real thumbnails on the web), turning a little
        # toward the centre so the reel reads as one curved strip.
        a = i / n * math.tau * 1.05 + 0.4
        x = math.cos(a) * 1.9
        y = math.sin(a) * 1.1 + 0.9
        z = -0.95 + i * 0.25
        t.location = (x, y, z)
        t.rotation_euler = (math.radians(4), math.radians(-3 + (i % 3) * 3), -x * 0.16)
    elif D["assembly"] == "fan":
        a = math.radians(-64 + i * 16)
        t.location = (math.sin(a) * 1.25, 0.45 + i * 0.03, -0.35 + math.cos(a) * 1.05)
        t.rotation_euler = (math.radians(4), -a, 0)
    else:
        g = i * 2.399963  # golden angle
        rr = 0.65 + 0.55 * math.sqrt((i + 1) / n)
        t.location = (math.cos(g) * rr * 1.7, 0.3 + math.sin(g * 1.7) * 0.4, math.sin(g) * rr * 1.0)
        t.rotation_euler = (math.radians(6 * math.sin(i)), 0, math.radians(14 * math.cos(i)))

# Foreground flecks: the near plane of the layered hero.
fleck_mat = material("fleck", D["flecks"], "gloss", emit=1.5 if D["light"] != "studio" else 0.0)
for i in range(14):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=0.012 + 0.009 * ((i * 5) % 3), subdivisions=2)
    f = bpy.context.active_object
    f.name = f"fleck_{i:02d}"
    g = i * 2.399963
    f.location = (math.cos(g) * (1.2 + (i % 4) * 0.55), -1.1 - (i % 3) * 0.35, math.sin(g * 1.3) * 1.2)
    shade_smooth(f)
    f.data.materials.append(fleck_mat)

# Ground catcher (render only; the page draws its own ground).
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, -1.6))
ground = bpy.context.active_object
ground.name = "render_ground"
gm = material("ground", D["ground"], "ceramic")
setin(principled(gm), ["Roughness"], 0.9 if D["light"] == "studio" else 0.5)
ground.data.materials.append(gm)

# ---- light rig (mirrored in the browser) ------------------------------------
RIGS = {
    "night": [("key", "AREA", (3.5, -3.0, 3.2), 420, "#ffd6c8", 3.0), ("rim", "AREA", (-3.8, 2.5, 1.5), 520, "#3fd6ff", 2.5), ("fill", "AREA", (0, -4.5, -0.5), 90, "#9a7bff", 4.0)],
    "studio": [("key", "AREA", (2.8, -3.6, 4.2), 900, "#fff4e6", 4.0), ("fill", "AREA", (-4.0, -2.0, 1.2), 300, "#ffffff", 5.0), ("rim", "AREA", (0, 3.5, 3.0), 260, "#ffe2c4", 2.5)],
    "dusk": [("key", "AREA", (3.0, -3.0, 3.0), 380, "#ffc6a8", 3.0), ("rim", "AREA", (-3.5, 2.5, 2.0), 420, "#b9a6ff", 3.0), ("fill", "AREA", (0, -4.0, -1.0), 140, "#8ff0c8", 4.0)],
}
for name, kind, loc, power, color, size in RIGS[D["light"]]:
    ld = bpy.data.lights.new(name, kind)
    ld.energy = power
    ld.color = hexrgb(color)[:3]
    ld.size = size
    lo = bpy.data.objects.new(name, ld)
    scene.collection.objects.link(lo)
    lo.location = loc
    lo.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()

# ---- camera -----------------------------------------------------------------
cam_data = bpy.data.cameras.new("cam")
cam_data.lens = 50
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam.location = (0.0, -7.6, 0.55)
cam.rotation_euler = (Vector((0, 0, 0.05)) - cam.location).to_track_quat("-Z", "Y").to_euler()


def render(path, w, h, lens):
    scene.render.resolution_x = w
    scene.render.resolution_y = h
    cam_data.lens = lens
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


if not args.no_render:
    render(os.path.join(args.out, f"hero-{args.direction}.png"), 1600, 900, 50)
    render(os.path.join(args.out, f"hero-{args.direction}-phone.png"), 720, 1280, 34)

# ---- export -----------------------------------------------------------------
for o in list(bpy.data.objects):
    o.select_set(o.type == "MESH" and o.name != "render_ground")
glb = os.path.join(args.out, f"hero-{args.direction}.glb")
kw = dict(filepath=glb, export_format="GLB", use_selection=True, export_apply=True, export_yup=True, export_cameras=False, export_lights=False)
try:
    bpy.ops.export_scene.gltf(**kw, export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6)
except Exception as e:  # draco missing in this build → plain GLB
    print("draco unavailable:", e)
    bpy.ops.export_scene.gltf(**kw)

meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.name != "render_ground"]
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
print(f"EXPORTED {glb} objects={len(meshes)} tris={tris} bytes={os.path.getsize(glb)}")
print("RIG", D["light"], RIGS[D["light"]], "ground", D["ground"])
