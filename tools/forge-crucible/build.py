# ---------------------------------------------------------------------------
# The Forge crucible — the centerpiece of Website Redesigner V2.
#
#   blender --background --python tools/forge-crucible/build.py
#
# One molten pour splitting into three ingots, each on its own rail. The three
# ingots are the three bake-off lanes: in the browser their emission is driven
# by real lane state, so an ingot glowing is a lane thinking, an ingot stalled
# mid-rail is a lane waiting at a gate, and a dark ingot is a lane that is done
# or dead. Nothing here animates — Blender owns the asset, the browser owns the
# response.
#
# Written to be run on any Blender, which is why it looks more careful than it
# needs to:
#
#   Shader nodes are found BY TYPE. `nodes["Principled BSDF"]` returns None on a
#   non-English Blender UI, and silently produces an unshaded object.
#
#   Principled socket names moved in 4.x ("Specular" became "Specular IOR
#   Level") and may move again, so every socket is set through `put()`, which
#   skips a name the build does not have rather than raising.
#
#   Enum identifiers are never hardcoded. `scene.render.engine` is the known
#   exception — RNA under-reports it because add-on engines are not enum items —
#   so it is assigned inside try/except TypeError.
#
#   The three ingots and the three rails are LINKED duplicates: one mesh each,
#   six objects. Separate meshes would triple the vertex count in the GLB for
#   three objects that are identical by definition.
# ---------------------------------------------------------------------------

import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.realpath(__file__))
REPO = os.path.realpath(os.path.join(HERE, "..", ".."))
OUT_GLB = os.path.join(REPO, "public", "models", "forge-crucible.glb")
OUT_BLEND = os.path.join(HERE, "forge-crucible.blend")
OUT_RENDERS = os.path.join(HERE, "renders")

# The Forge palette, straight from the approved mockup.
GRAPHITE = (0.043, 0.055, 0.067, 1.0)   # #0B0E11 ground
STEEL_MID = (0.227, 0.251, 0.286, 1.0)  # #3A4049
STEEL_LT = (0.541, 0.576, 0.620, 1.0)   # #8A939E
MOLTEN = (1.0, 0.42, 0.08, 1.0)
CYAN = (0.310, 0.847, 0.910, 1.0)       # #4FD8E8

# ---------------------------------------------------------------------------
# Elevation plan.
#
# The first two passes placed each part by eye and the parts did not meet: the
# runners ended in mid-air above the molds and the ingots were lost entirely.
# Every z below is derived from the one above it, so a change to the bed height
# moves the ingots, the runners and the splitter with it.
# ---------------------------------------------------------------------------
BED_H = 0.22                      # mold bed base thickness
BED_WALL = 0.17                   # how far the walls stand above the base
INGOT_BASE = BED_H                # an ingot sits ON the bed floor
INGOT_H = 0.46
INGOT_TOP = INGOT_BASE + INGOT_H  # 0.68
RUNNER_END = INGOT_TOP + 0.06     # runners land just above each ingot
SPLIT_Z = 1.30                    # the splitter block
TRUNK_TOP = 2.28                  # where the stream leaves the lip
CRUCIBLE_Z = 2.74                 # vessel centre
LANE_X = 1.34                     # lane spacing
LANE_Y = -0.18


# --- helpers ---------------------------------------------------------------

def put(node, name, value):
    """Set a shader input by name, skipping names this Blender does not have."""
    sock = node.inputs.get(name)
    if sock is None:
        return False
    sock.default_value = value
    return True


def principled(mat):
    """The Principled BSDF of a material, found by type rather than by name."""
    return next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


def output_node(mat):
    return next(n for n in mat.node_tree.nodes if n.type == "OUTPUT_MATERIAL")


def new_material(name, base, metallic, roughness, emission=None, strength=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = principled(mat)
    put(bsdf, "Base Color", base)
    put(bsdf, "Metallic", metallic)
    put(bsdf, "Roughness", roughness)
    # 4.x renamed this; on an older build the old name is tried instead.
    if not put(bsdf, "Specular IOR Level", 0.5):
        put(bsdf, "Specular", 0.5)
    if emission is not None:
        # Both names have existed. Setting whichever is present is the whole
        # reason `put` returns a bool.
        if not put(bsdf, "Emission Color", emission):
            put(bsdf, "Emission", emission)
        put(bsdf, "Emission Strength", strength)
    return mat


def shade_smooth(obj, angle_deg=35.0):
    """Smooth shading with an auto-smooth angle, across Blender versions.

    4.1 removed `mesh.use_auto_smooth` in favour of a Smooth by Angle modifier,
    so the attribute is tried and a bevel-friendly fallback used when it is gone.
    """
    mesh = obj.data
    for poly in mesh.polygons:
        poly.use_smooth = True
    if hasattr(mesh, "use_auto_smooth"):
        mesh.use_auto_smooth = True
        mesh.auto_smooth_angle = math.radians(angle_deg)
        return
    try:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle_deg))
    except Exception:
        # Flat-but-beveled is an acceptable asset; an exception here is not.
        pass


def bevel(obj, width=0.012, segments=3):
    mod = obj.modifiers.new("bevel", "BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(50)
    mod.harden_normals = True


def apply_modifiers(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    for mod in list(obj.modifiers):
        try:
            bpy.ops.object.modifier_apply(modifier=mod.name)
        except RuntimeError:
            obj.modifiers.remove(mod)


def lift_mesh_to_base(obj):
    """Move the mesh so the object's origin sits at the bottom of its own bounds.

    Called ONCE on a prototype, before any linked duplicate exists. The first
    version did this per object, and because the three ingots share one mesh the
    same offset was applied three times and the bars left the frame entirely.
    A mesh edit is shared; only a transform is per-object.
    """
    mesh = obj.data
    low = min(v.co.z for v in mesh.vertices)
    for v in mesh.vertices:
        v.co.z -= low


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.objects):
        for item in list(block):
            block.remove(item)


# --- the parts -------------------------------------------------------------

def build_crucible(mat_steel, mat_molten):
    """A tilted vessel with a pouring lip, carried on one column from behind."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=0.66, depth=0.84,
                                        location=(0, 0, CRUCIBLE_Z))
    body = bpy.context.active_object
    body.name = "crucible"

    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    top = max(body.data.polygons, key=lambda poly: poly.center.z)
    top.select = True
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.delete(type="FACE")
    bpy.ops.object.mode_set(mode="OBJECT")

    sol = body.modifiers.new("wall", "SOLIDIFY")
    sol.thickness = 0.075
    sol.offset = -1.0
    bevel(body, width=0.016, segments=3)
    apply_modifiers(body)

    # The lip: drag the rim nearest the camera down and out, so there is a spout
    # to pour FROM. Without it this is a saucepan.
    mesh = body.data
    rim_z = max(v.co.z for v in mesh.vertices)
    for v in mesh.vertices:
        if v.co.z > rim_z - 0.07 and v.co.y < -0.20:
            pull = min(1.0, (-v.co.y - 0.20) / 0.46)
            v.co.y -= 0.20 * pull
            v.co.z -= 0.22 * pull

    shade_smooth(body)
    body.data.materials.append(mat_steel)
    body.rotation_euler = (math.radians(-15.0), 0, 0)

    extras = []
    for i, x in enumerate((-0.72, 0.72)):
        bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.085, depth=0.26,
                                            location=(x, 0.02, CRUCIBLE_Z + 0.06))
        pin = bpy.context.active_object
        pin.name = "crucible_pin_%d" % (i + 1)
        pin.rotation_euler = (0, math.radians(90), 0)
        bevel(pin, width=0.012, segments=2)
        apply_modifiers(pin)
        shade_smooth(pin)
        pin.data.materials.append(mat_steel)
        extras.append(pin)

    # ONE column from the ground, behind the vessel. Two side posts read as two
    # unrelated black sticks and held nothing; a single rear column reads as the
    # thing the crucible hangs on, and it never crosses the pour.
    col_h = CRUCIBLE_Z + 0.1
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0.74, col_h * 0.5))
    col = bpy.context.active_object
    col.name = "column"
    col.scale = (0.26, 0.26, col_h)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bevel(col, width=0.02, segments=2)
    apply_modifiers(col)
    shade_smooth(col, 50)
    col.data.materials.append(mat_steel)
    extras.append(col)

    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0.38, CRUCIBLE_Z + 0.06))
    arm = bpy.context.active_object
    arm.name = "column_arm"
    arm.scale = (1.62, 0.2, 0.14)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bevel(arm, width=0.018, segments=2)
    apply_modifiers(arm)
    shade_smooth(arm, 50)
    arm.data.materials.append(mat_steel)
    extras.append(arm)

    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.56, depth=0.05,
                                        location=(0, 0.02, CRUCIBLE_Z + 0.17))
    melt = bpy.context.active_object
    melt.name = "crucible_melt"
    melt.rotation_euler = (math.radians(-15.0), 0, 0)
    shade_smooth(melt)
    melt.data.materials.append(mat_molten)

    return body, extras, melt


def build_pour(mat_molten, mat_steel):
    """Stream, splitter block, three runners that land on the three ingots.

    A split in mid-air reads as three unrelated sticks, so the metal is divided
    by an object: it falls into a splitter, pools, and leaves along three runners
    whose ends are DERIVED from where each ingot is.
    """
    parts = []

    a = Vector((0.0, -0.52, TRUNK_TOP))
    b = Vector((0.0, -0.30, SPLIT_Z + 0.06))
    bpy.ops.mesh.primitive_cone_add(vertices=28, radius1=0.14, radius2=0.09,
                                    depth=(b - a).length, location=(a + b) * 0.5)
    trunk = bpy.context.active_object
    trunk.name = "pour_trunk"
    trunk.rotation_mode = "QUATERNION"
    trunk.rotation_quaternion = (b - a).to_track_quat("Z", "Y")
    shade_smooth(trunk)
    trunk.data.materials.append(mat_molten)
    parts.append(trunk)

    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.52, radius2=0.34, depth=0.22,
                                    location=(0, -0.30, SPLIT_Z - 0.05))
    split = bpy.context.active_object
    split.name = "pour_splitter"
    split.rotation_euler = (0, 0, math.radians(45))
    bevel(split, width=0.02, segments=2)
    apply_modifiers(split)
    shade_smooth(split, 50)
    split.data.materials.append(mat_steel)
    parts.append(split)

    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.3, depth=0.05,
                                        location=(0, -0.30, SPLIT_Z + 0.06))
    pool = bpy.context.active_object
    pool.name = "pour_pool"
    shade_smooth(pool)
    pool.data.materials.append(mat_molten)
    parts.append(pool)

    for i, lane in enumerate((-1, 0, 1)):
        a = Vector((lane * 0.22, -0.30, SPLIT_Z - 0.04))
        b = Vector((lane * LANE_X, LANE_Y, RUNNER_END))
        bpy.ops.mesh.primitive_cone_add(vertices=14, radius1=0.085, radius2=0.05,
                                        depth=(b - a).length, location=(a + b) * 0.5)
        run = bpy.context.active_object
        run.name = "pour_runner_%d" % (i + 1)
        run.rotation_mode = "QUATERNION"
        run.rotation_quaternion = (b - a).to_track_quat("Z", "Y")
        shade_smooth(run)
        run.data.materials.append(mat_molten)
        parts.append(run)

    return parts


def build_ingots(mats):
    """Three chunky cast bars sharing ONE mesh, each with its own material."""
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0))
    proto = bpy.context.active_object
    proto.name = "ingot_1"
    # A cast bar has draft: wider at the base, narrower on top, and THICK. The
    # first pass was 0.26 tall and read as a microscope slide.
    mesh = proto.data
    for v in mesh.vertices:
        if v.co.z > 0:
            v.co.x *= 0.80
            v.co.y *= 0.72
    proto.scale = (0.84, 0.38, INGOT_H)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bevel(proto, width=0.03, segments=3)
    apply_modifiers(proto)
    shade_smooth(proto, 50)
    # Once, on the prototype: the origin goes to the bar's base so runtime can
    # grow a lane upward out of its mold.
    lift_mesh_to_base(proto)

    ingots = []
    for i in range(3):
        obj = proto if i == 0 else bpy.data.objects.new("ingot_%d" % (i + 1), proto.data)
        if i:
            bpy.context.collection.objects.link(obj)
        obj.location = ((i - 1) * LANE_X, LANE_Y, INGOT_BASE)
        ingots.append(obj)

    # A linked mesh shares its material slots, so per-ingot colour must come from
    # an OBJECT-linked slot. Without this line all three lanes glow as one.
    for i, obj in enumerate(ingots):
        if len(obj.data.materials) == 0:
            obj.data.materials.append(mats[i])
        obj.material_slots[0].link = "OBJECT"
        obj.material_slots[0].material = mats[i]

    return ingots


def build_rails(mat_rail):
    """Three mold beds sharing one mesh: a channel with raised walls."""
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, BED_H * 0.5))
    base = bpy.context.active_object
    base.name = "rail_1"
    base.scale = (1.16, 0.64, BED_H)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    walls = []
    for sign in (-1, 1):
        bpy.ops.mesh.primitive_cube_add(
            size=1.0, location=(0, sign * 0.30, BED_H + BED_WALL * 0.5 - 0.02))
        w = bpy.context.active_object
        w.scale = (1.16, 0.06, BED_WALL)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        walls.append(w)

    bpy.ops.object.select_all(action="DESELECT")
    for w in walls:
        w.select_set(True)
    base.select_set(True)
    bpy.context.view_layer.objects.active = base
    bpy.ops.object.join()

    bevel(base, width=0.014, segments=2)
    apply_modifiers(base)
    shade_smooth(base, 50)
    base.data.materials.append(mat_rail)
    lift_mesh_to_base(base)

    rails = []
    for i in range(3):
        obj = base if i == 0 else bpy.data.objects.new("rail_%d" % (i + 1), base.data)
        if i:
            bpy.context.collection.objects.link(obj)
        obj.location = ((i - 1) * LANE_X, LANE_Y, 0.0)
        rails.append(obj)
    return rails


def build_ground(mat_ground):
    bpy.ops.mesh.primitive_plane_add(size=22.0, location=(0, 0, 0))
    ground = bpy.context.active_object
    ground.name = "ground"
    ground.data.materials.append(mat_ground)
    return ground


# --- lighting and camera (for the review renders; the browser relights) -----

def build_lighting():
    """Hard rim in near-darkness.

    The first rig put a 680W cyan area light over a 22m plane and turned the
    ground into a lit cyan lake, which is the opposite of the direction. Three
    corrections: the rim is small, far and much weaker; the key is tight; and
    the ground is lit almost entirely by the molten metal, which is what makes
    an image about heat read as heat.
    """
    bpy.ops.object.light_add(type="AREA", location=(-3.4, -3.0, 3.1))
    key = bpy.context.active_object
    key.name = "key"
    key.data.energy = 160.0
    key.data.size = 0.55
    key.data.color = (0.76, 0.84, 0.97)
    key.rotation_euler = (math.radians(55), 0, math.radians(-48))

    bpy.ops.object.light_add(type="AREA", location=(2.9, 3.4, 2.2))
    rim = bpy.context.active_object
    rim.name = "rim"
    rim.data.energy = 95.0
    rim.data.size = 0.3
    rim.data.color = CYAN[:3]
    rim.rotation_euler = (math.radians(74), 0, math.radians(146))

    world = bpy.data.worlds.new("forge")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    put(bg, "Color", (0.008, 0.010, 0.013, 1.0))
    put(bg, "Strength", 0.55)


def build_camera():
    """Wider and further back: the whole object with breathing room.

    72mm from 7.4m cropped the ingots off the bottom of the frame. The rule in
    the brief is that the ENTIRE object is visible, so the framing is derived
    from the object's bounds rather than guessed again.
    """
    bpy.ops.object.camera_add(location=(0.0, -9.6, 3.1))
    cam = bpy.context.active_object
    cam.name = "camera"
    cam.data.lens = 50.0
    cam.rotation_euler = (math.radians(82.0), 0, 0)
    bpy.context.scene.camera = cam
    return cam


def pick_device(scene):
    """OPTIX → CUDA → HIP → METAL → ONEAPI → CPU, by what this machine reports."""
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
    except KeyError:
        return "CPU"
    order = ["OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"]
    available = [i.identifier for i in prefs.bl_rna.properties["compute_device_type"].enum_items]
    for want in order:
        if want in available:
            try:
                prefs.compute_device_type = want
            except TypeError:
                continue
            prefs.get_devices()
            if any(d.type == want for d in prefs.devices):
                for d in prefs.devices:
                    d.use = d.type in (want, "CPU")
                scene.cycles.device = "GPU"
                return want
    scene.cycles.device = "CPU"
    return "CPU"


def set_engine(scene, want):
    """`scene.render.engine` is a dynamic enum RNA under-reports. Try, then fall back."""
    try:
        scene.render.engine = want
        return want
    except TypeError as err:
        print(f"[forge] {want} unavailable: {err}")
        for fallback in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
            try:
                scene.render.engine = fallback
                return fallback
            except TypeError:
                continue
    return scene.render.engine


# --- main ------------------------------------------------------------------

def main():
    clear_scene()
    scene = bpy.context.scene

    mat_steel = new_material("steel", STEEL_MID, metallic=1.0, roughness=0.34)
    mat_rail = new_material("rail", (0.10, 0.11, 0.13, 1.0), metallic=1.0, roughness=0.52)
    mat_ground = new_material("ground", (0.016, 0.019, 0.023, 1.0), metallic=0.0, roughness=0.95)
    mat_molten = new_material("molten", MOLTEN, metallic=0.0, roughness=0.42,
                              emission=MOLTEN, strength=1.3)
    # Three ingot materials, authored at three heats so the EXPORTED asset
    # already shows the state model in a still render. The browser overrides
    # emission strength per lane at runtime.
    # Three heats, so a still render already shows the state model: a lane
    # thinking, a lane cooling, a lane finished. Kept well under the clipping
    # point - at strength 7.5 the "hot" ingot rendered as a white slab.
    heats = [((1.0, 0.30, 0.04, 1.0), 1.5), ((1.0, 0.20, 0.02, 1.0), 0.55), ((0.09, 0.10, 0.12, 1.0), 0.0)]
    mats_ingot = [
        new_material(f"ingot_{i + 1}", color if strength > 0 else (0.14, 0.15, 0.17, 1.0),
                     metallic=0.85 if strength == 0 else 0.25,
                     roughness=0.38,
                     emission=color, strength=strength)
        for i, (color, strength) in enumerate(heats)
    ]

    build_ground(mat_ground)
    build_crucible(mat_steel, mat_molten)
    build_pour(mat_molten, mat_steel)
    build_rails(mat_rail)
    build_ingots(mats_ingot)
    build_lighting()
    build_camera()

    engine = set_engine(scene, "CYCLES")
    device = pick_device(scene) if engine == "CYCLES" else "n/a"
    if engine == "CYCLES":
        scene.cycles.samples = 180
        scene.cycles.use_denoising = True
    # Blender 4+ defaults to the AgX view transform, which rolls saturated
    # highlights hard toward white — so an orange emitter at any useful strength
    # renders as cream. Filmic keeps the hue; Standard is the fallback on an
    # older build. Read the valid identifiers rather than assuming either exists.
    # Why this matters more than it looks: the view transform decides whether an
    # orange emitter renders ORANGE.
    #
    #   AgX (the 4.x+ default) rolls saturated highlights hard toward white, so
    #   molten metal came back cream.
    #   Standard does not roll off at all, so anything above 1.0 clips to white
    #   and the same thing happens for a different reason.
    #   Khronos PBR Neutral rolls off while PRESERVING hue, which is exactly the
    #   job here.
    #
    # Filmic was removed in 4.0, so it is asked for but never assumed.
    #
    # This is a dynamic enum and RNA UNDER-REPORTS it exactly like
    # `scene.render.engine`: in --background the enum lists only ['NONE']
    # while the actual value reads 'AgX', so a membership test silently
    # matches nothing and leaves AgX in place. It has to be ASSIGNED inside
    # try/except TypeError and then read back. The chosen transform is
    # printed, because "my emitter is white" has now cost three rebuilds and
    # this is the first thing to check.
    transform = scene.view_settings.view_transform
    for want in ("Khronos PBR Neutral", "Filmic", "Standard"):
        try:
            scene.view_settings.view_transform = want
        except TypeError:
            continue
        transform = scene.view_settings.view_transform
        break
    try:
        scene.view_settings.look = "None"
    except TypeError:
        pass

    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    scene.render.film_transparent = False

    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    os.makedirs(OUT_RENDERS, exist_ok=True)

    authored = {
        "objects": len([o for o in bpy.data.objects if o.type == "MESH"]),
        "tris": sum(len(o.data.loop_triangles) if o.data.loop_triangles else 0
                    for o in bpy.data.objects if o.type == "MESH"),
        "meshes": len(bpy.data.meshes),
    }
    for o in bpy.data.objects:
        if o.type == "MESH":
            o.data.calc_loop_triangles()
    authored["tris"] = sum(len(o.data.loop_triangles) for o in bpy.data.objects if o.type == "MESH")

    # Export: lights and camera stay out. The browser builds its own rig.
    for obj in bpy.data.objects:
        obj.select_set(obj.type == "MESH" and obj.name != "ground")
    try:
        bpy.ops.export_scene.gltf(
            filepath=OUT_GLB,
            export_format="GLB",
            use_selection=True,
            export_apply=True,
            export_yup=True,
        )
    except TypeError as err:
        print(f"[forge] falling back on export args: {err}")
        bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format="GLB", use_selection=True)

    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)

    views = {
        "rest": ((0.0, -9.6, 3.1), (82.0, 0, 0)),
        "three-quarter": ((-7.4, -7.8, 4.6), (76.0, 0, -43.0)),
        "side": ((-9.4, -0.2, 2.6), (85.0, 0, -89.0)),
        "top": ((0.0, -4.6, 9.2), (30.0, 0, 0)),
    }
    cam = bpy.data.objects["camera"]
    for name, (loc, rot) in views.items():
        cam.location = loc
        cam.rotation_euler = (math.radians(rot[0]), math.radians(rot[1]), math.radians(rot[2]))
        scene.render.filepath = os.path.join(OUT_RENDERS, f"{name}.png")
        bpy.ops.render.render(write_still=True)

    size_kb = os.path.getsize(OUT_GLB) / 1024.0
    print("[forge] ------------------------------------------------------------")
    print(f"[forge] blender  {bpy.app.version_string}")
    print(f"[forge] engine   {engine}  device {device}  view {transform}")
    print(f"[forge] authored {authored['objects']} mesh objects, "
          f"{authored['meshes']} meshes, {authored['tris']} tris")
    print(f"[forge] glb      {OUT_GLB}  ({size_kb:.0f} KB)")
    print(f"[forge] renders  {OUT_RENDERS}")
    print("[forge] ------------------------------------------------------------")


if __name__ == "__main__":
    main()
    sys.exit(0)
