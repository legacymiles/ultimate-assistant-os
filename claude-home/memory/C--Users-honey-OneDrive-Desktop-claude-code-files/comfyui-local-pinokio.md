---
name: comfyui-local-pinokio
description: "ComfyUI installed locally via Pinokio at C:\\pinokio\\api\\comfy — working GPU stack on the 6GB RTX 3050; what fits and what doesn't"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 7cae4aac-9b86-4ef0-95b2-c7ac8599760b
  modified: 2026-09-20T15:47:17.681Z
---

**ComfyUI runs locally on this PC**, installed 2026-09-20 via Pinokio for a free video-generation
option (driven by [[preview-icon-skill]]).

- Path `C:\pinokio\api\comfy` (9.6GB). Start: `pterm run "C:\pinokio\api\comfy" --default start.js`.
- Serves `http://localhost:8188`. Verify the GPU with `GET /system_stats`.
- Verified stack: Python 3.10.15, ComfyUI 0.36.0, torch 2.7.0+cu128, RTX 3050 6GB, ~5GB free.

**Why Pinokio and not a manual install:** the system Python is **3.14**, which torch does not
support — a manual `pip install torch` fails. Pinokio ships its own conda env. Don't bypass it.

**Driving Pinokio:** `pterm` is at `C:\pinokio\bin\npm\pterm.cmd`. Two gotchas that cost time:
- Pinokio desktop must be **running** or there is no control plane (launch `Desktop\Pinokio.lnk`,
  it takes ~60-90s to open port 42000). "pterm broken" is usually "Pinokio isn't open".
- `~/.pinokio/config.json` `access.host` can be a **stale LAN IP** (was 192.168.1.43) that pterm
  tries first and times out on. The control plane is on `127.0.0.1:42000`.
- `pterm download <repo>` only clones the ~150KB launcher. The real install is a separate
  `pterm run <path> --default install.js`. Success shows as `default_script` flipping to `start.js`.

**Hardware ceiling — the RTX 3050 is 6GB, and Windows/Edge hold a chunk of it.** Bundled Wan
scripts in `C:\pinokio\api\comfy\wan\` pull **Wan 2.1**, not 2.2:
- `text1.3b.js` → `wan2.1_t2v_1.3B_bf16` — the ONLY bundled one that fits 6GB. Text-to-video only.
- `text14b.js`, `image480p.js`, `image720p.js` → 14B, all too big. So no bundled image-to-video on
  this card, which rules out "animate my Gemini still locally with Wan" via the launcher.
- Wan 2.2's 5B TI2V variant does image-to-video and exists in the same Comfy-Org repackaged format,
  but is tight on ~5GB free. Untested.

The launcher also ships `ltx/`, `hunyuan/` and flux download scripts.
