"""
Jarvis's living world — a breathing galaxy ball, the background behind every
section of /apps/jarvis.

Blender owns the shape; the browser owns the life (breathing, swirl, glow,
pointer response — see src/components/new-jarvis/WorldField.tsx).

What this builds (stable names; the browser styles each by name). All of it is
stars — loose points, exported as glTF POINTS — except the core's sphere:

  world_core     a small sphere: the blazing heart
  galaxy_bulge   a dense cloud of stars around the heart
  galaxy_arms    four logarithmic spiral arms in the galactic plane, thick at
                 the centre, thinning toward the rim
  galaxy_dust    fewer, larger motes along the arms' inner edges (nebula dust)
  galaxy_shell   the "ball": stars flowing along twisted streams over a sphere,
                 so the galaxy sits inside a globe of its own light
  galaxy_halo    a sparse scatter of far stars around it all

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
from mathutils import Vector, Matrix

SEED = 1729


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


def core():
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=20, radius=0.16)
    for f in bm.faces:
        f.smooth = True
    me = bpy.data.meshes.new("world_core")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("world_core", me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def bulge(rng, n=3200):
    pts = []
    for _ in range(n):
        d = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 0.62)))
        r = abs(rng.gauss(0, 0.26)) + 0.05
        pts.append(d.normalized() * r)
    return pts


def arms(rng, n=10500, count=4, wind=0.32, rmax=2.15):
    """Logarithmic spirals: θ = ln(r / a) / b, with scatter that grows toward the rim."""
    pts = []
    for i in range(n):
        arm = i % count
        u = rng.random() ** 0.72
        r = 0.18 + u * (rmax - 0.18)
        theta = math.log(r / 0.18) / wind + arm * math.tau / count
        spread = 0.05 + 0.2 * u
        theta += rng.gauss(0, spread / max(r, 0.3))
        x = math.cos(theta) * r + rng.gauss(0, spread * 0.5)
        y = math.sin(theta) * r + rng.gauss(0, spread * 0.5)
        z = rng.gauss(0, 0.06 + 0.1 * (1 - u))
        pts.append(Vector((x, y, z)))
    # A thin field of loose disc stars between the arms.
    for _ in range(n // 4):
        r = 0.25 + (rng.random() ** 0.8) * rmax
        a = rng.uniform(0, math.tau)
        pts.append(Vector((math.cos(a) * r, math.sin(a) * r, rng.gauss(0, 0.05))))
    return pts


def dust(rng, n=1300, count=4, wind=0.32, rmax=2.0):
    pts = []
    for i in range(n):
        arm = i % count
        u = 0.15 + rng.random() * 0.85
        r = 0.18 + u * (rmax - 0.18)
        # The inner (trailing) edge of each arm, where real dust lanes sit.
        theta = math.log(r / 0.18) / wind + arm * math.tau / count - 0.28
        theta += rng.gauss(0, 0.08)
        pts.append(Vector((math.cos(theta) * r, math.sin(theta) * r, rng.gauss(0, 0.05))))
    return pts


def shell(rng, streams=34, per=150, radius=1.75):
    """The ball: stars along great-circle streams, each tilted and twisted, so the
    sphere reads as currents of light rather than a dotted globe."""
    pts = []
    for s in range(streams):
        axis = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1))).normalized()
        ref = axis.orthogonal().normalized()
        span = rng.uniform(0.5, 1.0) * math.tau
        start = rng.uniform(0, math.tau)
        twist = rng.uniform(-0.6, 0.6)
        r = radius * rng.uniform(0.92, 1.08)
        for k in range(per):
            t = k / per
            ang = start + span * t
            p = Matrix.Rotation(ang, 3, axis) @ ref
            # Drift off the great circle a little, like a current.
            p = Matrix.Rotation(twist * math.sin(t * math.pi * 2), 3, ref) @ p
            jitter = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1))) * 0.025
            pts.append(p * r * rng.uniform(0.98, 1.02) + jitter)
    # And a soft scatter through the ball's volume.
    for _ in range(1600):
        d = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1))).normalized()
        pts.append(d * radius * (rng.random() ** 0.35))
    return pts


def halo(rng, n=900):
    pts = []
    for _ in range(n):
        d = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1))).normalized()
        pts.append(d * rng.uniform(2.1, 3.6))
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


def renders(folder, objs):
    """A bead per star, preview only, never exported."""
    scene = bpy.context.scene
    looks = {
        "world_core": ((1.0, 0.92, 0.75), 30, 0),
        "galaxy_bulge": ((1.0, 0.85, 0.6), 6, 0.010),
        "galaxy_arms": ((0.3, 0.85, 1.0), 4, 0.008),
        "galaxy_dust": ((0.65, 0.35, 1.0), 3, 0.016),
        "galaxy_shell": ((0.45, 0.7, 1.0), 3, 0.007),
        "galaxy_halo": ((0.85, 0.9, 1.0), 3, 0.008),
    }
    preview = []
    for ob in objs:
        color, strength, bead = looks[ob.name]
        mat = emission(ob.name + "_m", color, strength)
        dup = ob.copy()
        dup.data = ob.data.copy()
        scene.collection.objects.link(dup)
        if bead:
            # One octahedron per star, built in a single from_pydata call.
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
        dup.data.materials.clear()
        dup.data.materials.append(mat)
        dup.rotation_euler = (math.radians(62), 0, math.radians(20))
        preview.append(dup)
    for ob in objs:
        ob.hide_render = True

    world = bpy.data.worlds.new("void")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.002, 0.004, 0.01, 1)
    scene.world = world
    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 50
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
    for name, loc in {"front": Vector((0, -9.0, 0.4)), "close": Vector((0, -5.4, 0.3))}.items():
        cam.location = loc
        cam.rotation_euler = (Vector((0, 0, 0)) - loc).to_track_quat("-Z", "Y").to_euler()
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
        core(),
        cloud("galaxy_bulge", bulge(rng)),
        cloud("galaxy_arms", arms(rng)),
        cloud("galaxy_dust", dust(rng)),
        cloud("galaxy_shell", shell(rng)),
        cloud("galaxy_halo", halo(rng)),
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
