# World recipes

Companion to [recipes.md](recipes.md) for everything in a tier-3 world besides the hero. Same
house rules: **three 0.171** (pinned in [recipes.md](recipes.md#import-map-and-vendoring); r186-only features marked), `three/addons/...` imports, **Blender 4.2–5.x**, shader nodes
found by `type`, enums validated before use. Examples always pair contrasting brands; none of
them is a default look.

**Number ownership: each number lives in exactly one place — recipes.md (rendering/technique),
this file (the numbers of its own sections), igloo-tier.md (design intent and ship budgets).**
Anything else is a link.

Bare specifiers (`three`, `three/addons/...`, `gsap`, `gsap/...`, `three-mesh-bvh`) resolve
through recipes.md's [import map and vendoring](recipes.md#import-map-and-vendoring) block; this
file adds no map of its own.

---

## Baking procedural materials to textures

glTF keeps only a Principled BSDF with image textures: Noise, Voronoi, Ramp and Bump graphs
export as flat colour. Bake each channel onto **UV0** (UV1 stays for the
[lightmap](recipes.md#lightmap-and-ao-bake)), pack ORM, rebuild a clean material, export. A cast-iron
skillet, a lacquered guitar body and a recycled-paper diorama all use the same function.

| Channel | Bake | Target image colorspace | glTF slot |
|---|---|---|---|
| Base colour | `DIFFUSE`, `pass_filter={'COLOR'}` (or the emit swap, see gotchas) | sRGB | `baseColorTexture` |
| Roughness | `ROUGHNESS` | Non-Color | ORM **G** |
| Metallic | `EMIT` with Metallic swapped into an Emission shader | Non-Color | ORM **B** |
| Occlusion | `AO` onto UV0, 256 samples ([settings](recipes.md#lightmap-and-ao-bake)), or white | Non-Color | ORM **R** |
| Normal | `NORMAL`, `normal_space='TANGENT'` | Non-Color | `normalTexture` |
| Emissive | `EMIT` | sRGB | `emissiveTexture` |

Texel density by closest camera distance: `size = next_pow2(px_per_m × sqrt(world_area / uv_fraction))`,
cap 2048 (4096 only for a shared atlas). Close-up hero prop **512–1024 px/m**, room surfaces the
camera passes **256**, background dressing **64–128**.

```python
import bpy, numpy as np

def _in(node, *ids):                       # socket by stable identifier (4.x "Emission Color", 3.x "Emission")
    return next((s for s in node.inputs if s.identifier in ids), None)

def _img(name, size, colorspace):
    img = bpy.data.images.new(name, size, size, alpha=False)
    try: img.colorspace_settings.name = colorspace       # "sRGB" / "Non-Color" in the default OCIO config
    except TypeError: pass
    return img

def _swap_to_emission(mat, socket_ids):     # route one input (linked or constant) into a temp Emission
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output)
    src, em = _in(bsdf, *socket_ids), nt.nodes.new("ShaderNodeEmission")
    col = _in(em, "Color")
    if src.is_linked: nt.links.new(src.links[0].from_socket, col)
    else: v = src.default_value; col.default_value = (v, v, v, 1) if isinstance(v, float) else v
    old = out.inputs["Surface"].links[0].from_socket if out.inputs["Surface"].is_linked else None
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    return lambda: (nt.nodes.remove(em), old and nt.links.new(old, out.inputs["Surface"]))

def op_enum_ids(op, prop):                 # same guards as scripts/bake_lightmap.py
    try: return [i.identifier for i in op.get_rna_type().properties[prop].enum_items]
    except (KeyError, AttributeError): return []

def op_accepts(op, prop):
    try: return prop in op.get_rna_type().properties.keys()
    except AttributeError: return False

def _bake_kwargs(op, btype, margin, extra):  # only kwargs and enum values this Blender accepts
    types = op_enum_ids(op, "type")
    if types and btype not in types: raise RuntimeError(f"bake type {btype} not in {types}")
    kw = {"type": btype, "margin": margin, "use_clear": True}
    for prop, want in (("target", "IMAGE_TEXTURES"), ("margin_type", "EXTEND")):
        if op_accepts(op, prop) and want in op_enum_ids(op, prop): kw[prop] = want
    for prop, val in extra.items():
        if not op_accepts(op, prop): continue
        ids = set(op_enum_ids(op, prop))
        if isinstance(val, set): val = (val & ids) if ids else val        # enum-flag (pass_filter)
        elif ids and val not in ids: continue                            # enum (normal_space)
        kw[prop] = val
    return kw

def bake_channels(obj, size=2048, out="//baked/", samples=16):
    sc = bpy.context.scene
    try: sc.render.engine = "CYCLES"                     # dynamic enum: try-assign, never RNA-list it
    except TypeError as e: raise RuntimeError(f"Cycles unavailable: {e}")
    sc.cycles.samples = samples                         # channel bakes have no noise to average; AO needs 256
    bpy.ops.object.select_all(action="DESELECT"); obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    obj.data.uv_layers.active = obj.data.uv_layers[0]   # bake into UV0
    mats = [s.material for s in obj.material_slots if s.material and s.material.use_nodes]
    op, margin = bpy.ops.object.bake, max(4, round(8 * size / 2048))   # 8 px per 2048, floor 4: same as scripts/bake_lightmap.py
    try: sc.render.bake.margin = margin
    except AttributeError: pass
    result = {}
    for key, btype, cs, kw, swap in [
        ("basecolor", "DIFFUSE",   "sRGB",      {"pass_filter": {"COLOR"}},    None),
        ("roughness", "ROUGHNESS", "Non-Color", {},                            None),
        ("normal",    "NORMAL",    "Non-Color", {"normal_space": "TANGENT"},   None),
        ("emissive",  "EMIT",      "sRGB",      {},                            None),
        ("metallic",  "EMIT",      "Non-Color", {},                            ("Metallic",)),
    ]:
        img, undo = _img(f"{obj.name}_{key}", size, cs), []
        for m in mats:
            node = m.node_tree.nodes.new("ShaderNodeTexImage"); node.image = img   # unlinked
            m.node_tree.nodes.active = node                                         # bake target
            if swap: undo.append(_swap_to_emission(m, swap))
            undo.append(lambda m=m, n=node: m.node_tree.nodes.remove(n))
        try:
            if "FINISHED" not in op(**_bake_kwargs(op, btype, margin, kw)):
                raise RuntimeError(f"bake {key} did not finish")
        finally:
            for u in undo: u()
        img.filepath_raw = bpy.path.abspath(f"{out}{obj.name}_{key}.png"); img.file_format = "PNG"; img.save()
        result[key] = img
    return result

def pack_orm(obj, ch, ao=None):
    w, h = ch["roughness"].size
    px = lambda im: (lambda a: (im.pixels.foreach_get(a), a.reshape(-1, 4))[1])(np.empty(w * h * 4, np.float32))
    orm = np.ones((w * h, 4), np.float32)
    orm[:, 0] = px(ao)[:, 0] if ao else 1.0
    orm[:, 1] = px(ch["roughness"])[:, 0]
    orm[:, 2] = px(ch["metallic"])[:, 0]
    img = _img(f"{obj.name}_orm", w, "Non-Color"); img.pixels.foreach_set(orm.ravel())
    img.filepath_raw = bpy.path.abspath(f"//baked/{obj.name}_orm.png"); img.file_format = "PNG"; img.save()
    return img

def rebuild_material(obj, ch, orm):
    mat = bpy.data.materials.new(f"{obj.name}_baked"); mat.use_nodes = True
    nt = mat.node_tree; bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = lambda im: (lambda n: (setattr(n, "image", im), n)[1])(nt.nodes.new("ShaderNodeTexImage"))
    nt.links.new(tex(ch["basecolor"]).outputs["Color"], _in(bsdf, "Base Color"))
    sep = nt.nodes.new("ShaderNodeSeparateColor")        # G→roughness, B→metallic: exporter writes one metallicRoughness texture
    nt.links.new(tex(orm).outputs["Color"], sep.inputs[0])
    nt.links.new(sep.outputs[1], _in(bsdf, "Roughness")); nt.links.new(sep.outputs[2], _in(bsdf, "Metallic"))
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(tex(ch["normal"]).outputs["Color"], nm.inputs["Color"]); nt.links.new(nm.outputs[0], _in(bsdf, "Normal"))
    nt.links.new(tex(ch["emissive"]).outputs["Color"], _in(bsdf, "Emission Color", "Emission"))
    _in(bsdf, "Emission Strength").default_value = 1.0   # raise per brand for bloom (KHR_materials_emissive_strength)
    obj.data.materials.clear(); obj.data.materials.append(mat)
```

Gotchas:
- **DIFFUSE COLOR is black where Metallic = 1** (no diffuse lobe): for metals bake base colour
  with the emit swap, `("basecolor", "EMIT", "sRGB", {}, ("Base Color",))`.
- Set image colorspace **before** baking; Cycles writes in it, so metallic in sRGB is gamma-shifted.
- `NORMAL` without selected-to-active bakes the shading normal (Bump / Normal Map included); glTF
  wants green-up (OpenGL). Skip channels a material lacks (no emission = no 2048² black PNG).
- ORM **R** is read only through the glTF Material Output group (`--gltf-occlusion` in
  `scripts/bake_lightmap.py`). Then [compress](recipes.md#compression-and-loaders): ORM/normal UASTC, base colour ETC1S.

**Sourcing instead of baking.** When a real surface fits the brand (oak, terrazzo, brushed steel,
linen), use the Blender MCP tools: `search_polyhaven_assets(asset_type="textures", categories="wood")`
→ `download_polyhaven_asset(asset_id=…, asset_type="textures", resolution="2k")` (HDRIs:
`asset_type="hdris"`, `file_format="hdr"`). Poly Haven is CC0 (no attribution needed; log ids in
`CREDITS.md`); other sources keep their own license, so check commercial use first. Tint and
grunge every sourced set toward the direction's palette: untouched stock reads as stock.

---

## Interior and set worlds

Enclosed worlds (kitchen, stage, gallery, workshop) are sets: modular pieces on a grid, few shared
materials, light from sources you can see. These rules replace terrain and outdoor fog.

| Set | Kit pieces (grid) | Trim / shared materials | Practical light | Depth cue |
|---|---|---|---|---|
| Bistro kitchen | Tiled wall 1 m, counter 0.6 m deep, shelf, hood | One tile trim, steel, oak | Heat lamps over the pass, oven mouth | Steam cards, warm-to-dark falloff |
| Rehearsal stage | Riser 2×1 m, truss 0.5 m, flight case | Scuffed black, gaffer tape trim, chrome | Par cans, LED strip, exit sign | Beam haze, backlit silhouettes |
| Gallery | Wall 2 m bays, plinth, bench | White plaster, one wood, one concrete | Picture lights, skylight | Long corridor, value steps per room |
| Workshop | Pegboard 0.5 m, bench, cabinet | Plywood trim, painted steel | Task lamps, window | Dust motes in the window shaft |

Kit rules: corner pivots, **0.5 m grid** (0.25 m props), one 2048² trim sheet (edges, mouldings,
grout, tape) mapped by strips, **≤ 6 materials per set**. Place linked duplicates so copies share a mesh:

```python
import bpy
kit = {o.name: o for o in bpy.data.collections["Kit"].objects}
def place(piece, x, y, rot_quarter=0, coll=bpy.context.scene.collection):
    o = kit[piece].copy()                  # linked duplicate: shares o.data, no mesh copy
    o.location = (round(x * 2) / 2, round(y * 2) / 2, 0); o.rotation_euler.z = rot_quarter * 1.5707963
    coll.objects.link(o); return o
for i in range(8): place("wall_tile_1m", i, 0)
```

Export with `export_gpu_instances=True` ([check the kwarg](recipes.md#compression-and-loaders));
shared meshes that still arrive as separate objects merge at load, one draw call per piece type:

```js
function instanceShared(root) {
  const groups = new Map();
  root.traverse(o => { if (o.isMesh && !o.isInstancedMesh && !o.userData.baked && !o.userData.item) {
    const k = o.geometry.uuid + o.material.uuid; (groups.get(k) ?? groups.set(k, []).get(k)).push(o); } });
  for (const list of groups.values()) if (list.length > 3) {
    const im = new THREE.InstancedMesh(list[0].geometry, list[0].material, list.length);
    list.forEach((o, i) => { o.updateWorldMatrix(true, false); im.setMatrixAt(i, o.matrixWorld); o.removeFromParent(); });
    im.computeBoundingSphere(); root.add(im);        // root must sit at the world origin (matrices are world)
  }
}
```

Light (bake via the [lightmap recipe](recipes.md#lightmap-and-ao-bake); walls and floor in the
atlas, instanced props get per-mesh AO):
- **Practicals are emissive meshes** (shade, LED strip, oven mouth) at the canonical
  [emissive range](recipes.md#canonical-numbers) so they bloom ([post](recipes.md#post-processing-stack)); Cycles emission also lights the bake, so wall bounce matches the lamp.
- **Windows:** an Area light filling the opening drives the bake (`light.cycles.is_portal = True`
  in try/except, HDRI worlds only). Runtime beam = additive gradient card (`MeshBasicMaterial`,
  `AdditiveBlending`, `depthWrite: false`) with dust motes. One or two real lights at most, for moving highlights.

Depth without outdoor fog: `FogExp2` in the room's darkest colour at **0.01–0.03**
([fog](recipes.md#fog-with-custom-shaders)), baked falloff away from the practicals, 2–3 haze
cards in beams, silhouetted foreground props, DOF only on detail shots. Camera clearance
**≥ 0.4 m** from any surface (near 0.05), or portrait's taller frustum clips walls. Check in Blender:

```python
import bpy
from mathutils import Vector
sc = bpy.context.scene
dg = bpy.context.evaluated_depsgraph_get(); cam = sc.camera; bad = []
for f in range(sc.frame_start, sc.frame_end + 1, 2):
    sc.frame_set(f); o = cam.matrix_world.translation
    for d in (Vector(v) for v in [(1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1)]):
        hit, loc, *_ = sc.ray_cast(dg, o, d, distance=0.4)
        if hit: bad.append((f, tuple(round(c, 2) for c in loc)))
print("clearance violations:", bad[:20])
```

---

## Content scene interaction

Brand items (dishes on the pass, records in the rehearsal room, paper dioramas on a table) have
three states: **idle**, **hover** (lift + label), **detail** (camera frames it, DOM panel opens).
Each item is also a real DOM button, so keyboard and screen-reader users get the same content.

Picking, BVH-accelerated (large meshes raycast in microseconds):

```js
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;     // InstancedMesh raycasts through Mesh.raycast too

const items = [], pickables = [];                      // items: { id, obj, instanceId?, anchor, button, title }
gltf.scene.traverse(o => { if (o.isMesh && o.userData.item) { o.geometry.computeBoundsTree(); pickables.push(o); } });
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); ray.firstHitOnly = true;
function pick(x, y) {
  ndc.set(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
  const h = ray.intersectObjects(pickables, false)[0]; if (!h) return null;
  return items.find(it => it.obj === h.object && (h.instanceId === undefined || it.instanceId === h.instanceId));
}
```

Pick only `pickables`, once per frame from the latest pointer, never mid-flight. Hover: clone
the material once per item, tween `emissiveIntensity` **+0.6–1.5** over 250 ms `expo.out`, add the
direction's glint (specular sweep, steam puff, strobe blink), show the projected DOM label
([HUD](recipes.md#text-reveal-and-chrome)), tick ([sound](#sound-sourcing-and-procedural-fallback)),
cursor state ([cursor](#cursor-and-touch-states)). Instanced items: copy `im.getMatrixAt(id, m)`
onto one shared **hover proxy** with the lifted material, so the set stays one draw call.

Detail: store the path pose, fly to a framing pose, open the panel.

```js
import gsap from 'gsap';
let reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;   // let: the deep link overrides it for one call
let saved = null, openItem = null;
let cameraMode = 'path';                               // 'path' = scroll drives the camera; 'detail' = fly/framing owns it

function framingPose(it, fov = 30) {                    // longer lens for product-style framing
  const s = new THREE.Box3().setFromObject(it.obj).getBoundingSphere(new THREE.Sphere());
  const v = THREE.MathUtils.degToRad(fov), h = 2 * Math.atan(Math.tan(v / 2) * camera.aspect);
  const dist = s.radius / Math.sin(Math.min(v, h) / 2) * 1.15;   // the narrower axis bounds it (portrait: horizontal)
  const dir = it.viewDir ?? camera.position.clone().sub(s.center).normalize();   // authored in Blender, or current side
  const p = s.center.clone().addScaledVector(dir, dist);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(p, s.center, camera.up));
  return { p, q, fov };
}
function fly(to, done) {
  const from = { p: camera.position.clone(), q: camera.quaternion.clone(), fov: camera.fov }, o = { k: 0 };
  const set = k => { camera.position.lerpVectors(from.p, to.p, k); camera.quaternion.slerpQuaternions(from.q, to.q, k);
    camera.fov = from.fov + (to.fov - from.fov) * k; camera.updateProjectionMatrix(); };
  if (reduce) { set(1); done?.(); return; }             // reduced motion: settled pose, cross-faded (see DOM sync)
  gsap.to(o, { k: 1, duration: 1.1, ease: 'expo.inOut', onUpdate: () => set(o.k), onComplete: done });
}
function openDetail(it, { push = true } = {}) {
  if (!openItem) saved = { p: camera.position.clone(), q: camera.quaternion.clone(), fov: camera.fov, t: scroller.target };
  openItem = it; cameraMode = 'detail';                 // render loop skips sampleCamera(); scroll input is absorbed
  if (push) history.pushState({ item: it.id }, '', '#' + it.id);
  fly(framingPose(it), () => showPanel(it));
}
function closeDetail({ push = true } = {}) {
  if (!openItem) return; const it = openItem; openItem = null; hidePanel(it);
  if (push) history.pushState(null, '', location.pathname);
  fly(saved, () => { scroller.target = scroller.progress = saved.t; cameraMode = 'path'; });
}
addEventListener('popstate', e => { const it = items.find(i => i.id === e.state?.item);
  it ? openDetail(it, { push: false }) : closeDetail({ push: false }); });
addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });

// render loop: the one place that reads cameraMode
function frame(dt) {
  if (cameraMode === 'detail') scroller.target = scroller.progress = saved.t;   // absorb wheel/touch
  const p = scroller.update(dt);
  if (cameraMode === 'path') {                          // skipped in detail: fly()/framingPose own the camera
    const baseFov = sampleCamera(camera, p) ?? camera.fov;
    applyPortrait(camera, sections[sectionIndexAt(p)], innerWidth, innerHeight, baseFov);   // sectionIndexAt: recipes.md
  }
  composer ? composer.render(dt) : renderer.render(scene, camera);   // composer.render takes ONLY dt
}

// deep link: call once from the opening-shot handoff's onComplete (loader, step 4)
function openFromHash() {
  const it = items.find(i => i.id === decodeURIComponent(location.hash.slice(1)));
  if (!it) return;
  const sec = sections.find(s => s.id === it.section) ?? sections[0];   // it.section = its section id
  scroller.target = scroller.progress = sec.t;          // the journey rests at the item's section
  const baseFov = sampleCamera(camera, sec.t) ?? camera.fov;          // settle the path pose first,
  applyPortrait(camera, sec, innerWidth, innerHeight, baseFov);       // so `saved` is that pose
  const r = reduce; reduce = true;                      // fly skipped: fly() takes its settled branch
  try { openDetail(it, { push: false }); } finally { reduce = r; }   // the hash is already in the URL
  history.replaceState({ item: it.id }, '', '#' + it.id);  // tag the entry so popstate handling matches
}
```

While in detail the loop pins `scroller.target` to `saved.t`, so wheel input cannot drift the journey.
A side panel shifts framing with `setViewOffset` ([portrait framing](#portrait-framing)).

Focus and semantics:

```html
<main id="world">…<ul class="sr-only"><li><button data-item="tagine">Lamb tagine</button></li>…</ul></main>
<aside id="panel" role="dialog" aria-modal="true" aria-labelledby="panel-h" hidden>
  <h2 id="panel-h" tabindex="-1"></h2> … <button class="close">Back to the pass</button>
</aside>
```
```js
function showPanel(it) { panel.hidden = false; world.inert = true; panelH.textContent = it.title; panelH.focus(); }
function hidePanel(it) { panel.hidden = true; world.inert = false; it.button.focus({ preventScroll: true }); }
// DOM button focus = 3D hover state; Enter/click = openDetail. The trigger is always a real button.
```

Touch: no hover exists, so **tap 1 selects** (hover state + label + cursor ring), **tap 2 on the
same item opens**, a tap on empty space clears. Distinguish taps from swipes: pointerup within
**10 px** and **300 ms** of pointerdown. Numbers: fly 0.9–1.3 s `expo.inOut`; detail FOV 25–35°;
framing margin 1.1–1.25.

---

## Loader and opening shot

The loader is the opening frame, not a waiting room: **poster** → **progress** in the brand's
voice → **compile** → **handoff** into the opening shot on one timeline.

1. Poster: frame 0 of the camera path rendered in Blender, AVIF/WebP **≤ 120 KB**,
   `<img fetchpriority="high">` under the canvas, so the canvas fade-in is invisible.
2. Progress by bytes: `LoadingManager` only counts items, so weight each `onProgress` by a manifest:

```js
const MANIFEST = [ { url: 'assets/world.glb', bytes: 2_860_000 }, { url: 'assets/lightmap.ktx2', bytes: 1_310_000 } ];
const TOTAL = MANIFEST.reduce((s, a) => s + a.bytes, 0), got = new Map();
let shown = 0, real = 0;
const report = (url, n) => { got.set(url, Math.min(n, MANIFEST.find(a => a.url === url).bytes));
  real = 0.85 * [...got.values()].reduce((a, b) => a + b, 0) / TOTAL; };  // last 15 % = compile
const manager = new THREE.LoadingManager(); manager.onError = url => fail(`asset ${url}`);
const gltfLoader = new GLTFLoader(manager) /* .setKTX2Loader(...) per compression recipe */;
const [gltf, lm] = await Promise.all([
  gltfLoader.loadAsync('assets/world.glb', e => report('assets/world.glb', e.loaded)),
  ktx2.loadAsync('assets/lightmap.ktx2', e => report('assets/lightmap.ktx2', e.loaded)),
]).catch(e => { fail(e); throw e; });
scene.add(gltf.scene);
real = 0.9; await renderer.compileAsync(scene, camera); real = 1;   // + compileAsync(sceneB, camB) for transitions
// every frame: shown += (Math.max(shown, real) - shown) * (1 - Math.exp(-dt * 5));  never goes backwards
```

Never trust `e.total`: with gzip/brotli it is the compressed length (or 0) while `e.loaded`
counts decoded bytes; put decoded sizes in the manifest at build time.

3. Loader UI speaks the brand: a restaurant's mark is **poured** (SVG liquid level), a band's
   **tuned** (VU ladder), a nonprofit's **folded** (creases appear), a watchmaker's a **ticking**
   bezel. Drive one property from `shown` (`stroke-dashoffset`, clip-path, scaleY). No spinner.
4. Handoff: when `real === 1` and a frame has rendered, one GSAP timeline FLIPs the mark to its
   chrome position (nav slot, wordmark or HUD, per the approved direction) with `gsap/Flip.js`,
   crossfades poster → canvas and starts the opening shot. No click. Its `onComplete` calls
   `openFromHash()` ([content scene](#content-scene-interaction)), so `#tagine` links land in that detail.

| Opening shot | Brand examples | Built with |
|---|---|---|
| Assembly | Product parts, a drum kit | [assembly intro](recipes.md#hero-assembly-intro) |
| Steam / fog reveal | Ramen bar, spa | fog density 0.2 → rest value, haze cards drifting out |
| Light-up | Band rig, gallery | emissive and lightmap intensity 0 → rest, staggered by fixture |
| Pour | Coffee roaster, brewery | shape-key or vertex-shader fill level, liquid emissive rim |
| Unfold | Nonprofit paper model, packaging | shape keys exported as morph targets, one per crease |
| Camera arrival | Hotel, venue | first 2–3 s of the path auto-played, then scroll takes over |
| Sound-led | Label, festival | the first hit cuts the light on; sound is off by default, so the visual never waits for it (below) |

Sound-led with sound off: the reveal is a visual cue that sound *can* sync to, not one that needs
it. Arm it on handoff and resolve it on whichever comes first: the sound toggle (hit + light
together), the first scroll/key/pointer input, or **2.5 s** after handoff (light alone, the hit
drawn as a strobe or flash in the direction's voice).

```js
function armSoundLed(reveal /* () => void, idempotent */, { wait = 2500 } = {}) {
  let done = false; const ac = new AbortController();
  const go = viaSound => { if (done) return; done = true; ac.abort(); clearTimeout(timer); reveal(viaSound); };
  const timer = setTimeout(() => go(false), wait);
  for (const t of ['wheel', 'touchstart', 'keydown', 'pointerdown'])
    addEventListener(t, () => go(false), { once: true, passive: true, signal: ac.signal });
  soundToggle.addEventListener('click', () => go(true), { once: true, signal: ac.signal });
}
```

Failure path: no WebGL2 (`!canvas.getContext('webgl2')`), a loader error, **> 12 s**, or
`webglcontextlost` → keep the poster, reveal all DOM content, one line in the brand's voice ("The
kitchen is closed for a moment, the menu is below."), log the cause ([tiers](recipes.md#gpu-tiers-and-adaptive-quality)).

---

## Portrait framing

A phone is a composition, not a crop. Holding horizontal framing
([camera path `onResize`](recipes.md#camera-path-export-and-scroll-mapping)) pushes tall phones past
100° vertical FOV. Cap it, dolly back to compensate, shift the frame so the hero sits in the
**middle third**; each section can override.

```js
// sections[i].portrait = { dolly: 1.3, dist: 6, target: [0, 0.3, 0], shiftY: 0.06, maxVFov: 72 }
const fwd = new THREE.Vector3(), off = new THREE.Vector3();
function applyPortrait(cam, sec, w, h, baseFov) {       // path mode only: after sampleCamera(), before render
  const P = sec.portrait, aspect = w / h;
  const k = P ? 1 - THREE.MathUtils.smoothstep(aspect, 0.45, 1.0) : 0;   // 1 = tall phone, 0 = square or wider
  if (k === 0) { if (cam.view?.enabled) cam.clearViewOffset(); return; }
  cam.fov = Math.min(baseFov, THREE.MathUtils.lerp(baseFov, P.maxVFov ?? 72, k));
  // baseFov = the fov sampleCamera() computed THIS frame, never last frame's cam.fov (that would creep)
  cam.getWorldDirection(fwd);
  cam.position.addScaledVector(fwd, -(P.dolly - 1) * P.dist * k);        // dolly back along the view axis
  if (P.target) cam.position.add(off.fromArray(P.target).multiplyScalar(k)); // world offset (lift above the floor)
  cam.setViewOffset(w, h, 0, P.shiftY * h * k, w, h);   // + shiftY moves the image content up
  cam.updateProjectionMatrix();
}
// per frame, path mode: sampleCamera() (recipes.md) returns the fov it derived for this aspect; if
// your copy returns nothing, cam.fov read immediately after the call is that same value
const baseFov = sampleCamera(camera, scroller.progress) ?? camera.fov;
applyPortrait(camera, sections[sectionIndexAt(scroller.progress)], innerWidth, innerHeight, baseFov);
```

Composition: hero whole at **55–70 % of width**, centre at **38–55 %** of height (the middle
third). Copy placement follows the approved direction (above the hero, below it, or on the ground
as negative space; tilt the path 3–6° down if needed) with one invariant: **copy never crosses the
hero**. Chrome (nav, wordmark or HUD, per direction) **restacks** into the top and bottom bands
inside `env(safe-area-inset-*)` instead of shrinking; its minimum size is the canonical
[chrome text size](recipes.md#canonical-numbers) (phone value). Ignore
height-only resizes < **120 px** on touch (URL bar; size the canvas `100lvh`).
Verify at 390×844 and 430×932 at every rest time plus one mid-transition frame.

---

## Fonts and loading

Two families per direction: a **display** face for the brand voice (headings, counters, a type
wordmark) and a quiet **UI/body** face legible at 11–16 px; a mono only if the HUD needs one.
OFL pairs: restaurant Fraunces + Instrument Sans; band Anton + Space Grotesk; gallery Instrument
Serif + Inter; technical product Space Grotesk + IBM Plex Mono; handmade nonprofit Bricolage
Grotesque + Source Serif 4.

Self-host subsets (no third-party font request, smaller files):

```bash
pip install fonttools brotli
pyftsubset Fraunces.ttf --unicodes="U+0000-00FF,U+2013-2014,U+2018-201D,U+2026,U+20AC" \
  --layout-features="kern,liga,tnum,ss01" --flavor=woff2 --output-file=assets/fraunces-sub.woff2
```

```html
<link rel="preload" href="assets/fraunces-sub.woff2" as="font" type="font/woff2" crossorigin>
<style>
@font-face { font-family: "Display"; src: url(assets/fraunces-sub.woff2) format("woff2");
  font-weight: 300 900; font-display: block; }            /* hidden until ready; the reveal is gated anyway */
@font-face { font-family: "UI"; src: url(assets/instrument-sans-sub.woff2) format("woff2");
  font-weight: 400 600; font-display: swap; }
@font-face { font-family: "UI-fallback"; src: local("Arial"); size-adjust: 97%; ascent-override: 92%; }
body { font-family: "UI", "UI-fallback", system-ui, sans-serif; }
</style>
```

Gate the first reveal on fonts, with a timeout so a slow font never blocks the site:

```js
await Promise.race([ Promise.all([document.fonts.load('600 1em "Display"'), document.fonts.ready]),
                     new Promise(r => setTimeout(r, 2500)) ]);
```

Scrambled or flickering text must not change width. Options, in order: a monospace face; a
proportional face with `font-variant-numeric: tabular-nums` for counters; or reserve the final
width with a hidden copy in the same grid cell:

```css
.scr { display: inline-grid; }
.scr::before, .scr > .live { grid-area: 1 / 1; white-space: pre; }
.scr::before { content: attr(data-text); visibility: hidden; }   /* reserves the final width */
.scr > .live { overflow: hidden; }                                 /* wider random glyphs are clipped */
```

Preload 2 files, **≤ 80 KB** total; with fonts blocked, headings must not reflow more than a few px.

---

## Sound sourcing and procedural fallback

The graph and its numbers are in [sound graph](recipes.md#sound-graph). This section is where the
sound comes from.

Sources, in order: (1) **CC0**: freesound.org filtered to Creative Commons 0 (other freesound
licenses need credit or forbid commercial use), URL + author in `CREDITS.md`. (2) **Sonniss GDC
bundles**: royalty-free commercial use, no attribution, but never redistribute the raw files (mix
them into stems; keep the license PDF). (3) **An AI audio tool only after the user approves** tool,
cost and output license. (4) **Procedural Web Audio** below: keyless, zero bytes, also the fallback
when files fail. Derive from the world: kitchen = hood-fan noise + cutlery tick + steam whoosh;
rehearsal stage = low hum + stick click + cymbal-wash whoosh; gallery = room tone + felt tick.

```js
function noiseBuffer(ctx, seconds = 2) {
  const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b;
}
function noiseBed(ctx, out, { freq = 380, gain = 0.05 } = {}) {       // room tone / hood fan / hum
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 4); src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq; f.Q.value = 0.5;
  const lfo = ctx.createOscillator(), depth = ctx.createGain(); lfo.frequency.value = 0.07; depth.gain.value = freq * 0.4;
  lfo.connect(depth).connect(f.frequency);                             // slow breathing, never static
  const g = ctx.createGain(); g.gain.value = gain;
  src.connect(f).connect(g).connect(out); src.start(); lfo.start(); return g;
}
function tick(ctx, out, { freq = 2400, len = 0.035, vol = 0.25 } = {}) {   // hover / counter tick
  const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + len);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g).connect(out); o.start(t); o.stop(t + len + 0.01);
}
function whoosh(ctx, out, { dur = TRANSITION.dur, from = 300, to = 3200, vol = 0.3 } = {}) { // TRANSITION: DOM sync
  const t = ctx.currentTime, src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, dur + 0.1);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
  bp.frequency.setValueAtTime(from, t); bp.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.45); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(out); src.start(t); src.stop(t + dur + 0.05);
}
```

Connect beds to the recipe's `lp` and one-shots to `master` so the scroll-velocity filter and the
toggle apply to them too. `exponentialRampToValueAtTime` cannot reach 0: ramp to 0.0001.

Loudness: `I=` is the stem target from [sound graph](recipes.md#sound-graph) (mirrored below;
change it there first):
`ffmpeg -i in.wav -af loudnorm=I=-18:TP=-1.5:LRA=11 -c:a libopus -b:a 96k out.ogg`. One-shots
peak -3 dBFS (no loudnorm under 1 s); match procedural gains by ear.

**Off by default.** No `AudioContext` exists until the toggle's first click; the click handler
creates it, builds the graph and resumes it (Safari needs both inside the gesture):

```js
let ctx = null, master = null, lp = null;
soundToggle.addEventListener('click', async () => {
  if (!ctx) {                                           // lazy: first click only
    ctx = new AudioContext();
    master = ctx.createGain(); master.gain.value = 0;
    lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 800;
    lp.connect(master).connect(ctx.destination);
    noiseBed(ctx, lp);                                  // or recipes.md's stems, loaded now
  }
  await ctx.resume();
  const on = soundToggle.getAttribute('aria-pressed') !== 'true';
  master.gain.setTargetAtTime(on ? 0.8 : 0, ctx.currentTime, 0.2);
  soundToggle.setAttribute('aria-pressed', String(on));
});
// one-shot callers guard on the context: if (ctx) tick(ctx, master);
```

---

## DOM sync during transitions

Copy and chrome are part of the transition, not a layer that snaps afterwards. One **paused**
GSAP timeline owns the shader's `uProgress` ([scene transitions](recipes.md#scene-transitions)),
the pass/scene swap and every DOM tween, so it can be **played** (a section change) or **seeked**
with `tl.progress(p)` (a scrubbed band, where scroll drives the dissolve), reversed or killed, and
everything stays in step. The pass state is derived from the playhead on every update, so any
seek order, including scrubbing back out of a finished transition, lands in a valid state.

Written for recipes.md **variant A** (pmndrs `TransitionEffect` in `transitionPass`, right after
`renderPass`). Variant B has no pass to toggle: take `const uProgress = mix.material.uniforms.uProgress`,
and while `0 < p < 1` call `renderTransition(uProgress.value, scroller.velocity)` instead of the
normal render; at `p >= 1` scene B becomes `sceneA`.

```js
import gsap from 'gsap';
import { SplitText } from 'gsap/SplitText.js';         // free since GSAP 3.13; import maps need the .js
gsap.registerPlugin(SplitText);
// mirror of recipes.md canonical "Scene transition" (duration, ease, mask end): change it there first
export const TRANSITION = { dur: 1.2, ease: 'expo.inOut', maskEnd: 1.1 };
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const live = document.getElementById('section-live');  // <p id="section-live" class="sr-only" aria-live="polite">
const uProgress = transition.uniforms.get('uProgress');  // variant A: postprocessing Effect uniforms are a Map

// from/to: { scene, camera, el, heading, title }
function phase(from, to, p) {                           // idempotent: safe for play, reverse and seek
  const done = p >= 1;
  transitionPass.enabled = !reduce && p > 0 && !done;  // scene B renders only mid-transition
  transition.sceneB = to.scene; transition.camB = to.camera;
  const cur = done ? to : from;
  renderPass.mainScene = cur.scene; renderPass.mainCamera = cur.camera;
  transitionPass.mainCamera = cur.camera;
  const title = p >= 0.5 ? to.title : from.title;      // announce on the beat, both directions
  if (live.textContent !== title) live.textContent = title;
}

function makeTransition(from, to, { dur = TRANSITION.dur } = {}) {
  const lines = sec => (sec.split ??= SplitText.create(sec.heading, { type: 'lines', mask: 'lines' })).lines;
  const outLines = lines(from), inLines = lines(to);  // split once, reuse
  const tl = gsap.timeline({ paused: true, defaults: { ease: TRANSITION.ease },
    onStart: () => restartGrace(),                      // frame monitor grace (recipes.md GPU tiers)
    onUpdate: () => phase(from, to, tl.progress()) });
  if (reduce) {                                         // the one reduced-motion path: settle + cross-fade
    return tl.add(() => crossfadeCanvas())            // snapshot of the settled outgoing frame, fades out
      .fromTo(from.el, { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.2, ease: 'none' }, 0)
      .fromTo(to.el, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: 'none' }, 0);
  }
  return tl
    .fromTo(uProgress, { value: 0 }, { value: TRANSITION.maskEnd, duration: dur }, 0)
    .fromTo(outLines, { yPercent: 0 }, { yPercent: -110, duration: dur * 0.4, stagger: 0.04, ease: 'expo.in' }, 0)
    .set(from.el, { visibility: 'hidden' }, dur * 0.45)       // the masked moment
    .set(to.el, { visibility: 'visible' }, dur * 0.45)
    .fromTo(inLines, { yPercent: 110 }, { yPercent: 0, duration: dur * 0.5, stagger: 0.05, ease: 'expo.out' }, dur * 0.5);
}

// trigger 1, played: a section change (snap, nav link, key) plays the whole beat
//   const tl = makeTransition(a, b); tl.play();   going back: tl.reverse()
// trigger 2, scrubbed band: scroll owns the playhead inside [band.t0, band.t1] of the journey
function scrubBand(tl, band, progress) {                // every frame, after scroller.update(dt)
  const p = THREE.MathUtils.clamp((progress - band.t0) / (band.t1 - band.t0), 0, 1);
  if (p !== tl.progress()) tl.progress(p);              // seeking fires onUpdate -> phase()
}
```

`fromTo` everywhere (never bare `from`), so seeking backwards past a tween restores its start
values; the live-region text is set in `phase()`, not by a one-way `.call()`, so it is right after
any seek. In a scrubbed band the timeline's own eases shape the beat; do not ease `p` again. The
damped scroller already smooths input, and the snap moves the playhead out of the band to a rest
time, so the dissolve never parks half-way.

Reduced motion follows the single path in
[GPU tiers](recipes.md#gpu-tiers-and-adaptive-quality): the live renderer keeps running, the
camera cuts to the settled pose (one settled frame per section change), and the section
cross-fades over **200 ms**, the single reduced-motion cross-fade duration (recipes.md links
here). No dissolve, no displacement, no line motion.

```js
// crossfadeCanvas({ dur = 200, source = renderer.domElement } = {}) -> Promise<void>
// Call right after the last outgoing render, in the same task, so no preserveDrawingBuffer is
// needed. Snapshots the WebGL canvas into a 2D overlay and fades it 1 -> 0 while the new section
// renders underneath.
const xfade = Object.assign(document.createElement('canvas'), { className: 'xfade' });
xfade.setAttribute('aria-hidden', 'true');
xfade.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;opacity:0';
document.body.append(xfade);
export function crossfadeCanvas({ dur = 200, source = renderer.domElement } = {}) {
  xfade.width = source.width; xfade.height = source.height;
  xfade.getContext('2d').drawImage(source, 0, 0);
  xfade.style.transition = 'none'; xfade.style.opacity = '1';
  xfade.getBoundingClientRect();                        // commit opacity 1 before transitioning
  xfade.style.transition = `opacity ${dur}ms linear`; xfade.style.opacity = '0';
  return new Promise(r => setTimeout(r, dur));
}
```

Voice per direction (one, everywhere): gallery = the **line mask** above; band = **strobe flicker**
(`steps(4)` opacity) on the whoosh; technical product = [scramble](recipes.md#text-reveal-and-chrome);
restaurant = **blur-in** (`blur(8px)` → 0 with opacity, 0.6 s), like steam clearing.

Velocity-synced distortion of DOM text, matching the shader's displacement:

```html
<svg width="0" height="0" aria-hidden="true"><filter id="warp"><feTurbulence baseFrequency="0.012 0.04" numOctaves="1"/>
  <feDisplacementMap in="SourceGraphic" scale="0" xChannelSelector="R" yChannelSelector="G"/></filter></svg>
```
```js
const disp = document.querySelector('#warp feDisplacementMap');
function syncDom(vel) {                                 // scroller.velocity, progress/sec
  const s = Math.min(Math.abs(vel) * 60, 18);
  disp.setAttribute('scale', s.toFixed(1));
  headline.style.filter = s > 0.5 ? 'url(#warp)' : 'none';   // SVG filters are expensive: off at rest
}
```

Rules: animate only `transform`, `opacity`, `clip-path`, `filter`, so layout never shifts; outgoing
and incoming blocks share one grid cell (`grid-area: 1/1`); headings are real `<h2>`s with final
text (SplitText's default `aria: 'auto'` sets `aria-label`); `aria-live="polite"` announces each
section once. Reduced motion: the cross-fade above, DOM and canvas together; `syncDom` stays off.

---

## Head, SEO and noscript

The world is progressive enhancement over a real document. Every section's heading and copy,
every item's title and description, the primary action and contact details are in the **initial
HTML**, never injected by the loader, so crawlers, link previews, find-in-page, reader mode and
screen readers all see them. The canvas layers on top; section copy is the same DOM that
[DOM sync](#dom-sync-during-transitions) animates (hidden with `visibility`/`autoAlpha`, never
removed). Item mirror buttons (`data-item`) are generated at build time from the same list.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Maison Olive · Moroccan kitchen, Lisbon</title>          <!-- brand · what · where, ≤ 60 chars -->
  <meta name="description" content="Slow-cooked tagines and a wood oven in Alfama. Book a table tonight.">
  <link rel="canonical" href="https://example.com/">
  <meta name="theme-color" content="#1b1410">                     <!-- the loader/poster background -->
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon-32.png" sizes="32x32">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">       <!-- 180×180 -->
  <meta property="og:type" content="website">
  <meta property="og:title" content="Maison Olive · Moroccan kitchen, Lisbon">
  <meta property="og:description" content="Slow-cooked tagines and a wood oven in Alfama.">
  <meta property="og:url" content="https://example.com/">
  <meta property="og:image" content="https://example.com/og.jpg"> <!-- the poster, 1200×630 JPEG, absolute URL -->
  <meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="The pass at Maison Olive under warm heat lamps">
  <meta name="twitter:card" content="summary_large_image">        <!-- falls back to og:* for title/image -->
  <link rel="preload" as="image" href="assets/poster.avif" fetchpriority="high">
  <script type="application/ld+json">{ "@context": "https://schema.org", "@type": "Restaurant",
    "name": "Maison Olive", "url": "https://example.com/", "image": "https://example.com/og.jpg",
    "servesCuisine": "Moroccan", "priceRange": "€€",
    "address": { "@type": "PostalAddress", "addressLocality": "Lisbon", "addressCountry": "PT" },
    "acceptsReservations": "https://example.com/#book" }</script>
</head>
```

`og:image` is the [loader poster](#loader-and-opening-shot) re-exported as a 1200×630 JPEG (social
scrapers skip AVIF). JSON-LD per genre, keyed to brief.md's
[genre table](brief.md#genre--primary-action-and-interactions). Fill only what the brief has;
never invent addresses, prices, dates or ratings.

| Genre (brief.md) | `@type` | Fields worth filling |
|---|---|---|
| Place / venue / restaurant | `Restaurant` (or `LocalBusiness`, `Hotel`, `Museum`) | `address`, `geo`, `openingHoursSpecification`, `servesCuisine`, `acceptsReservations`, `menu` |
| Band / album / event | `MusicGroup`, plus one `MusicEvent` per show | group: `genre`, `member`, `sameAs` (streaming profiles); show: `startDate`, `location`, `offers.url`, `performer` |
| Physical product · Fashion / apparel | `Product` | `brand`, `image`, `description`, `offers` (`price`, `priceCurrency`, `availability`, `url`) |
| Tech / SaaS / AI · Game / app launch | `Organization` (+ `SoftwareApplication` for the app) | `logo`, `sameAs`; app: `operatingSystem`, `applicationCategory`, `offers` |
| Nonprofit · Finance · Healthcare · Education · Publication | `Organization` subtype: `NGO`, `FinancialService`, `MedicalClinic`, `EducationalOrganization`, `NewsMediaOrganization` | `logo`, `sameAs`, `address`, `contactPoint` |
| Person / artist / portfolio | `Person` | `jobTitle`, `sameAs`, `knowsAbout`, `worksFor` |
| Wedding / private event (or any dated event) | `Event` | `startDate`, `endDate`, `location`, `eventStatus`, `eventAttendanceMode`, `organizer` |

Body: poster, canvas, the sections with final copy, the mirror buttons, and a noscript block that
reuses the poster and the same section list (one copy of the content, not two):

```html
<body>
  <img id="poster" src="assets/poster.avif" alt="" fetchpriority="high">   <!-- decorative: the copy says it -->
  <canvas id="gl" aria-hidden="true"></canvas>
  <main id="world">
    <section id="pass" class="sec"><h2>The pass</h2><p>Six tagines, one wood oven, all night.</p></section>
    <section id="book" class="sec"><h2>Book a table</h2><a class="cta" href="https://…">Reserve for tonight</a></section>
    <ul class="sr-only"><li><button data-item="tagine">Lamb tagine</button></li>…</ul>
  </main>
  <noscript>
    <style>#gl, .loader, #world .sr-only { display: none }
      #poster { position: static; width: 100%; height: auto }
      html, body { overflow: auto; height: auto }                       /* the fixed page scrolls natively */
      #world, #world .sec { position: static; visibility: visible !important; opacity: 1 !important }</style>
    <p>The kitchen is best with JavaScript on; the whole menu is below.</p>
  </noscript>
</body>
```

Robots and sitemap, one line each: `robots.txt` = `User-agent: *` · `Allow: /` ·
`Sitemap: https://example.com/sitemap.xml`; `sitemap.xml` lists the canonical URL and any real
sub-pages (`#item` deep links are not separate URLs and stay out of it).

---

## Cursor and touch states

A custom cursor exists only on `(hover: hover) and (pointer: fine)`. Five states, per direction:

| State | Meaning | Native direction | Crosshair (technical) | Dot + ring (gallery, restaurant) | Custom (band) |
|---|---|---|---|---|---|
| idle | over the world | `default` | 1 px `+`, 12 px | 6 px dot | brand glyph, 16 px |
| interactive | over an item or link | `pointer` | `+` rotates 45°, label appears | ring grows to 40 px, blend difference | glyph flashes, label |
| dragging | orbiting / scrubbing | `grabbing` | `+` with axis ticks | ring squashes along velocity | glyph trails |
| loading | detail or scene loading | `progress` | ticking arc | ring draws as progress | meter |
| disabled | not available now | `not-allowed` | dimmed 40 % | ring dashed | glyph struck |

```css
@media (hover: hover) and (pointer: fine) { html.custom-cursor, html.custom-cursor * { cursor: none; } }
.cursor { position: fixed; left: 0; top: 0; pointer-events: none; z-index: 50; will-change: transform; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 2px; }
```

```js
const xTo = gsap.quickTo(cursorEl, 'x', { duration: 0.25, ease: 'power3' }), yTo = gsap.quickTo(cursorEl, 'y', { duration: 0.25, ease: 'power3' });
addEventListener('pointermove', e => { if (e.pointerType === 'mouse') { xTo(e.clientX); yTo(e.clientY); } });
function magnetic(el, strength = 0.3) {                // DOM targets: buttons, sound toggle, nav
  const mx = gsap.quickTo(el, 'x', { duration: 0.4, ease: 'expo.out' }), my = gsap.quickTo(el, 'y', { duration: 0.4, ease: 'expo.out' });
  el.addEventListener('pointermove', e => { const r = el.getBoundingClientRect();
    const c = v => Math.max(-12, Math.min(12, v * strength));   // max 12 px, transforms only
    mx(c(e.clientX - r.left - r.width / 2)); my(c(e.clientY - r.top - r.height / 2)); });
  el.addEventListener('pointerleave', () => { mx(0); my(0); });
}
```

3D targets: within **60 px** of a hovered item's projected anchor, pull the cursor 0.3 of the way
to it and set `interactive`. Drive styles from `document.documentElement.dataset.cursor` and keep
the native `cursor` value set too. Touch: **tap 1 = hover state** (label, glint, tick), **tap 2 on
the same target = action**, elsewhere clears; optional long-press preview (**500 ms**, cancelled
by > 10 px), never the only way in; no custom cursor for `pointerType !== 'mouse'`. Keyboard focus
on a DOM mirror button = the same hover state, `:focus-visible` in the direction's accent.

Pointer parallax: camera or rig offset **±0.02–0.05 world units**, damped (this is the canonical value;
no other recipe defines parallax). Apply it after `sampleCamera()` and
`applyPortrait()`, off under reduced motion, off during detail flights, and via device
orientation only if the user grants it (iOS asks).
