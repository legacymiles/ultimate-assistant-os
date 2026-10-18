"""
Jarvis's living world — a breathing galaxy ball in a coloured cosmos, the
background behind every section of /apps/jarvis.

Blender owns the shape; the browser owns the life (breathing, swirl, ring
spin, colour, glow, pointer response — src/components/new-jarvis/WorldField.tsx).

A ROUND ball, compact and full — but organic, not mirror-perfect — with two
rings close around it and a cosmos of colour beyond. Stable names; the
browser styles each by name. All loose points (glTF POINTS) except the core:

  world_core        a small sphere: the blazing heart
  galaxy_bulge      a triaxial, slightly off-centre bulge
  galaxy_arms       three arms of unequal length on a thick, gently warped
                    disc — thick enough that the galaxy fills the ball
  galaxy_knots      star-forming clusters strung along the arms
  galaxy_dust       dust lanes on the arms' inner edges
  galaxy_shell      the ball: twisted star streams over a sphere, swollen a
                    little on one side
  galaxy_ribbons    three broad streams wrapping the ball at odd angles
  galaxy_companion  a small cluster orbiting just outside the ball
  ring_main         a flat banded ring with a gap (held level, Saturn-style)
  ring_braid        a thin braided ring a few degrees off the main one
  ring_moons        shepherd moons on the main ring
  cosmos_stars      stars and small clusters out in the space around it

The smoke in the middle and the mist round the ring are volumes, not points:
see bake_smoke.py / smoke_field.py and WorldField.tsx.

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

# The rings lie flat in their own plane (Blender XY → the browser's
# horizontal plane); the browser holds them level, Saturn-style, while the
# galaxy faces you. The braid sits a few degrees off, so the two strands
# cross rather than stack.
RING_TILT = Euler((0, 0, 0)).to_matrix()
BRAID_TILT = Euler((math.radians(4.5), math.radians(-2.5), 0)).to_matrix()


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
    return Vector((p.x, p.y, p.z + 0.12 * (r / 1.7) ** 2 * math.sin(th + 0.6)))


# (angle offset, share of stars, inner r, outer r, winding, scatter)
ARMS = [
    (0.0, 0.42, 0.22, 1.75, 0.30, 1.0),  # major
    (math.pi + 0.35, 0.36, 0.22, 1.5, 0.32, 1.05),  # major, shorter and offset
    (2.0, 0.22, 0.4, 1.2, 0.38, 1.35),  # minor, looser
]


def arm_point(rng, arm, u):
    off, _, r0, r1, wind, sc = arm
    r = r0 + u * (r1 - r0)
    theta = math.log(r / r0) / wind + off
    spread = (0.05 + 0.2 * u) * sc
    theta += rng.gauss(0, spread / max(r, 0.3))
    # A thick disc: the galaxy fills the ball instead of lying flat inside it.
    p = Vector((math.cos(theta) * r + rng.gauss(0, spread * 0.5), math.sin(theta) * r + rng.gauss(0, spread * 0.5), rng.gauss(0, 0.1 + 0.16 * (1 - u))))
    return warp(p), theta, r


def arms(rng, n=10500):
    pts = []
    for arm in ARMS:
        for _ in range(int(n * arm[1])):
            pts.append(arm_point(rng, arm, rng.random() ** 0.75)[0])
    # Loose disc stars, a little denser on one side.
    for _ in range(n // 4):
        r = 0.25 + (rng.random() ** 0.8) * 1.6
        a = rng.uniform(0, math.tau)
        if math.cos(a - 2.4) > 0.5 and rng.random() < 0.45:
            continue
        pts.append(warp(Vector((math.cos(a) * r, math.sin(a) * r, rng.gauss(0, 0.12)))))
    return pts


def knots(rng, clusters=48):
    pts = []
    for _ in range(clusters):
        arm = ARMS[rng.choices(range(3), weights=(0.45, 0.4, 0.15))[0]]
        c, _, _ = arm_point(rng, arm, rng.uniform(0.15, 0.9))
        for _ in range(rng.randint(14, 38)):
            pts.append(c + gauss3(rng, 0.028))
    return pts


def dust(rng, n=1300):
    pts = []
    for _ in range(n):
        arm = ARMS[rng.choices(range(3), weights=(0.45, 0.38, 0.17))[0]]
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


def ribbons(rng, n=2600):
    """Three broad streams wrapping the ball at odd angles — each a band of
    stars round a tilted great circle, bunched toward one end."""
    pts = []
    tilts = [(0.6, 0.2, 0.0), (-0.9, 0.7, 1.1), (1.4, -0.5, 2.3)]
    for k, (ax, ay, az) in enumerate(tilts):
        m = Euler((ax, ay, az)).to_matrix()
        span = (0.55, 0.4, 0.3)[k] * math.tau
        r = (2.0, 1.95, 2.08)[k]
        for _ in range(n // 3):
            t = rng.random() ** 1.4
            a = t * span
            w = rng.gauss(0, 0.06 + 0.05 * t)
            p = Vector((math.cos(a) * (r + w), math.sin(a) * (r + w), rng.gauss(0, 0.05 + 0.06 * t)))
            pts.append(m @ p)
    return pts


COMPANION = Vector((1.55, -1.4, 0.95))


def companion(rng, n=700):
    pts = []
    for _ in range(n):
        d = Vector((rng.gauss(0, 1), rng.gauss(0, 0.75), rng.gauss(0, 0.9))).normalized()
        pts.append(COMPANION + d * abs(rng.gauss(0, 0.13)))
    return pts


def shell(rng, streams=32, per=140, radius=1.85):
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
            if p.dot(lop) < -0.55 and rng.random() < 0.4:
                continue  # thinner on the far side
            r = radius * (1 + 0.12 * p.dot(lop)) * rng.uniform(0.96, 1.04)
            pts.append(p * r + gauss3(rng, 0.022))
    for _ in range(1300):
        d = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1))).normalized()
        pts.append(d * radius * (1 + 0.12 * d.dot(lop)) * (rng.random() ** 0.35))
    return pts


def nebula(rng, n=2600):
    """Clouds of colour round the ball — uneven: more on one side, none on another."""
    pts = []
    clouds = []
    for _ in range(8):
        d = Vector((rng.gauss(0, 1), rng.gauss(0, 0.6), rng.gauss(0, 1))).normalized()
        if d.dot(Vector((-0.7, 0.2, 0.5))) > 0.55:
            continue  # leave one side open, dark sky
        center = d * rng.uniform(3.0, 5.2)
        # +Z here faces the viewer once the browser tilts the galaxy face-on:
        # clouds stay behind and around the ball, never between it and you.
        if center.z > 1.0:
            center.z = -center.z
        stretch = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1))).normalized()
        clouds.append((center, stretch, rng.uniform(0.45, 0.9)))
    for i in range(n):
        c, s_, size = clouds[i % len(clouds)]
        # Even density along the cloud, so no part of it piles up into a hot spot.
        along = rng.uniform(-1.0, 1.0) * size * 2.2
        side = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * size * 0.7
        pts.append(c + s_ * along + side)
    return pts


def cosmos(rng, n=2200):
    pts = []
    # Scattered stars, thinning with distance.
    for _ in range(n):
        d = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1))).normalized()
        pts.append(d * (2.4 + (rng.random() ** 1.6) * 5.0))
    # A few small star clusters out in the dark.
    for _ in range(7):
        c = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1))).normalized() * rng.uniform(2.8, 5.5)
        # Kept out of the space between the camera and the ball.
        if c.z > 2.0:
            c.z = -c.z
        for _ in range(rng.randint(22, 48)):
            pts.append(c + gauss3(rng, 0.16))
    return pts


# The ring: bands (inner, outer, density), with a Cassini-style gap at 2.48–2.58.
BANDS = [(2.2, 2.34, 0.8), (2.36, 2.48, 1.0), (2.58, 2.82, 0.85), (2.86, 2.92, 0.35)]


def ring(rng, n=7500):
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


def braid(rng, n=2200, radius=2.62):
    """Two strands wound round each other, like Saturn's F ring but braided tighter."""
    pts = []
    for k in range(n):
        a = k / n * math.tau
        strand = 1 if k % 2 else -1
        w = 0.028 * math.sin(a * 23 + strand * math.pi / 2)
        z = 0.02 * math.cos(a * 23 + strand * math.pi / 2)
        r = radius + w + rng.gauss(0, 0.004)
        p = Vector((math.cos(a) * r, math.sin(a) * r, z + rng.gauss(0, 0.003)))
        pts.append(BRAID_TILT @ p)
    return pts


def moons():
    pts = []
    for r, a in ((2.53, 0.7), (2.95, 2.9), (2.53, 3.6), (2.1, 4.6)):
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
    "galaxy_arms": ((0.2, 0.75, 1.0), 4, 0.008),
    "galaxy_knots": ((1.0, 0.25, 0.75), 7, 0.010),
    "galaxy_dust": ((0.55, 0.25, 1.0), 2, 0.016),
    "galaxy_shell": ((0.35, 0.55, 1.0), 2.5, 0.007),
    "galaxy_ribbons": ((0.2, 1.0, 0.8), 3, 0.008),
    "galaxy_companion": ((1.0, 0.6, 0.85), 4, 0.010),
    "ring_main": ((0.2, 1.0, 0.85), 3, 0.007),
    "ring_braid": ((1.0, 0.55, 0.2), 5, 0.007),
    "ring_moons": ((1.0, 1.0, 1.0), 12, 0.03),
    "cosmos_nebula": ((0.8, 0.2, 1.0), 0.4, 0.018),
    "cosmos_stars": ((0.85, 0.9, 1.0), 3, 0.009),
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
        dup.rotation_euler = (math.radians(32), 0, math.radians(-12))
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
    for name, loc in {"front": Vector((0.3, -9.0, 0.5)), "side": Vector((6.2, -6.0, 2.4))}.items():
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
        cloud("galaxy_arms", arms(rng)),
        cloud("galaxy_knots", knots(rng)),
        cloud("galaxy_dust", dust(rng)),
        cloud("galaxy_shell", shell(rng)),
        cloud("galaxy_ribbons", ribbons(rng)),
        cloud("galaxy_companion", companion(rng)),
        cloud("ring_main", ring(rng)),
        cloud("ring_braid", braid(rng)),
        cloud("ring_moons", moons()),
        cloud("cosmos_stars", cosmos(rng)),
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
