"""
The smoke at the heart of Jarvis's galaxy ball, simulated in Blender.

A Mantaflow gas domain, no gravity, with a small emitter at the centre
pushing smoke outward while a vortex field twists it round and a turbulence
field tears it into detail. One frame of the density is resampled to a 64³
uint8 grid (z, y, x order — Data3DTexture order) and saved for the browser,
which ray-marches it inside the ball and colours it there
(src/components/new-jarvis/WorldField.tsx).

Run (Blender 4.2+ or the bpy module):
  python tools/jarvis-world/bake_smoke.py --out public/jarvis/smoke_64.bin [--cache <dir>] [--frame 70]
"""

import argparse
import math
import os
import sys
import tempfile

import bpy
import numpy as np


def args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    p.add_argument("--cache", default="")
    p.add_argument("--frame", type=int, default=70)
    p.add_argument("--res", type=int, default=72)
    return p.parse_args(argv)


def set_enum(obj, attr, *values):
    for v in values:
        try:
            setattr(obj, attr, v)
            return v
        except (TypeError, ValueError):
            continue
    return None


def main():
    a = args()
    cache = a.cache or tempfile.mkdtemp(prefix="jarvis-smoke-")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = a.frame
    scene.use_gravity = False
    scene.gravity = (0.0, 0.0, 0.0)

    # Domain: a 4-unit cube around the origin.
    bpy.ops.mesh.primitive_cube_add(size=4.0, location=(0, 0, 0))
    dom = bpy.context.active_object
    dom.name = "smoke_domain"
    dmod = dom.modifiers.new("Fluid", "FLUID")
    dmod.fluid_type = "DOMAIN"
    ds = dmod.domain_settings
    ds.domain_type = "GAS"
    ds.resolution_max = a.res
    ds.cache_directory = cache
    set_enum(ds, "cache_type", "ALL", "MODULAR")
    ds.cache_frame_start = 1
    ds.cache_frame_end = a.frame
    ds.use_noise = False
    ds.vorticity = 0.35
    # No buoyancy: the smoke spreads in every direction rather than rising.
    ds.alpha = 0.0
    ds.beta = 0.0
    try:
        ds.use_dissolve_smoke = True
        ds.dissolve_speed = 60
    except AttributeError:
        pass

    # Emitter: a small ball at the centre, pushing outward.
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.28, location=(0, 0, 0))
    flow = bpy.context.active_object
    flow.name = "smoke_emitter"
    fmod = flow.modifiers.new("Fluid", "FLUID")
    fmod.fluid_type = "FLOW"
    fs = fmod.flow_settings
    fs.flow_type = "SMOKE"
    fs.flow_behavior = "INFLOW"
    set_enum(fs, "flow_source", "MESH")
    fs.use_initial_velocity = True
    fs.velocity_normal = 1.6
    fs.density = 1.0
    fs.surface_distance = 0.6

    # A vortex twisting the smoke round, and turbulence tearing it into detail.
    bpy.ops.object.effector_add(type="VORTEX", location=(0, 0, 0))
    vortex = bpy.context.active_object
    vortex.field.strength = 3.0
    vortex.rotation_euler = (math.radians(18), math.radians(-12), 0)
    bpy.ops.object.effector_add(type="TURBULENCE", location=(0, 0, 0))
    turb = bpy.context.active_object
    turb.field.strength = 4.0
    turb.field.size = 0.55
    turb.field.flow = 0.0

    # Bake.
    with bpy.context.temp_override(active_object=dom, object=dom, selected_objects=[dom], selected_editable_objects=[dom]):
        bpy.ops.fluid.bake_all()

    scene.frame_set(a.frame)
    res = tuple(ds.domain_resolution)
    dens = np.array(ds.density_grid[:], dtype=np.float32)
    if dens.size == 0:
        raise SystemExit("Empty density grid — the bake produced nothing at this frame.")
    if dens.size != res[0] * res[1] * res[2]:
        s = round((dens.size / (res[0] * res[1] * res[2])) ** (1 / 3))
        res = tuple(r * s for r in res)
    vol = dens.reshape(res[2], res[1], res[0])  # x fastest in memory → (z, y, x)

    # Resample to 64³, normalise, gamma-lift the thin wisps, quantise.
    idx = [np.linspace(0, r - 1, 64).astype(int) for r in vol.shape]
    small = vol[np.ix_(*idx)]
    small = np.clip(small / max(np.percentile(small, 99.7), 1e-6), 0, 1) ** 0.8
    out = (small * 255).astype(np.uint8)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    out.tofile(a.out)
    filled = float((out > 12).mean())
    print("SMOKE", {"domain_res": res, "frame": a.frame, "bytes": out.size, "filled": round(filled, 3), "max": int(out.max())})


main()
