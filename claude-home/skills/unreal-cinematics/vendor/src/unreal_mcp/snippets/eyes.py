"""Snippet builders for the 'eyes' tools - fresh, on-demand scene captures.

Anti-stale BY CONSTRUCTION: each call creates a brand-new render target, drops a TRANSIENT
SceneCapture2D, calls capture_scene() (which renders immediately, on demand - NOT the editor
viewport's throttled redraw, the thing that caused the original stale-frame disaster), exports a
PNG, and destroys the capture actor in a finally block. Nothing is cached, nothing is saved, and the
editor viewport's back buffer is never read. The snippet prints the PNG path; the bridge reads the
bytes off disk and deletes the file.

Every snippet is wrapped in try/except so a UE5.7 API-signature mismatch returns a clean
{'error': ...} instead of crashing the bridge.
"""

import json

from unreal_mcp.snippets import wrap


# --------------------------------------------------------------------------------------------- #
# Injected into every capture snippet.
#
# WHY (2026-07-28): captures reflected CAMERA moves but not MATERIAL or LIGHTING changes, so agents
# repeatedly "fixed" a scene while testing against an image that never updated. Two causes, both in
# the capture setup, neither of them staleness on our side:
#
#   1. SceneCaptureComponent2D defaults bAlwaysPersistRenderingState = False, so the capture keeps
#      NO rendering history between calls. Every temporal feature therefore has nothing to work
#      from: Lumen GI, Lumen reflections, TSR and exposure adaptation all need frame history.
#   2. capture_scene() renders exactly ONE frame. In a Lumen project that frame falls back on the
#      persistent Lumen scene cache, and Lumen's Surface Cache stores per-card ALBEDO and EMISSIVE
#      -- which is precisely why editing a base colour or a light produced no visible change while
#      camera moves worked fine. Rasterisation is immediate; everything else is cached.
#
# Fix: persist rendering state, then render several settling frames so the temporal passes converge.
# Measured on ClockworkVault L_Tutorial: 1 frame -> 316 KB PNG (flat, wrong), 12 frames with persist
# -> 609 KB (correct lighting, visible emissives). Nearly double the entropy.
_SETTLE_HELPER = """
def _match_world_post(comp, w):
    # A SceneCapture carries its OWN PostProcessSettings and does NOT inherit the level's
    # PostProcessVolume, so it tonemaps with DEFAULT exposure while the user's viewport uses the
    # project's. Result: captures read several stops darker than what the user is looking at.
    # Carl, 2026-07-28: "you should see exactly what i see, or there is no use in having it."
    # Copy the highest-priority unbound volume's settings onto the capture and blend at 1.0.
    try:
        best, best_pri = None, -1e30
        for a in unreal.GameplayStatics.get_all_actors_of_class(w, unreal.PostProcessVolume):
            try:
                if not a.get_editor_property('enabled'):
                    continue
                if not a.get_editor_property('unbound'):
                    continue   # bounded volumes only apply inside them; the capture may sit outside
                pri = float(a.get_editor_property('priority'))
            except Exception:
                continue
            if pri >= best_pri:
                best, best_pri = a, pri
        if best is not None:
            comp.set_editor_property('post_process_settings', best.get_editor_property('settings'))
            comp.set_editor_property('post_process_blend_weight', 1.0)
            return True
    except Exception:
        pass
    return False


def _persist_and_settle(comp, cam_loc, cam_rot, frames=10):
    # Lumen/TSR/exposure are TEMPORAL. Without persistent state and settling frames the capture
    # shows stale cached lighting and material albedo. See module docstring note.
    try:
        comp.set_editor_property('always_persist_rendering_state', True)
    except Exception:
        pass
    try:
        _match_world_post(comp, _world())
    except Exception:
        pass
    comp.set_world_location_and_rotation(cam_loc, cam_rot, False, False)
    for _ in range(max(1, int(frames))):
        comp.capture_scene()
"""


# Shared capture body. __CAMLINES__ (8-space indented) must define cam_loc + cam_rot, or leave them
# None (e.g. actor-not-found) to skip the capture cleanly. __W__/__H__/__FOV__/__MODE__ are filled in.
_TEMPLATE = """import os, uuid, datetime
""" + _SETTLE_HELPER + """
def _proj_saved():
    return unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_saved_dir())
try:
    w = _world()
    if w is None:
        _emit({'error': 'editor not ready'})
    else:
        W = __W__; H = __H__; FOV = __FOV__; MODE = __MODE__
        cam_loc = None; cam_rot = None
__CAMLINES__
        if cam_loc is not None:
            out_dir = os.path.join(_proj_saved(), 'UMCP_Eyes')
            os.makedirs(out_dir, exist_ok=True)
            out_name = 'eyes_' + uuid.uuid4().hex
            rt = unreal.RenderingLibrary.create_render_target2d(w, W, H, unreal.TextureRenderTargetFormat.RTF_RGBA8)
            cap = _eas().spawn_actor_from_class(unreal.SceneCapture2D, cam_loc, cam_rot, transient=True)
            try:
                comp = cap.get_component_by_class(unreal.SceneCaptureComponent2D)
                comp.set_editor_property('capture_every_frame', False)
                comp.set_editor_property('capture_on_movement', False)
                comp.set_editor_property('texture_target', rt)
                comp.set_editor_property('capture_source', unreal.SceneCaptureSource.SCS_FINAL_COLOR_LDR)
                comp.set_editor_property('fov_angle', FOV)
                _persist_and_settle(comp, cam_loc, cam_rot)
                unreal.RenderingLibrary.export_render_target(w, rt, out_dir, out_name + '.png')
            finally:
                _eas().destroy_actor(cap)
            _emit({'png_path': os.path.join(out_dir, out_name + '.png'), 'mode': MODE,
                   'camera_loc': [cam_loc.x, cam_loc.y, cam_loc.z],
                   'camera_rot': [cam_rot.pitch, cam_rot.yaw, cam_rot.roll],
                   'fov': FOV, 'width': W, 'height': H, 'world': w.get_name(),
                   'actor_count': len(_eas().get_all_level_actors()),
                   'captured_at': datetime.datetime.now(datetime.timezone.utc).isoformat()})
except Exception as e:
    _emit({'error': repr(e)})
"""


def _compose(cam_lines: str, width: int, height: int, fov: float, mode: str) -> str:
    body = (_TEMPLATE
            .replace("__W__", str(int(width)))
            .replace("__H__", str(int(height)))
            .replace("__FOV__", repr(float(fov)))
            .replace("__MODE__", repr(mode))
            .replace("__CAMLINES__", cam_lines))
    return wrap(body)


def build_mirror(fov: float = 90.0, width: int = 1280, height: int = 720) -> str:
    """Render from the live editor perspective-viewport camera (what the user is looking at)."""
    cam = (
        "        ci = _ues().get_level_viewport_camera_info()\n"
        "        cam_loc, cam_rot = ci[-2], ci[-1]\n"
    )
    return _compose(cam, width, height, fov, "mirror")


def build_look(camera_location, camera_rotation=None, look_at=None,
               fov: float = 90.0, width: int = 1280, height: int = 720) -> str:
    """Steerable camera: explicit location, plus EITHER a look_at target (auto-aim) or a rotation."""
    lx, ly, lz = [float(v) for v in camera_location]
    cam = "        cam_loc = unreal.Vector(%r, %r, %r)\n" % (lx, ly, lz)
    if look_at is not None:
        tx, ty, tz = [float(v) for v in look_at]
        cam += ("        cam_rot = unreal.MathLibrary.find_look_at_rotation("
                "cam_loc, unreal.Vector(%r, %r, %r))\n" % (tx, ty, tz))
    elif camera_rotation is not None:
        rp, ry, rr = [float(v) for v in camera_rotation]
        cam += "        cam_rot = unreal.Rotator(pitch=%r, yaw=%r, roll=%r)\n" % (rp, ry, rr)
    else:
        cam += "        cam_rot = unreal.Rotator(pitch=0.0, yaw=0.0, roll=0.0)\n"
    return _compose(cam, width, height, fov, "look")


def build_focus(ident, distance=None, fov: float = 90.0, width: int = 1280, height: int = 720) -> str:
    """Frame a named actor (by label or name). Auto-distances from its COLLISION bounds (tighter than
    full bounds for characters - full bounds can be bloated by perception/collision volumes), with a
    fallback to full bounds and a clamp so an oversized box can't fling the camera into orbit. cam
    stays None if the actor isn't found."""
    dist_expr = ("%r" % float(distance)) if distance is not None else "radius * 2.5"
    cam = (
        "        ident = %s\n" % json.dumps(ident)
        + "        target = next((a for a in _eas().get_all_level_actors()\n"
        + "                       if a.get_actor_label() == ident or a.get_name() == ident), None)\n"
        + "        if target is None:\n"
        + "            _emit({'error': 'actor not found', 'ident': ident})\n"
        + "        else:\n"
        + "            origin, extent = target.get_actor_bounds(True)\n"
        + "            radius = max(extent.x, extent.y, extent.z)\n"
        + "            if radius < 10.0:\n"
        + "                origin, extent = target.get_actor_bounds(False)\n"
        + "                radius = max(extent.x, extent.y, extent.z)\n"
        + "            radius = min(max(radius, 40.0), 300.0)\n"
        + "            dist = %s\n" % dist_expr
        + "            cam_loc = unreal.Vector(origin.x + dist*0.651, origin.y + dist*0.651, origin.z + dist*0.39)\n"
        + "            cam_rot = unreal.MathLibrary.find_look_at_rotation(cam_loc, origin)\n"
    )
    return _compose(cam, width, height, fov, "focus")


# Top-down orthographic map view. Bespoke (not via _compose): it hides ceilings, sizes an ortho
# camera to the whole scene, and restores visibility in a finally. Tokens: __PAD__/__W__/__H__.
_OVERVIEW_TEMPLATE = """import os, uuid, datetime
""" + _SETTLE_HELPER + """
def _proj_saved():
    return unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_saved_dir())
try:
    w = _world()
    if w is None:
        _emit({'error': 'editor not ready'})
    else:
        actors = _eas().get_all_level_actors()
        hidden = []
        for a in actors:
            nm = (a.get_actor_label() + ' ' + a.get_name()).lower()
            if 'ceiling' in nm or 'roof' in nm:
                try:
                    a.set_is_temporarily_hidden_in_editor(True); hidden.append(a)
                except Exception:
                    pass
        cap = None
        try:
            xs = []; ys = []; zs = []
            for a in actors:
                p = a.get_actor_location(); xs.append(p.x); ys.append(p.y); zs.append(p.z)
            cx = (min(xs) + max(xs)) / 2.0; cy = (min(ys) + max(ys)) / 2.0
            span = max(max(xs) - min(xs), max(ys) - min(ys))
            ortho_w = span * __PAD__ + 200.0
            cam_loc = unreal.Vector(cx, cy, max(zs) + 1500.0)
            cam_rot = unreal.Rotator(pitch=-90.0, yaw=0.0, roll=0.0)
            out_dir = os.path.join(_proj_saved(), 'UMCP_Eyes'); os.makedirs(out_dir, exist_ok=True)
            out_name = 'eyes_' + uuid.uuid4().hex
            rt = unreal.RenderingLibrary.create_render_target2d(w, __W__, __H__, unreal.TextureRenderTargetFormat.RTF_RGBA8)
            cap = _eas().spawn_actor_from_class(unreal.SceneCapture2D, cam_loc, cam_rot, transient=True)
            comp = cap.get_component_by_class(unreal.SceneCaptureComponent2D)
            comp.set_editor_property('capture_every_frame', False)
            comp.set_editor_property('capture_on_movement', False)
            comp.set_editor_property('texture_target', rt)
            comp.set_editor_property('capture_source', unreal.SceneCaptureSource.SCS_FINAL_COLOR_LDR)
            comp.set_editor_property('projection_type', unreal.CameraProjectionMode.ORTHOGRAPHIC)
            comp.set_editor_property('ortho_width', ortho_w)
            _persist_and_settle(comp, cam_loc, cam_rot)
            unreal.RenderingLibrary.export_render_target(w, rt, out_dir, out_name + '.png')
            _emit({'png_path': os.path.join(out_dir, out_name + '.png'), 'mode': 'overview',
                   'camera_loc': [cam_loc.x, cam_loc.y, cam_loc.z], 'ortho_width': ortho_w,
                   'hidden_ceiling_actors': [a.get_actor_label() for a in hidden],
                   'width': __W__, 'height': __H__, 'world': w.get_name(),
                   'actor_count': len(actors),
                   'captured_at': datetime.datetime.now(datetime.timezone.utc).isoformat()})
        finally:
            if cap is not None:
                _eas().destroy_actor(cap)
            for a in hidden:
                try:
                    a.set_is_temporarily_hidden_in_editor(False)
                except Exception:
                    pass
except Exception as e:
    _emit({'error': repr(e)})
"""


def build_overview(width: int = 1280, height: int = 1280, padding: float = 1.2) -> str:
    """Top-down ORTHOGRAPHIC map view of the whole level. Temporarily hides ceiling/roof actors (by
    name) so the interior shows, captures straight down with an ortho camera sized to the scene, then
    restores visibility in a finally. Fresh/anti-stale; transient capture actor; never saves."""
    body = (_OVERVIEW_TEMPLATE
            .replace("__PAD__", repr(float(padding)))
            .replace("__W__", str(int(width)))
            .replace("__H__", str(int(height))))
    return wrap(body)
