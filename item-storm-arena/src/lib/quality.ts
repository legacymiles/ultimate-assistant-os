/**
 * GPU tier detection. Software renderers (SwiftShader, llvmpipe, Basic Render
 * Driver) can't afford post-processing or a dense storm — they get a lighter
 * arena instead of a slideshow. A runtime FPS watchdog can also demote a
 * device that looked capable on paper.
 */
export type GpuTier = "high" | "low";

export function detectGpuTier(): GpuTier {
  if (typeof window === "undefined") return "high";
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ??
      (canvas.getContext("webgl") as WebGLRenderingContext | null);
    if (!gl) return "low";
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = info
      ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    if (/swiftshader|llvmpipe|software|basic render/i.test(renderer)) return "low";
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const cores = navigator.hardwareConcurrency ?? 8;
    if (coarse && cores <= 4) return "low";
    return "high";
  } catch {
    return "low";
  }
}
