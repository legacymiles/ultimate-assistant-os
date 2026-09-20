"""Bake an AO map or a lightmap onto a dedicated second UV set, ready for Three.js.

    blender -b scene.blend --python bake_lightmap.py -- \
        --objects Hero,Ground --type AO --size 2048 --samples 256 --out baked/ --gltf-occlusion

    --type          AO | DIFFUSE | COMBINED   (DIFFUSE = direct+indirect light, no albedo)
    --objects       comma list; default = selected meshes, else every renderable mesh
    --size          square atlas edge in px (1024 / 2048 / 4096)
    --samples       Cycles samples (AO 256; DIFFUSE/COMBINED 512-1024, bakes are NOT denoised)
    --out           output folder: <name>.png (AO) or <name>.exr/.hdr (DIFFUSE/COMBINED) + <name>.json
    --light-rig     collection name: only the lights in it render for this bake (per-section rigs)
    --save-blend    the modified .blend copy (default <out>/<blend>_<name>.blend, one per bake,
                    so two bakes never overwrite each other; the source .blend is never written)
    --reuse-uv      keep an existing 'Lightmap' layer as-is (REQUIRED for every bake after the first)
    --gltf-occlusion  AO only: wire the AO into the glTF Material Output group's Occlusion socket
    --keep-uv-ref / --no-keep-uv-ref
                    make a material reference the 'Lightmap' UV so the glTF exporter writes
                    TEXCOORD_1 (a neutral white occlusion texture on that UV; no visual change).
                    Default ON unless --gltf-occlusion already references the UV.
    --ao-distance   AO ray length in metres (scene.world.light_settings.distance); default: untouched
    --export-glb    export the final state to a .glb and verify TEXCOORD_<n> (fails loudly)
    --verify-glb    verify a .glb/.gltf after the bake; also runs WITHOUT Blender:
                    python bake_lightmap.py --verify-glb out.glb [--uv-index 1] [--meshes a,b | @baked/x.json]
                    Always pass --meshes @<manifest>: without it EVERY primitive must carry TEXCOORD_1.
    --normalize 8|16  light bakes: also write <name>_norm.png = map / max, sRGB-encoded, top row
                    first; the manifest records maxValue (three: lightMapIntensity = pi * maxValue)

Two bakes (AO + light) = run sequentially, the second on the first one's saved copy:
    blender -b world.blend --python-exit-code 1 --python bake_lightmap.py -- --type AO --gltf-occlusion \
        --out baked --save-blend baked/world_ao.blend
    blender -b baked/world_ao.blend --python-exit-code 1 --python bake_lightmap.py -- --type DIFFUSE --reuse-uv \
        --out baked --save-blend baked/world_ao_light.blend --export-glb baked/world.glb

What it does, in order:
  1. Cycles + best GPU (OPTIX -> CUDA -> HIP -> METAL -> ONEAPI -> CPU, see blender_device.py).
  2. Makes shared meshes single-user (a lightmap needs unique UVs per object).
  3. Adds a UV layer named 'Lightmap' (UV index 1 -> glTF TEXCOORD_1), makes it ACTIVE for baking
     while the original UV0 stays active_render, and packs every object into ONE atlas.
  4. Creates the target image (float for light, 8-bit Non-Color for AO) and puts an UNLINKED
     Image Texture node, set as nodes.active, in every material of every object.
  5. Bakes with margin, saves, removes the temp nodes, wires the UV reference, restores UV0 as
     active, tags every baked object AND its mesh with a custom property (lightmap / aomap =
     image name; exported as glTF extras -> three.js userData, so the page never matches on
     names, which GLTFLoader sanitizes and dedupes), saves the .blend copy, writes a manifest
     (incl. the per-format three.js flipY and each object's sanitized three.js name),
     optionally exports (with export_extras) + verifies the GLB.

Nodes are always found by TYPE, never by name (names are localized on non-English UIs), and
enum values are validated against RNA (or try-assigned) before use: Blender 4.2 through 5.x.
"""

import argparse
import json
import math
import os
import re
import struct
import sys
import zlib

try:
    import bpy  # only available inside Blender
except ImportError:  # lets `python -m py_compile` and the standalone --verify-glb work
    bpy = None

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

GROUP_NAMES = ("glTF Material Output", "glTF Settings")  # data names the glTF exporter looks up
TAG_AO, TAG_REF = "B2W_AO", "B2W_UVRef"                  # node labels this script owns

# three.js flipY per saved format when the texture is sampled with glTF UVs (TEXCOORD_n):
# glTF v=0 is the image TOP. Blender writes PNG/EXR/HDR top row first on disk.
#   PNG via TextureLoader : loader default true  -> set false (memory top-down)
#   KTX2 (toktx default)  : CompressedTexture, false and cannot be flipped
#   HDR via HDRLoader/RGBELoader : loader sets true  -> set false (memory top-down)
#   EXR via EXRLoader     : loader stores rows BOTTOM-up and sets false -> set TRUE
FLIP_Y = {".png": False, ".ktx2": False, ".hdr": False, ".exr": True}
TAG_KEY = {"AO": "aomap", "DIFFUSE": "lightmap", "COMBINED": "lightmap"}  # custom prop -> glTF extras
_RESERVED = re.compile(r"[\[\]\.:/]")


def three_name(name):
    """GLTFLoader's name for a glTF node/mesh: PropertyBinding.sanitizeNodeName (three 0.171):
    whitespace -> '_', then [ ] . : / removed. Duplicates later get _1, _2 (not predictable here)."""
    return _RESERVED.sub("", re.sub(r"\s", "_", name or ""))
LOADER = {".png": "TextureLoader", ".ktx2": "KTX2Loader",
          ".hdr": "HDRLoader (RGBELoader before r180)", ".exr": "EXRLoader"}


# ---------------------------------------------------------------- helpers

def script_argv():
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1:]
    return [] if bpy is not None else sys.argv[1:]


def parse_args(argv):
    p = argparse.ArgumentParser(description="Bake AO / lightmap to a second UV set")
    p.add_argument("--objects", default="", help="comma-separated object names")
    p.add_argument("--type", default="AO", help="AO | DIFFUSE | COMBINED")
    p.add_argument("--size", type=int, default=2048)
    p.add_argument("--samples", type=int, default=None, help="default AO 256, light 512")
    p.add_argument("--out", default="baked")
    p.add_argument("--name", default="", help="image base name (default lightmap_<type>)")
    p.add_argument("--uv-name", default="Lightmap")
    p.add_argument("--margin", type=int, default=None, help="bake bleed px (default 8 per 2048)")
    p.add_argument("--pack-margin", type=float, default=0.1,
                   help="lightmap_pack margin (fraction of an island cell), 0.05-0.3")
    p.add_argument("--reuse-uv", action="store_true", help="keep an existing Lightmap layer as-is")
    p.add_argument("--exr", choices=["half", "full"], default="half")
    p.add_argument("--hdr", action="store_true", help="save Radiance .hdr instead of .exr")
    p.add_argument("--gltf-occlusion", action="store_true",
                   help="AO only: wire the baked map into a glTF Material Output group")
    p.add_argument("--keep-uv-ref", action=argparse.BooleanOptionalAction, default=None,
                   help="reference the Lightmap UV from a neutral occlusion texture (default on)")
    p.add_argument("--ao-distance", type=float, default=None,
                   help="AO ray distance in metres (world light_settings.distance)")
    p.add_argument("--keep-nodes", action="store_true", help="leave the bake image nodes in place")
    p.add_argument("--save-blend", default="", help="path for the modified .blend copy")
    p.add_argument("--light-rig", default="",
                   help="collection name: only LIGHT objects inside it (and its children) render "
                        "during this bake; other lights are hidden for the bake and restored after. "
                        "One DIFFUSE bake per rig on the SAME UVs (--reuse-uv) = blendable lightmaps")
    p.add_argument("--export-glb", default="", help="export the result and verify TEXCOORD_n")
    p.add_argument("--verify-glb", default="", help="verify an existing .glb/.gltf and exit")
    p.add_argument("--uv-index", type=int, default=1, help="(verify only) expected TEXCOORD index")
    p.add_argument("--meshes", default="", help="(verify only) comma list of glTF mesh names, or "
                   "@manifest.json to use the names a bake recorded; named meshes that are missing "
                   "(merged/renamed) FAIL the check. Without it EVERY primitive must carry TEXCOORD_n")
    p.add_argument("--normalize", type=int, choices=[8, 16], default=None,
                   help="light bakes: also write <name>_norm.png (map / max, sRGB-encoded, 8 or 16 "
                        "bit) and record maxValue in the manifest; ship it as UASTC KTX2")
    return p.parse_args(argv)


def enum_ids(rna_struct, prop):
    try:
        return [i.identifier for i in rna_struct.bl_rna.properties[prop].enum_items]
    except (KeyError, AttributeError):
        return []


def op_enum_ids(op, prop):
    try:
        return [i.identifier for i in op.get_rna_type().properties[prop].enum_items]
    except (KeyError, AttributeError):
        return []


def op_accepts(op, prop):
    try:
        return prop in op.get_rna_type().properties.keys()
    except AttributeError:
        return False


def set_colorspace(image, want):
    """Try-assign colorspace names in order; the enum is dynamic (OCIO config), so RNA may list
    nothing in background mode. A wrong name raises TypeError, which lists the valid ones."""
    tries = (("Non-Color", "Raw", "Generic Data", "Data") if want == "non"
             else ("Linear Rec.709", "Linear", "Linear sRGB", "Linear CIE-XYZ D65"))
    last = None
    for name in tries:
        try:
            image.colorspace_settings.name = name
            return name
        except TypeError as err:
            last = err
    for name in enum_ids(image.colorspace_settings, "name"):  # last resort: scan RNA
        low = name.lower().replace("-", "").replace(" ", "")
        if (want == "non" and low in ("noncolor", "raw")) or (
                want != "non" and low.startswith("linear") and "srgb" not in low):
            try:
                image.colorspace_settings.name = name
                return name
            except TypeError as err:
                last = err
    print(f"[bake] WARNING could not set a {want} colorspace on {image.name}: {last}")
    return None


def target_objects(names):
    scene = bpy.context.scene
    if names:
        objs = []
        for n in [s.strip() for s in names.split(",") if s.strip()]:
            ob = bpy.data.objects.get(n)
            if ob is None:
                raise SystemExit(f"[bake] object not found: {n}")
            if ob.type != "MESH":
                raise SystemExit(f"[bake] not a mesh: {n} ({ob.type})")
            objs.append(ob)
        return objs
    sel = [o for o in bpy.context.selected_objects if o.type == "MESH"]
    if sel:
        return sel
    return [o for o in scene.objects if o.type == "MESH" and not o.hide_render]


def ensure_object_mode():
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")


def select_only(objs):
    vl = bpy.context.view_layer
    missing = [o.name for o in objs if vl.objects.get(o.name) is None]
    if missing:
        raise SystemExit(
            f"[bake] not in the active view layer '{vl.name}': {', '.join(missing)}. Link them to a "
            "collection of this scene and make sure the collection is not excluded (checkbox in "
            "the Outliner), or switch the view layer before baking.")
    for o in vl.objects:
        o.select_set(False)
    for o in objs:
        o.hide_viewport = False  # object-level "disable in viewports" blocks select_set and bake
        o.hide_set(False)        # view-layer hide (eye icon)
        o.hide_select = False
        o.select_set(True)
    vl.objects.active = objs[0]


def ensure_material_nodes(mat):
    # Blender 5.x always uses nodes and deprecates use_nodes; older versions need it set.
    try:
        if hasattr(mat, "use_nodes") and not mat.use_nodes:
            mat.use_nodes = True
    except (AttributeError, TypeError):
        pass
    return mat.node_tree


def unique_materials(objs):
    seen = set()
    for ob in objs:
        for slot in ob.material_slots:
            mat = slot.material
            if mat is not None and mat.name not in seen:
                seen.add(mat.name)
                yield mat


# ---------------------------------------------------------------- stages

def make_single_user(objs):
    seen = {}
    for ob in objs:
        if ob.data.users > 1 or ob.data.name in seen:
            print(f"[bake] {ob.name}: mesh shared by {ob.data.users} users -> single-user copy "
                  "(GPU instancing of this mesh is lost; bake AO per unique mesh if you need it)")
            ob.data = ob.data.copy()
        seen[ob.data.name] = ob


def prepare_uvs(objs, uv_name, reuse):
    """Create the Lightmap layer, keep UV0 as active_render, make Lightmap active for baking."""
    info = []
    for ob in objs:
        me = ob.data
        layers = me.uv_layers
        if len(layers) == 0:
            print(f"[bake] {ob.name}: no UV0 found, creating 'UVMap' (unwrap it for textures later)")
            layers.new(name="UVMap")
        render_layer = next((l for l in layers if l.active_render), layers[0])
        lm = layers.get(uv_name)
        created = lm is None
        if created:
            if reuse:
                print(f"[bake] WARNING {ob.name}: --reuse-uv but no '{uv_name}' layer; creating one "
                      "(the atlas is re-packed, so an EARLIER bake no longer matches these UVs)")
            lm = layers.new(name=uv_name, do_init=True)
            if lm is None:
                raise SystemExit(f"[bake] {ob.name}: cannot add another UV layer (limit is 8)")
        render_layer.active_render = True  # UV0 keeps driving albedo/normal textures
        layers.active = lm                 # bake + unwrap operate on the ACTIVE layer
        idx = list(layers).index(lm)
        if idx != 1:
            print(f"[bake] WARNING {ob.name}: '{uv_name}' is UV index {idx}, glTF will write "
                  f"TEXCOORD_{idx}; set texture.channel = {idx} in three.js or delete extra UVs")
        info.append({"object": ob.name, "mesh": me.name, "uv_index": idx, "created": created,
                     "threeName": three_name(ob.name), "threeMeshName": three_name(me.name)})
    return info, not reuse or any(i["created"] for i in info)


def unwrap_lightmap(objs, pack_margin):
    select_only(objs)
    ensure_object_mode()
    op = bpy.ops.uv.lightmap_pack
    kwargs = {"PREF_CONTEXT": "ALL_FACES", "PREF_PACK_IN_ONE": True,
              "PREF_NEW_UVLAYER": False, "PREF_MARGIN_DIV": pack_margin}
    kwargs = {k: v for k, v in kwargs.items() if op_accepts(op, k)}
    try:
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        res = op(**kwargs)
        bpy.ops.object.mode_set(mode="OBJECT")
        if "FINISHED" in res:
            print("[bake] lightmap_pack: all objects packed into one atlas")
            return "lightmap_pack"
    except (RuntimeError, TypeError) as err:
        print("[bake] lightmap_pack failed, falling back to smart_project:", err)
        ensure_object_mode()
    # fallback: smart project in multi-object edit mode, then one shared pack
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    sp = {"angle_limit": math.radians(66), "island_margin": 0.02}
    bpy.ops.uv.smart_project(**{k: v for k, v in sp.items() if op_accepts(bpy.ops.uv.smart_project, k)})
    pk = {"margin": 0.01, "rotate": True}
    bpy.ops.uv.pack_islands(**{k: v for k, v in pk.items() if op_accepts(bpy.ops.uv.pack_islands, k)})
    bpy.ops.object.mode_set(mode="OBJECT")
    return "smart_project"


def make_image(name, size, is_float):
    old = bpy.data.images.get(name)
    if old is not None:
        bpy.data.images.remove(old)
    img = bpy.data.images.new(name, width=size, height=size, alpha=False, float_buffer=is_float)
    set_colorspace(img, "linear" if is_float else "non")  # before baking: Cycles writes in it
    img.generated_color = (0.0, 0.0, 0.0, 1.0)
    return img


def neutral_white_image():
    """4x4 white Non-Color image, packed, used only to reference the Lightmap UV."""
    name = "B2W_UVRef_White"
    img = bpy.data.images.get(name)
    if img is None:
        img = bpy.data.images.new(name, width=4, height=4, alpha=False, float_buffer=False)
        img.generated_color = (1.0, 1.0, 1.0, 1.0)
        set_colorspace(img, "non")
        try:
            img.pixels[:] = [1.0] * (4 * 4 * 4)
            img.pack()  # embedded, so the .blend copy and the GLB exporter both find pixels
        except (RuntimeError, AttributeError, TypeError) as err:
            print("[bake] note: could not pack the neutral image (exporter reads pixels):", err)
    return img


def add_bake_nodes(objs, img):
    """Unlinked Image Texture node, set active, in every material slot. Returns created nodes."""
    for ob in objs:
        if len(ob.material_slots) == 0:
            ob.data.materials.append(bpy.data.materials.new(f"B2W_Bake_{ob.name}"))
            print(f"[bake] {ob.name}: had no material, added a default one (replace before export)")
        for slot in ob.material_slots:
            if slot.material is None:
                slot.material = bpy.data.materials.new(f"B2W_Bake_{ob.name}")
    created = []
    for mat in unique_materials(objs):
        nt = ensure_material_nodes(mat)
        for n in nt.nodes:
            n.select = False
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = img
        node.location = (-600, -400)
        node.select = True
        nt.nodes.active = node  # the bake writes into the ACTIVE image node
        created.append((nt, node))
    return created


def set_ao_distance(scene, dist):
    world = scene.world
    if world is None:
        world = bpy.data.worlds.new("World")
        scene.world = world
    try:
        world.light_settings.distance = dist
        print(f"[bake] AO distance = {dist} m (world.light_settings.distance)")
    except AttributeError as err:
        print("[bake] WARNING could not set AO distance:", err)


def run_bake(kind, margin):
    scene = bpy.context.scene
    op = bpy.ops.object.bake
    valid_types = op_enum_ids(op, "type")
    if valid_types and kind not in valid_types:
        raise SystemExit(f"[bake] type {kind} not in {valid_types}")
    kwargs = {"type": kind, "margin": margin, "use_clear": True, "use_selected_to_active": False}
    if op_accepts(op, "target") and "IMAGE_TEXTURES" in op_enum_ids(op, "target"):
        kwargs["target"] = "IMAGE_TEXTURES"
    if op_accepts(op, "margin_type") and "EXTEND" in op_enum_ids(op, "margin_type"):
        kwargs["margin_type"] = "EXTEND"
    if kind == "DIFFUSE":
        # light only: albedo stays in the base-color texture (UV0) and is multiplied at runtime
        filt = {"DIRECT", "INDIRECT"}
        valid_filt = set(op_enum_ids(op, "pass_filter"))
        kwargs["pass_filter"] = filt & valid_filt if valid_filt else filt
    try:
        scene.render.bake.margin = margin
    except AttributeError:
        pass
    print("[bake] bpy.ops.object.bake", kwargs)
    res = op(**kwargs)
    if "FINISHED" not in res:
        raise SystemExit(f"[bake] bake did not finish: {res}")


def save_image(img, out_dir, is_float, args):
    os.makedirs(out_dir, exist_ok=True)
    formats = enum_ids(bpy.context.scene.render.image_settings, "file_format")
    if not is_float:
        fmt, ext = "PNG", ".png"
    elif args.hdr and ("HDR" in formats or not formats):
        fmt, ext = "HDR", ".hdr"
    else:
        fmt, ext = "OPEN_EXR", ".exr"
    path = os.path.join(os.path.abspath(out_dir), img.name + ext)
    img.filepath_raw = path
    img.file_format = fmt
    if fmt == "OPEN_EXR" and hasattr(img, "use_half_precision"):
        img.use_half_precision = args.exr == "half"
    img.save()
    print("[bake] saved", path)
    return path, ext


def gltf_group():
    ng = next((bpy.data.node_groups.get(n) for n in GROUP_NAMES if bpy.data.node_groups.get(n)), None)
    if ng is None:
        ng = bpy.data.node_groups.new(GROUP_NAMES[0], "ShaderNodeTree")
    if hasattr(ng, "interface"):  # Blender 4.0+
        names = [s.name for s in ng.interface.items_tree if getattr(s, "in_out", "") == "INPUT"]
        if "Occlusion" not in names:
            ng.interface.new_socket(name="Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    elif "Occlusion" not in ng.inputs:
        ng.inputs.new("NodeSocketFloat", "Occlusion")
    return ng


def occlusion_uses_uv(sock, uv_name):
    """True if the Occlusion socket is fed by an image whose vector comes from UV Map <uv_name>."""
    for link in sock.links:
        tex = link.from_node
        if tex.type != "TEX_IMAGE":
            continue
        for l2 in tex.inputs[0].links:
            if l2.from_node.type == "UVMAP" and l2.from_node.uv_map == uv_name:
                return True
    return False


def wire_occlusion(objs, img, uv_name, tag, replace):
    """Image (on UV <uv_name>) -> 'glTF Material Output'.Occlusion in every material.

    The glTF exporter writes occlusionTexture with texCoord = index of <uv_name>, which also
    forces TEXCOORD_<n> into the file. GLTFLoader then sets aoMap with channel n.
    The group is looked up by its data name (not localized), so this is safe on any UI language.
    replace=False keeps an existing Occlusion link (e.g. a real AO already wired).
    """
    ng = gltf_group()
    wired, feeds = 0, set()
    for mat in unique_materials(objs):
        nt = ensure_material_nodes(mat)
        grp = next((n for n in nt.nodes if n.type == "GROUP" and n.node_tree == ng), None)
        if grp is None:
            grp = nt.nodes.new("ShaderNodeGroup")
            grp.node_tree = ng
            grp.location = (300, -400)
        sock = grp.inputs["Occlusion"]
        if sock.is_linked and not replace:
            if not occlusion_uses_uv(sock, uv_name):
                print(f"[bake] WARNING {mat.name}: Occlusion is wired to another UV; TEXCOORD for "
                      f"'{uv_name}' may be missing (check the verify step)")
            feeds.update(l.from_node.label or "user" for l in sock.links)
            continue
        for link in list(sock.links):
            nt.links.remove(link)
        for n in [n for n in nt.nodes if n.label in (TAG_AO, TAG_REF)]:
            nt.nodes.remove(n)  # drop our earlier neutral/AO nodes before re-wiring
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image, tex.label, tex.location = img, tag, (-300, -600)
        uvn = nt.nodes.new("ShaderNodeUVMap")
        uvn.uv_map, uvn.label, uvn.location = uv_name, tag, (-500, -600)
        nt.links.new(uvn.outputs[0], tex.inputs[0])  # UV -> Vector (by index, not name)
        nt.links.new(tex.outputs[0], sock)           # Color -> Occlusion (R used)
        wired += 1
        feeds.add(tag)
    print(f"[bake] {tag}: wired {wired} material(s) into glTF Material Output.Occlusion "
          f"(texCoord = '{uv_name}')")
    return feeds


def uv_ref_kind(feeds):
    """What now feeds Occlusion: 'ao-occlusion' | 'neutral-occlusion' | 'mixed' | None."""
    if not feeds:
        return None
    if feeds == {TAG_AO}:
        return "ao-occlusion"
    if feeds == {TAG_REF}:
        return "neutral-occlusion"
    return "mixed"


def tag_objects(objs, key, image_name):
    """Custom property on the object (-> glTF node extras) and on its mesh data (-> glTF mesh
    extras). GLTFLoader copies node extras onto the node and mesh extras onto EVERY primitive
    mesh, so a multi-material object (a Group of meshes in three) is tagged on each child too."""
    for ob in objs:
        ob[key] = image_name
        ob.data[key] = image_name
    print(f"[bake] tagged {len(objs)} object(s) + mesh(es): {key} = '{image_name}' "
          "(glTF extras -> three.js userData; export with Custom Properties / export_extras)")


def write_png(path, width, height, rows, bits):
    """Minimal RGB PNG writer (no Blender colour management involved). rows: top row first,
    each a flat sequence of 0..(2**bits - 1) ints, length width * 3."""
    raw = bytearray()
    for row in rows:
        raw.append(0)  # filter type 0 (None)
        if bits == 16:
            raw += struct.pack(f">{width * 3}H", *row)
        else:
            raw += bytes(row)

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))
    ihdr = struct.pack(">IIBBBBB", width, height, bits, 2, 0, 0, 0)  # colour type 2 = RGB
    with open(path, "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
                 + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))


def srgb_encode(x):
    """numpy array of linear 0..1 -> sRGB-encoded 0..1 (the curve three decodes for SRGBColorSpace)."""
    import numpy as np
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(np.maximum(x, 0.0031308), 1 / 2.4) - 0.055)


def normalize_to_png(img, out_dir, bits):
    """Float lightmap -> <name>_norm.png: RGB / max, sRGB-encoded, top row first on disk.
    Returns (path, maxValue). Blender's pixel buffer is bottom row first, so rows are flipped."""
    import numpy as np  # bundled with Blender
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    rgb = px.reshape(h, w, 4)[::-1, :, :3]  # bottom-up -> top-down
    rgb = np.nan_to_num(np.maximum(rgb, 0.0))
    peak = float(rgb.max())
    if peak <= 0.0:
        raise SystemExit("[bake] --normalize: the lightmap is black (nothing lit it)")
    p999 = float(np.percentile(rgb, 99.9))
    if p999 > 0 and peak > 20 * p999:
        print(f"[bake] WARNING --normalize: max {peak:.3g} is {peak / p999:.0f}x the 99.9th "
              "percentile (fireflies). Denoise first, or the whole map gets dark and coarse.")
    top = (1 << bits) - 1
    enc = np.clip(np.rint(srgb_encode(rgb / peak) * top), 0, top)
    enc = enc.astype(np.uint16 if bits == 16 else np.uint8)
    path = os.path.join(os.path.abspath(out_dir), img.name + "_norm.png")
    write_png(path, w, h, (enc[y].reshape(-1).tolist() for y in range(h)), bits)
    print(f"[bake] saved {path} ({bits}-bit, sRGB-encoded, maxValue {peak:.5g})")
    return path, peak


# ---------------------------------------------------------------- GLB export + verification

def read_gltf_json(path):
    with open(path, "rb") as fh:
        data = fh.read()
    if data[:4] == b"glTF":
        _magic, _version, _length = struct.unpack_from("<4sII", data, 0)
        chunk_len, chunk_type = struct.unpack_from("<I4s", data, 12)
        if chunk_type != b"JSON":
            raise SystemExit(f"[verify] {path}: first GLB chunk is not JSON")
        return json.loads(data[20:20 + chunk_len].decode("utf-8"))
    return json.loads(data.decode("utf-8"))


def verify_glb(path, uv_index=1, mesh_names=None, strict_names=False):
    """Fail loudly (SystemExit, exit code 1) if any checked primitive lacks TEXCOORD_<uv_index>.

    strict_names: also fail when a named mesh is missing (merged/renamed by an optimizer). A merged
    mesh still carries TEXCOORD_1, so the attribute check alone cannot catch that.

    Works on Draco/Meshopt files too (attribute names stay in the JSON). No Blender needed.
    """
    gltf = read_gltf_json(path)
    attr = f"TEXCOORD_{uv_index}"
    meshes = gltf.get("meshes", [])
    wanted = set(mesh_names or [])
    checked = [m for m in meshes if not wanted or m.get("name") in wanted]
    gone = sorted(wanted - {m.get("name") for m in meshes})
    if gone and strict_names:
        raise SystemExit(
            f"[verify] FAIL {path}: {len(gone)} baked mesh(es) not found by name: "
            f"{', '.join(gone[:12])}{' ...' if len(gone) > 12 else ''}. "
            "They were merged or renamed (gltf-transform optimize joins/flattens by default). For "
            "lightmapped assets run optimize with --join false --flatten false --simplify false "
            "--instance false.")
    if gone:
        print(f"[verify] note: {len(gone)} name(s) not found as glTF meshes: {', '.join(gone[:12])}")
    if wanted and not checked:
        print(f"[verify] none of {sorted(wanted)} found by name; checking all {len(meshes)} meshes")
        checked = meshes
    if wanted:
        pairs = [f"{m.get('name')} -> {three_name(m.get('name'))}" for m in checked
                 if m.get("name") != three_name(m.get("name"))]
        if pairs:
            print(f"[verify] three.js renames {len(pairs)} mesh(es) (sanitizeNodeName; duplicates "
                  f"also get _1, _2): {', '.join(pairs[:12])}")
    tag_keys = set(TAG_KEY.values())
    tagged = [n.get("name", "?") for n in gltf.get("nodes", [])
              if isinstance(n.get("extras"), dict) and set(n["extras"]) & tag_keys]
    tagged_meshes = [m for m in meshes
                     if isinstance(m.get("extras"), dict) and set(m["extras"]) & tag_keys]
    if tagged or tagged_meshes:
        print(f"[verify] extras: {len(tagged)} node(s) and {len(tagged_meshes)} mesh(es) carry a "
              "lightmap/aomap tag (three.js userData.lightmap / userData.aomap); nodes as three.js "
              f"names them: {', '.join(three_name(n) for n in tagged[:12])}")
    elif wanted:
        print("[verify] WARNING no node or mesh carries a lightmap/aomap extras tag: the page must "
              "fall back to sanitized names (export with Custom Properties / export_extras=True)")
    missing = [f"{m.get('name', '?')}[{i}]" for m in checked
               for i, prim in enumerate(m.get("primitives", []))
               if attr not in prim.get("attributes", {})]
    if missing or not checked:
        raise SystemExit(
            f"[verify] FAIL {path}: {attr} missing on {len(missing)} primitive(s): "
            f"{', '.join(missing[:12])}{' ...' if len(missing) > 12 else ''}\n"
            "  Fix: re-run the bake with --keep-uv-ref (default) or --gltf-occlusion, export from the "
            "saved .blend copy, keep the 'Lightmap' UV (apply modifiers that rewrite UVs first).")
    print(f"[verify] OK {path}: {attr} on all {sum(len(m.get('primitives', [])) for m in checked)} "
          f"primitive(s) of {len(checked)} mesh(es)")
    return True


def isolate_light_rig(scene, rig_name):
    """Render only the lights inside collection `rig_name` (recursively); return a restore()."""
    rig = bpy.data.collections.get(rig_name)
    if rig is None:
        raise SystemExit(f"[bake] --light-rig: no collection named '{rig_name}' "
                         f"(have: {', '.join(c.name for c in bpy.data.collections)})")
    keep = set(o.name for o in rig.all_objects if o.type == "LIGHT")
    if not keep:
        raise SystemExit(f"[bake] --light-rig: collection '{rig_name}' holds no LIGHT objects")
    saved = {}
    for ob in scene.objects:
        if ob.type == "LIGHT":
            saved[ob.name] = ob.hide_render
            ob.hide_render = ob.name not in keep
    print(f"[bake] light rig '{rig_name}': {', '.join(sorted(keep))} "
          f"(hidden for this bake: {len(saved) - len(keep)}; world + emissive meshes still light)")

    def restore():
        for n, v in saved.items():
            ob = scene.objects.get(n)
            if ob is not None:
                ob.hide_render = v
    return restore


def mesh_list(spec):
    """'a,b' -> ['a', 'b']; '@baked/x.json' -> the mesh names recorded in a bake manifest."""
    spec = (spec or "").strip()
    if spec.startswith("@"):
        with open(spec[1:], encoding="utf-8") as fh:
            return [o["mesh"] for o in json.load(fh).get("objects", []) if o.get("mesh")]
    return [s.strip() for s in spec.split(",") if s.strip()]


def export_glb(path):
    op = bpy.ops.export_scene.gltf
    kwargs = {"filepath": os.path.abspath(path), "export_format": "GLB", "export_texcoords": True,
              "export_normals": True, "export_yup": True, "export_apply": True,
              "export_extras": True}  # custom properties -> glTF extras -> three.js userData
    if "EXPORT" in op_enum_ids(op, "export_materials"):
        kwargs["export_materials"] = "EXPORT"
    os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
    if not op_accepts(op, "export_extras"):
        print("[bake] WARNING this glTF exporter has no export_extras: the lightmap tags are not "
              "exported; the page must match on sanitized names (manifest threeName)")
    op(**{k: v for k, v in kwargs.items() if op_accepts(op, k)})
    print("[bake] exported", path)


# ---------------------------------------------------------------- main

def main():
    args = parse_args(script_argv())
    if bpy is None:  # plain Python: verification only
        if not args.verify_glb:
            raise SystemExit("Run inside Blender: blender -b file.blend --python bake_lightmap.py -- ...\n"
                             "(outside Blender only --verify-glb works)")
        names = mesh_list(args.meshes)
        verify_glb(args.verify_glb, args.uv_index, names, strict_names=bool(names))
        return
    kind = args.type.upper()
    is_float = kind != "AO"
    scene = bpy.context.scene
    samples = args.samples or (256 if kind == "AO" else 512)
    margin = args.margin if args.margin is not None else max(4, round(8 * args.size / 2048))

    from blender_device import select_cycles_device
    backend = select_cycles_device(scene)
    scene.cycles.samples = max(1, samples)
    if args.ao_distance is not None:
        set_ao_distance(scene, args.ao_distance)

    ensure_object_mode()
    objs = target_objects(args.objects)
    if not objs:
        raise SystemExit("[bake] no mesh objects to bake")
    print("[bake] objects:", ", ".join(o.name for o in objs))

    make_single_user(objs)
    uv_info, needs_unwrap = prepare_uvs(objs, args.uv_name, args.reuse_uv)
    unwrap = unwrap_lightmap(objs, args.pack_margin) if needs_unwrap else "reused"
    for ob in objs:  # unwrap may have changed the active layer; re-assert
        ob.data.uv_layers.active = ob.data.uv_layers[args.uv_name]

    name = args.name or f"lightmap_{kind.lower()}"
    img = make_image(name, args.size, is_float)
    nodes = add_bake_nodes(objs, img)
    select_only(objs)
    restore_lights = isolate_light_rig(scene, args.light_rig) if args.light_rig else None
    try:
        run_bake(kind, margin)
    finally:
        if restore_lights:
            restore_lights()
    path, ext = save_image(img, args.out, is_float, args)
    norm = None
    if args.normalize and not is_float:
        print("[bake] --normalize ignored: AO is already 0..1")
    elif args.normalize:
        norm_path, peak = normalize_to_png(img, args.out, args.normalize)
        norm = {"image": os.path.basename(norm_path), "bits": args.normalize, "maxValue": round(peak, 6),
                "loader": "KTX2Loader after toktx --assign_oetf srgb (ship), or TextureLoader (8-bit)",
                "flipY": False, "colorSpace": "SRGBColorSpace",
                "lightMapIntensity": round(math.pi * peak, 5)}

    if not args.keep_nodes:
        for nt, node in nodes:
            nt.nodes.remove(node)

    uv_ref = None
    ao_wired = args.gltf_occlusion and not is_float
    if args.gltf_occlusion and is_float:
        print("[bake] --gltf-occlusion ignored: only AO belongs in glTF occlusion")
    if ao_wired:
        uv_ref = uv_ref_kind(wire_occlusion(objs, img, args.uv_name, TAG_AO, replace=True))
    keep_ref = (not ao_wired) if args.keep_uv_ref is None else args.keep_uv_ref
    if keep_ref and not ao_wired:  # keeps an AO wired by an earlier run (sequential workflow)
        uv_ref = uv_ref_kind(wire_occlusion(objs, neutral_white_image(), args.uv_name, TAG_REF,
                                            replace=False))
    elif not ao_wired:
        print("[bake] WARNING --no-keep-uv-ref: nothing references the Lightmap UV, the glTF "
              "exporter may drop TEXCOORD_1 (the verify step will tell)")

    tag_objects(objs, TAG_KEY[kind], name)

    for ob in objs:  # restore UV0 as active so later edits/exports behave normally
        layers = ob.data.uv_layers
        layers.active = next((l for l in layers if l.active_render), layers[0])

    blend = bpy.data.filepath
    stem = os.path.splitext(os.path.basename(blend))[0] if blend else "untitled"
    save_blend = os.path.abspath(args.save_blend or os.path.join(args.out, f"{stem}_{name}.blend"))
    if blend and os.path.normcase(save_blend) == os.path.normcase(os.path.abspath(blend)):
        raise SystemExit("[bake] --save-blend points at the source .blend; pick a new name")
    os.makedirs(os.path.dirname(save_blend) or ".", exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=save_blend, copy=True)
    print("[bake] saved", save_blend, "(run the NEXT bake on this file with --reuse-uv; export the "
          "GLB from the LAST file)")

    uv_idx = uv_info[0]["uv_index"] if uv_info else 1
    manifest = {
        "image": os.path.basename(path), "maxValue": norm["maxValue"] if norm else None, "type": kind, "size": args.size,
        "samples": samples, "margin": margin, "device": backend, "uv_name": args.uv_name,
        "unwrap": unwrap, "objects": uv_info, "blend": os.path.basename(save_blend),
        "tag": {"key": TAG_KEY[kind], "value": name,
                "three": f"userData.{TAG_KEY[kind]} (glTF node + mesh extras; match on this, not names)"},
        "uvRef": uv_ref, "blender": bpy.app.version_string, "lightRig": args.light_rig or None,
        "three": {
            "loader": LOADER[ext], "flipY": FLIP_Y[ext],
            "flipYIfConvertedTo": {k: v for k, v in FLIP_Y.items() if k != ext},
            "channel": uv_idx,
            "generateMipmaps": True, "minFilter": "LinearMipmapLinearFilter",  # loaders default to no mips
            "colorSpace": "LinearSRGBColorSpace" if is_float else "NoColorSpace",
            "slot": {"AO": "aoMap", "DIFFUSE": "lightMap", "COMBINED": "lightMap"}[kind],
            "lightMapIntensity": round(math.pi, 5) if is_float else None,
            "aoMapIntensity": 1.0 if kind == "AO" else None,
            "aoMapIntensityWithLightmap": 0.4,
            "normalized": norm,  # ship this (as UASTC KTX2) instead of the EXR; None without --normalize
            "notes": {
                "ao-occlusion": "real AO wired in the GLB: GLTFLoader already set aoMap, channel, flipY",
                "neutral-occlusion": "white aoMap in the GLB only carries the UV: set aoMap = null after load",
                "mixed": "some materials carry real AO, some the white carrier: check per material",
            }.get(uv_ref, ""),
        },
    }
    with open(os.path.join(os.path.abspath(args.out), name + ".json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
    print("[bake] manifest:", json.dumps(manifest["three"]))

    if args.export_glb:
        export_glb(args.export_glb)
        verify_glb(args.export_glb, uv_idx, [i["mesh"] for i in uv_info])
    elif args.verify_glb:
        verify_glb(args.verify_glb, uv_idx, [i["mesh"] for i in uv_info])


if __name__ == "__main__":
    main()
