"""Pick the best Cycles compute device available in this Blender, without assuming hardware.

Usage inside another Blender script:
    import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from blender_device import select_cycles_device
    backend = select_cycles_device(bpy.context.scene)   # 'OPTIX' | 'CUDA' | ... | 'CPU'

Order: OPTIX -> CUDA -> HIP -> METAL -> ONEAPI -> CPU. Every step is inside try/except because the
enum of compute_device_type differs per platform and Blender build, and assigning an unknown
identifier raises TypeError. Safe to import outside Blender (bpy is only touched at call time).
"""

PREFERRED_BACKENDS = ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI")


def _set_engine_cycles(scene):
    """Switch to Cycles. The engine enum is dynamic, so assign inside try/except TypeError."""
    if scene.render.engine == "CYCLES":
        return True
    try:
        scene.render.engine = "CYCLES"
        return True
    except TypeError as err:  # the message lists every accepted identifier
        print("[blender_device] could not switch to Cycles:", err)
        return False


def select_cycles_device(scene, preferred=PREFERRED_BACKENDS, verbose=True):
    """Enable every device of the first GPU backend that has one; fall back to CPU.

    Returns the backend identifier that is now in use ('CPU' when no GPU backend worked).
    """
    import bpy  # imported lazily so py_compile / plain Python can load this module

    _set_engine_cycles(scene)
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
    except (KeyError, AttributeError) as err:
        if verbose:
            print("[blender_device] Cycles preferences unavailable, using CPU:", err)
        scene.cycles.device = "CPU"
        return "CPU"

    try:
        valid = {i.identifier for i in prefs.bl_rna.properties["compute_device_type"].enum_items}
    except Exception:  # noqa: BLE001 - RNA shape differs between versions
        valid = set(preferred)

    for backend in preferred:
        if backend not in valid:
            continue
        try:
            prefs.compute_device_type = backend
            # refresh_devices() is the 3.x+/4.x+ name; get_devices() still exists and also refreshes
            if hasattr(prefs, "refresh_devices"):
                prefs.refresh_devices()
            else:
                prefs.get_devices()
            gpus = [d for d in prefs.devices if d.type == backend]
            if not gpus:
                continue
            for d in prefs.devices:
                # keep the CPU out of GPU renders: mixing slows most bakes down
                d.use = d.type == backend
            scene.cycles.device = "GPU"
            if verbose:
                print("[blender_device] using", backend, "->", ", ".join(d.name for d in gpus))
            return backend
        except (TypeError, AttributeError, RuntimeError) as err:
            if verbose:
                print("[blender_device]", backend, "unavailable:", err)
            continue

    try:
        prefs.compute_device_type = "NONE"
    except (TypeError, AttributeError):
        pass
    scene.cycles.device = "CPU"
    if verbose:
        print("[blender_device] no GPU backend worked, using CPU")
    return "CPU"


if __name__ == "__main__":
    try:
        import bpy
    except ImportError:
        raise SystemExit("Run inside Blender: blender -b --python blender_device.py")
    print(select_cycles_device(bpy.context.scene))
