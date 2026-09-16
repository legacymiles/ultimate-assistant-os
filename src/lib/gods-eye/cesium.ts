// Loads CesiumJS as a pinned UMD build from jsDelivr instead of bundling it.
//
// Cesium is ~6 MB of JS plus workers, textures and GLSL. Bundling it through
// Next would slow every dev compile of the whole hub and needs its static
// assets copied into /public (then served through the auth middleware, one
// Supabase round trip per worker file). The CDN build is Cesium's documented
// CDN path; the npm package stays a devDependency for its types only.

import type * as CesiumNS from "cesium";

export type CesiumModule = typeof CesiumNS;

export const CESIUM_VERSION = "1.145.0";
const BASE = `https://cdn.jsdelivr.net/npm/cesium@${CESIUM_VERSION}/Build/Cesium/`;

type CesiumWindow = Window & { Cesium?: CesiumModule; CESIUM_BASE_URL?: string };

let loading: Promise<CesiumModule> | null = null;

export function loadCesium(): Promise<CesiumModule> {
  const w = window as CesiumWindow;
  if (w.Cesium) return Promise.resolve(w.Cesium);
  if (loading) return loading;

  w.CESIUM_BASE_URL = BASE;
  loading = new Promise<CesiumModule>((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = `${BASE}Widgets/widgets.css`;
    document.head.appendChild(css);

    const script = document.createElement("script");
    script.src = `${BASE}Cesium.js`;
    script.async = true;
    script.onload = () => (w.Cesium ? resolve(w.Cesium) : reject(new Error("CesiumJS loaded but did not initialise")));
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error("Could not load CesiumJS from the CDN — check your connection."));
    };
    document.head.appendChild(script);
  });
  return loading;
}
