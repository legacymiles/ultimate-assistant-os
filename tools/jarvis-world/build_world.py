"""
Jarvis's living world — a breathing, ringed galaxy ball, the background behind
every section of /apps/jarvis.

Blender owns the shape; the browser owns the life (breathing, swirl, ring
spin, colour, glow, pointer response — src/components/new-jarvis/WorldField.tsx).

Deliberately NOT symmetrical. What this builds (stable names; the browser
styles each by name). All stars are loose points (glTF POINTS) except the
core's sphere:

  world_core       a small sphere: the blazing heart
  galaxy_bulge     a triaxial, slightly off-centre bulge
  galaxy_bar       a short bar through the core; the arms spring from its ends
  galaxy_arms      two major arms of unequal length, a minor arm and a spur,
                   on a warped disc (the rim bends up on one side, down on the
                   other)
  galaxy_knots     star-forming clusters strung along the arms (hot pink)
  galaxy_dust      dust lanes on the arms' inner edges
  galaxy_tail      a tidal tail flung out of one arm, curling up out of the
                   plane toward…
  galaxy_dwarf     …a small satellite galaxy, with its own little core
  galaxy_shell     a lopsided ball of twisted star streams around it all
  galaxy_halo      a sparse scatter of far stars
  ring_main        the ring: tilted ~64° off the disc, four bands with a
                   Cassini-style gap, density waves rippling through it
  ring_braid       a thin braided outer strand, two strands wound round each other
  ring_moons       shepherd moons riding the gap and the braid

Run (Blender 4.2+ or the bpy module):
  blender --background --python tools/jarvis-world/build_world.py -- --out public/jarvis/world.glb
  python build_world.py --out public/jarvis/world.glb [--renders <dir>] [--blend <file>]
"""

import argparse
import math
import random
import sys

import bpy
import bmesh
from mathutils import Vector, Matrix, Euler

SEED = 1729

# The ring's plane: tilted well off the galaxy's disc so the two never line up.
RING_TILT = Euler((math.radians(64), math.radians(-18), math.radians(28))).to_matrix()


def args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    p.add_argument("--renders", default="")
    p.add_argument("--blend", default="")
    return p.parse_args(argv)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def cloud(name, points):
    bm = bmesh.new()
    for p in points:
        bm.verts.new(p)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def sphere_obj(name, radius, center=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=20, radius=radius, matrix=Matrix.Translation(center))
    for f in bm.faces:
        f.smooth = True
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def gauss3(rng, s):
    return Vector((rng.gauss(0, s), rng.gauss(0, s), rng.gauss(0, s)))


def warp(p):
    """The disc's warp: the rim lifts on one side and dips on the other."""
    r = math.hypot(p.x, p.y)
    th = math.atan2(p.y, p.x)
    return Vector((p.x, p.y, p.z + 0.16 * (r / 2.2) ** 2 * math.sin(th + 0.6)))


BAR = 0.5
# (angle offset, share of stars, inner r, outer r, winding, scatter)
ARMS = [
    (0.0, 0.36, BAR, 2.45, 0.29, 1.0),  # major — feeds the tidal tail
    (math.pi, 0.31, BAR, 2.05, 0.31, 0.9),  # major, shorter
    (1.95, 0.20, 0.7, 1.55, 0.36, 1.25),  # minor, looser
    (4.25, 0.13, 0.9, 1.25, 0.33, 1.4),  # spur
]


def arm_point(rng, arm, u):
    off, _, r0, r1, wind, sc = arm
    r = r0 + u * (r1 - r0)
    theta = math.log(r / r0) / wind + off
    spread = (0.05 + 0.2 * u) * sc
    theta += rng.gauss(0, spread / max(r, 0.3))
    p = Vector((math.cos(theta) * r + rng.gauss(0, spread * 0.5), math.sin(theta) * r + rng.gauss(0, spread * 0.5), rng.gauss(0, 0.05 + 0.09 * (1 - u))))
    return warp(p), theta, r


def arms(rng, n=12000):
    pts = []
    for arm in ARMS:
        for _ in range(int(n * arm[1])):
            pts.append(arm_point(rng, arm, rng.random() ** 0.75)[0])
    # Loose disc stars, thinner on the side the tail pulls from.
    for _ in range(n // 5):
        r = 0.3 + (rng.random() ** 0.8) * 2.3
        a = rng.uniform(0, math.tau)
        if math.cos(a - 0.4) > 0.6 and rng.random() < 0.5:
            continue
        pts.append(warp(Vector((math.cos(a) * r, math.sin(a) * r, rng.gauss(0, 0.05)))))
    return pts


def knots(rng, clusters=64):
    pts = []
    for _ in range(clusters):
        arm = ARMS[rng.choices(range(3), weights=(0.45, 0.4, 0.15))[0]]
        c, _, _ = arm_point(rng, arm, rng.uniform(0.15, 0.9))
        for _ in range(rng.randint(14, 38)):
            pts.append(c + gauss3(rng, 0.028))
    return pts


def dust(rng, n=1500):
    pts = []
    for _ in range(n):
        arm = ARMS[rng.choices(range(4), weights=(0.4, 0.35, 0.18, 0.07))[0]]
        p, theta, r = arm_point(rng, arm, 0.1 + rng.random() * 0.85)
        lag = Vector((math.cos(theta - 0.25) * r, math.sin(theta - 0.25) * r, p.z))
        pts.append(warp(lag + gauss3(rng, 0.02)))
    return pts


def bulge(rng, n=3000):
    pts = []
    for _ in range(n):
        # Triaxial and nudged off-centre: not a perfect ball.
        d = Vector((rng.gauss(0, 1.15), rng.gauss(0, 0.85), rng.gauss(0, 0.6))).normalized()
        r = abs(rng.gauss(0, 0.24)) + 0.04
        pts.append(d * r + Vector((0.04, -0.03, 0.02)))
    return pts


def bar(rng, n=1400):
    pts = []
    for _ in range(n):
        x = rng.uniform(-BAR, BAR) * (rng.random() ** 0.4)
        pts.append(Vector((x, rng.gauss(0, 0.07 * (1 - abs(x) / BAR * 0.5)), rng.gauss(0, 0.04))))
    return pts


DWARF = Vector((3.05, -1.35, 1.05))


def tail(rng, n=2600):
    """From the end of the long arm, a stream curling up out of the plane to the dwarf."""
    start, theta0, _ = arm_point(rng, ARMS[0], 1.0)
    ctrl1 = start + Vector((math.cos(theta0 + 0.9), math.sin(theta0 + 0.9), 0)) * 1.1 + Vector((0, 0, 0.5))
    ctrl2 = DWARF + Vector((-0.6, 0.9, -0.2))
    pts = []
    for _ in range(n):
        t = rng.random() ** 0.85
        a = start * (1 - t) ** 3 + ctrl1 * 3 * (1 - t) ** 2 * t + ctrl2 * 3 * (1 - t) * t * t + DWARF * t ** 3
        pts.append(a + gauss3(rng, 0.03 + 0.11 * math.sin(t * math.pi)))
    return pts


def dwarf(rng, n=1100):
    pts = []
    for _ in range(n):
        d = Vector((rng.gauss(0, 1), rng.gauss(0, 0.7), rng.gauss(0, 0.9))).normalized()
        pts.append(DWARF + d * abs(rng.gauss(0, 0.17)))
    return pts


def shell(rng, streams=34, per=150, radius=1.8):
    """A ball of twisted star streams — lopsided, swollen toward one side."""
    lop = Vector((0.6, 0.35, -0.7)).normalized()
    pts = []
    for _ in range(streams):
        axis = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1))).normalized()
        ref = axis.orthogonal().normalized()
        span = rng.uniform(0.4, 1.0) * math.tau
        start = rng.uniform(0, math.tau)
        twist = rng.uniform(-0.7, 0.7)
        for k in range(per):
            t = k / per
            p = Matrix.Rotation(start + span * t, 3, axis) @ ref
            p = Matrix.Rotation(twist * math.sin(t * math.pi * 2), 3, ref) @ p
            if p.dot(lop) < -0.5 and rng.random() < 0.55:
                continue  # thinner on the far side
            r = radius * (1 + 0.2 * p.dot(lop)) * rng.uniform(0.96, 1.04)
            pts.append(p * r + gauss3(rng, 0.022))
    for _ in range(1300):
        d = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1))).normalized()
        pts.append(d * radius * (1 + 0.2 * d.dot(lop)) * (rng.random() ** 0.35))
    return pts


def halo(rng, n=800):
    pts = []
    for _ in range(n):
        d = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1))).normalized()
        pts.append(d * rng.uniform(2.4, 4.2))
    return pts


# The ring: bands (inner, outer, density), with a Cassini-style gap at 2.66–2.78.
BANDS = [(2.32, 2.5, 0.8), (2.52, 2.66, 1.0), (2.78, 3.12, 0.85), (3.16, 3.24, 0.35)]


def ring(rng, n=11000):
    pts = []
    total = sum((b[1] - b[0]) * b[2] for b in BANDS)
    for inner, outer, dens in BANDS:
        for _ in range(int(n * (outer - inner) * dens / total)):
            a = rng.uniform(0, math.tau)
            r = rng.uniform(inner, outer)
            # Spiral density waves: ripples running round the ring.
            r += 0.012 * math.sin(a * 9 + r * 40)
            if rng.random() < 0.35 * (0.5 + 0.5 * math.sin(a * 5 + r * 25)):
                continue
            p = Vector((math.cos(a) * r, math.sin(a) * r, rng.gauss(0, 0.008)))
            pts.append(RING_TILT @ p)
    return pts


def braid(rng, n=2600, radius=3.42):
    """Two strands wound round each other, like Saturn's F ring but braided tighter."""
    pts = []
    for k in range(n):
        a = k / n * math.tau
        strand = 1 if k % 2 else -1
        w = 0.028 * math.sin(a * 23 + strand * math.pi / 2)
        z = 0.02 * math.cos(a * 23 + strand * math.pi / 2)
        r = radius + w + rng.gauss(0, 0.004)
        p = Vector((math.cos(a) * r, math.sin(a) * r, z + rng.gauss(0, 0.003)))
        pts.append(RING_TILT @ p)
    return pts


def moons():
    pts = []
    for r, a in ((2.72, 0.7), (3.38, 2.9), (3.47, 3.1), (2.2, 4.6)):
        pts.append(RING_TILT @ Vector((math.cos(a) * r, math.sin(a) * r, 0)))
    return pts


# --- preview renders (Cycles, CPU) -------------------------------------------


def emission(name, color, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*color, 1)
    em.inputs["Strength"].default_value = strength
    nt.links.new(em.outputs[0], out.inputs[0])
    return m


LOOKS = {
    "world_core": ((1.0, 0.9, 0.7), 20, 0),
    "galaxy_bulge": ((1.0, 0.8, 0.5), 5, 0.010),
    "galaxy_bar": ((1.0, 0.75, 0.45), 5, 0.010),
    "galaxy_arms": ((0.2, 0.75, 1.0), 4, 0.008),
    "galaxy_knots": ((1.0, 0.25, 0.75), 7, 0.010),
    "galaxy_dust": ((0.55, 0.25, 1.0), 2, 0.016),
    "galaxy_tail": ((0.4, 0.6, 1.0), 3, 0.008),
    "galaxy_dwarf": ((0.9, 0.85, 1.0), 4, 0.010),
    "galaxy_shell": ((0.35, 0.55, 1.0), 2.5, 0.007),
    "galaxy_halo": ((0.85, 0.9, 1.0), 3, 0.008),
    "ring_main": ((0.2, 1.0, 0.85), 3, 0.007),
    "ring_braid": ((1.0, 0.55, 0.2), 5, 0.007),
    "ring_moons": ((1.0, 1.0, 1.0), 12, 0.03),
}


def renders(folder, objs):
    """One octahedron per star, preview only, never exported."""
    scene = bpy.context.scene
    preview = []
    for ob in objs:
        color, strength, bead = LOOKS[ob.name]
        dup = ob.copy()
        if bead:
            offs = [(bead, 0, 0), (-bead, 0, 0), (0, bead, 0), (0, -bead, 0), (0, 0, bead), (0, 0, -bead)]
            tris = [(0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4), (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)]
            verts, faces = [], []
            for i, v in enumerate(ob.data.vertices):
                c = v.co
                verts.extend((c.x + x, c.y + y, c.z + z) for x, y, z in offs)
                faces.extend(tuple(6 * i + k for k in t) for t in tris)
            me = bpy.data.meshes.new(ob.name + "_beads")
            me.from_pydata(verts, [], faces)
            dup.data = me
        else:
            dup.data = ob.data.copy()
        scene.collection.objects.link(dup)
        dup.data.materials.clear()
        dup.data.materials.append(emission(ob.name + "_m", color, strength))
        dup.rotation_euler = (math.radians(58), 0, math.radians(-20))
        preview.append(dup)
    for ob in objs:
        ob.hide_render = True

    world = bpy.data.worlds.new("void")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.002, 0.004, 0.01, 1)
    scene.world = world
    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 40
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 16
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    try:
        scene.view_settings.view_transform = "AgX"
    except TypeError:
        pass
    for name, loc in {"front": Vector((0.6, -10.5, 0.6)), "side": Vector((7.5, -7.0, 2.2))}.items():
        cam.location = loc
        cam.rotation_euler = (Vector((0.3, 0, 0)) - loc).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = f"{folder}/world_{name}.png"
        bpy.ops.render.render(write_still=True)
    for p in preview:
        bpy.data.objects.remove(p, do_unlink=True)
    for ob in objs:
        ob.hide_render = False


def main():
    a = args()
    rng = random.Random(SEED)
    reset()
    objs = [
        sphere_obj("world_core", 0.15),
        cloud("galaxy_bulge", bulge(rng)),
        cloud("galaxy_bar", bar(rng)),
        cloud("galaxy_arms", arms(rng)),
        cloud("galaxy_knots", knots(rng)),
        cloud("galaxy_dust", dust(rng)),
        cloud("galaxy_tail", tail(rng)),
        cloud("galaxy_dwarf", dwarf(rng)),
        cloud("galaxy_shell", shell(rng)),
        cloud("galaxy_halo", halo(rng)),
        cloud("ring_main", ring(rng)),
        cloud("ring_braid", braid(rng)),
        cloud("ring_moons", moons()),
    ]
    print("AUTHORED", {o.name: len(o.data.vertices) for o in objs})

    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    kw = dict(
        filepath=a.out,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_materials="NONE",
        export_normals=True,
        export_texcoords=False,
        export_yup=True,
    )
    # Loose points become POINTS primitives; the option name moved between versions.
    for extra in (dict(export_loose_points=True), dict(use_mesh_vertices=True), {}):
        try:
            bpy.ops.export_scene.gltf(**kw, **extra)
            print("EXPORT OPTIONS", extra)
            break
        except TypeError:
            continue

    if a.blend:
        bpy.ops.wm.save_as_mainfile(filepath=a.blend)

    if a.renders:
        renders(a.renders, objs)

    # Fresh import: what the browser will actually get.
    reset()
    bpy.ops.import_scene.gltf(filepath=a.out)
    print("IMPORTED", {o.name: len(o.data.vertices) for o in bpy.data.objects if o.type == "MESH"})


main()
