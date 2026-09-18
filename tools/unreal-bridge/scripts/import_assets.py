# Run by Unreal's Python commandlet (UnrealEditor-Cmd <project> -run=pythonscript
# -script=<this file>) with GC_IMPORT_MANIFEST pointing at a JSON manifest:
#   {"models": [{"id", "file"}], "surfaces": [{"id", "baseColor", "normal", "arm"}], "report": "<path>"}
#
# Models (glTF) land in /Game/PolyHaven/Models/<id> with their own materials and
# collision that matches the visible mesh. Surfaces become textures in
# /Game/PolyHaven/Surfaces/<id> plus a material instance MI_<id> of one shared
# PBR master, M_PH_Surface, with Tiling (scalar) and Tint (colour) parameters.
# A JSON report with the created /Game paths is written for the bridge.

import json
import os
import traceback

import unreal

ROOT = "/Game/PolyHaven"
MASTER = ROOT + "/Materials/M_PH_Surface"

tools = unreal.AssetToolsHelpers.get_asset_tools()
eal = unreal.EditorAssetLibrary
mel = unreal.MaterialEditingLibrary


def log(msg):
    unreal.log("GCIMPORT " + str(msg))


def import_file(filename, dest, name=None):
    task = unreal.AssetImportTask()
    task.set_editor_property("filename", filename)
    task.set_editor_property("destination_path", dest)
    if name:
        task.set_editor_property("destination_name", name)
    task.set_editor_property("automated", True)
    task.set_editor_property("replace_existing", True)
    task.set_editor_property("save", True)
    tools.import_asset_tasks([task])
    return list(task.get_editor_property("imported_object_paths") or [])


def class_of(path):
    data = eal.find_asset_data(path)
    try:
        return str(data.asset_class_path.asset_name)
    except Exception:
        return str(data.asset_class)


def assets_in(folder):
    out = []
    for p in eal.list_assets(folder, recursive=True, include_folder=False):
        p = p.split(".")[0]
        out.append({"path": p, "class": class_of(p)})
    return out


def complex_collision(mesh):
    # Props are static scenery: collide against the visible triangles so the
    # player and bullets hit what they see, without hand-made collision.
    try:
        body = mesh.get_editor_property("body_setup")
        if body:
            body.set_editor_property("collision_trace_flag", unreal.CollisionTraceFlag.CTF_USE_COMPLEX_AS_SIMPLE)
            eal.save_loaded_asset(mesh)
    except Exception as e:
        log("collision skipped for %s: %s" % (mesh.get_path_name(), e))


def import_model(m):
    dest = "%s/Models/%s" % (ROOT, m["id"])
    import_file(m["file"], dest)
    assets = assets_in(dest)
    meshes = [a["path"] for a in assets if a["class"] == "StaticMesh"]
    for p in meshes:
        mesh = eal.load_asset(p)
        if mesh:
            complex_collision(mesh)
    if not meshes:
        raise RuntimeError("import produced no static mesh (%s)" % ", ".join(a["class"] for a in assets))
    return {"id": m["id"], "staticMeshes": meshes, "folder": dest}


def texture(path_on_disk, dest, name, kind):
    paths = import_file(path_on_disk, dest, name)
    tex = eal.load_asset((paths[0] if paths else "%s/%s" % (dest, name)).split(".")[0])
    if not tex:
        raise RuntimeError("could not import " + path_on_disk)
    if kind == "normal":
        tex.set_editor_property("srgb", False)
        tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_NORMALMAP)
    elif kind == "masks":
        tex.set_editor_property("srgb", False)
        tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_MASKS)
    eal.save_loaded_asset(tex)
    return tex


def param(mat, cls, name, x, y):
    e = mel.create_material_expression(mat, cls, x, y)
    e.set_editor_property("parameter_name", name)
    return e


def master_material(defaults):
    """The shared PBR surface material. Its texture defaults are the first
    imported surface's maps, so every sampler type matches its texture."""
    if eal.does_asset_exist(MASTER):
        return eal.load_asset(MASTER)
    folder, name = MASTER.rsplit("/", 1)
    mat = tools.create_asset(name, folder, unreal.Material, unreal.MaterialFactoryNew())

    uv = mel.create_material_expression(mat, unreal.MaterialExpressionTextureCoordinate, -1100, 0)
    tiling = param(mat, unreal.MaterialExpressionScalarParameter, "Tiling", -1100, 150)
    tiling.set_editor_property("default_value", 1.0)
    uvs = mel.create_material_expression(mat, unreal.MaterialExpressionMultiply, -900, 50)
    mel.connect_material_expressions(uv, "", uvs, "A")
    mel.connect_material_expressions(tiling, "", uvs, "B")

    def sampler(pname, tex, stype, y):
        s = param(mat, unreal.MaterialExpressionTextureSampleParameter2D, pname, -600, y)
        s.set_editor_property("texture", tex)
        s.set_editor_property("sampler_type", stype)
        mel.connect_material_expressions(uvs, "", s, "UVs")
        return s

    bc = sampler("BaseColor", defaults["baseColor"], unreal.MaterialSamplerType.SAMPLERTYPE_COLOR, -300)
    tint = param(mat, unreal.MaterialExpressionVectorParameter, "Tint", -600, -450)
    tint.set_editor_property("default_value", unreal.LinearColor(1, 1, 1, 1))
    tinted = mel.create_material_expression(mat, unreal.MaterialExpressionMultiply, -250, -350)
    mel.connect_material_expressions(bc, "RGB", tinted, "A")
    mel.connect_material_expressions(tint, "", tinted, "B")
    mel.connect_material_property(tinted, "", unreal.MaterialProperty.MP_BASE_COLOR)

    nrm = sampler("Normal", defaults["normal"], unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL, 0)
    mel.connect_material_property(nrm, "RGB", unreal.MaterialProperty.MP_NORMAL)

    if defaults.get("arm"):
        arm = sampler("ARM", defaults["arm"], unreal.MaterialSamplerType.SAMPLERTYPE_MASKS, 300)
        mel.connect_material_property(arm, "R", unreal.MaterialProperty.MP_AMBIENT_OCCLUSION)
        mel.connect_material_property(arm, "G", unreal.MaterialProperty.MP_ROUGHNESS)
        mel.connect_material_property(arm, "B", unreal.MaterialProperty.MP_METALLIC)
    else:
        rough = param(mat, unreal.MaterialExpressionScalarParameter, "Roughness", -300, 300)
        rough.set_editor_property("default_value", 0.85)
        mel.connect_material_property(rough, "", unreal.MaterialProperty.MP_ROUGHNESS)

    mel.recompile_material(mat)
    eal.save_loaded_asset(mat)
    return mat


def import_surface(s):
    dest = "%s/Surfaces/%s" % (ROOT, s["id"])
    tex = {"baseColor": texture(s["baseColor"], dest, "T_%s_BC" % s["id"], "color")}
    tex["normal"] = texture(s["normal"], dest, "T_%s_N" % s["id"], "normal")
    if s.get("arm"):
        tex["arm"] = texture(s["arm"], dest, "T_%s_ARM" % s["id"], "masks")
    master = master_material(tex)
    mi_path = "%s/MI_%s" % (dest, s["id"])
    if eal.does_asset_exist(mi_path):
        mi = eal.load_asset(mi_path)
    else:
        mi = tools.create_asset("MI_" + s["id"], dest, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
    mel.set_material_instance_parent(mi, master)
    mel.set_material_instance_texture_parameter_value(mi, "BaseColor", tex["baseColor"])
    mel.set_material_instance_texture_parameter_value(mi, "Normal", tex["normal"])
    if tex.get("arm"):
        mel.set_material_instance_texture_parameter_value(mi, "ARM", tex["arm"])
    eal.save_loaded_asset(mi)
    return {"id": s["id"], "material": mi_path, "textures": [t.get_path_name().split(".")[0] for t in tex.values()]}


def main():
    manifest = json.load(open(os.environ["GC_IMPORT_MANIFEST"], encoding="utf-8"))
    report = {"imported": {"models": [], "surfaces": []}, "failed": [], "master": MASTER}
    for m in manifest.get("models", []):
        try:
            report["imported"]["models"].append(import_model(m))
            log("model ok " + m["id"])
        except Exception as e:
            report["failed"].append({"id": m["id"], "error": str(e)})
            log(traceback.format_exc())
    for s in manifest.get("surfaces", []):
        try:
            report["imported"]["surfaces"].append(import_surface(s))
            log("surface ok " + s["id"])
        except Exception as e:
            report["failed"].append({"id": s["id"], "error": str(e)})
            log(traceback.format_exc())
    with open(manifest["report"], "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    log("done")


main()
