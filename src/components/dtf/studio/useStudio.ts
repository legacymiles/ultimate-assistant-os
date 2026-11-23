"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, hydrateDraft, imageSize, loadDraftLocal, putLocal, saveDraftLocal, type Capabilities } from "@/lib/dtf/client";
import { getGarment } from "@/lib/dtf/garments";
import { analyzeLayer, removeBackground } from "@/lib/dtf/export";
import { getPrinter } from "@/lib/dtf/printers";
import { applyOps, newImageLayer, newProject, uid, type ImageSource } from "@/lib/dtf/project";
import { checkProject, type PixelStats } from "@/lib/dtf/readiness";
import { aliasDrawable, measureText } from "@/lib/dtf/render";
import type { DesignOp, DesignProject, ImageLayer, ReadinessReport, SideId } from "@/lib/dtf/types";
/** Which way the garment is shown (kept for scripts that drive the studio). */
export type ViewId = "front" | "back" | "left" | "right" | "three-quarter";

export type SaveState = "idle" | "local" | "saving" | "saved" | "error";

const HISTORY = 120;
const ACCEPT = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

export function svgToSource(svg: string, name: string): ImageSource | null {
  const vb = svg.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  const w = vb ? parseFloat(vb[1]) : 1000;
  const h = vb ? parseFloat(vb[2]) : 1000;
  if (!(w > 0 && h > 0)) return null;
  // Vector artwork has no pixel limit; give it a large nominal size so the
  // readiness engine never calls it low resolution.
  const k = 6000 / Math.max(w, h);
  const bytes = new TextEncoder().encode(svg);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return {
    assetId: uid("svg"),
    src: `data:image/svg+xml;base64,${btoa(bin)}`,
    mime: "image/svg+xml",
    naturalW: Math.round(w * k),
    naturalH: Math.round(h * k),
    origin: "ai",
    name,
  };
}

const opCtx = { measure: measureText, svgSource: svgToSource };

export function useStudioState() {
  const [project, setProject] = useState<DesignProject>(() => newProject("tee", "black"));
  const [past, setPast] = useState<DesignProject[]>([]);
  const [future, setFuture] = useState<DesignProject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [side, setSide] = useState<SideId>("front");
  const [view, setView] = useState<ViewId>("three-quarter");
  const [viewNonce, setViewNonce] = useState(0);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [stats, setStats] = useState<Record<string, PixelStats | undefined>>({});
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string; tone: "info" | "error" | "ok" } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const projectRef = useRef(project);
  projectRef.current = project;
  const gesture = useRef<DesignProject | null>(null);

  const notify = useCallback((text: string, tone: "info" | "error" | "ok" = "info") => setToast({ id: Date.now(), text, tone }), []);

  // ----- history ----------------------------------------------------------------
  const pushHistory = useCallback((before: DesignProject) => {
    setPast((p) => [...p.slice(-HISTORY + 1), before]);
    setFuture([]);
  }, []);

  /** Apply ops as one undoable step. Returns what the reducer reported. */
  const dispatch = useCallback(
    (ops: DesignOp[], opts: { history?: boolean } = {}) => {
      const before = projectRef.current;
      const result = applyOps(before, ops, opCtx);
      if (!result.applied) return result;
      projectRef.current = result.project;
      setProject(result.project);
      if (opts.history !== false && !gesture.current) pushHistory(before);
      return result;
    },
    [pushHistory],
  );

  const beginGesture = useCallback(() => {
    if (!gesture.current) gesture.current = projectRef.current;
  }, []);
  const endGesture = useCallback(() => {
    const g = gesture.current;
    gesture.current = null;
    if (g && g !== projectRef.current) pushHistory(g);
  }, [pushHistory]);

  /** Replace the whole project as one undoable step (used for pixel edits). */
  const replace = useCallback(
    (next: DesignProject) => {
      pushHistory(projectRef.current);
      projectRef.current = next;
      setProject(next);
    },
    [pushHistory],
  );

  // Updaters must stay pure (React may run them twice), so undo/redo read the
  // stacks from refs and then set everything outside any updater.
  const pastRef = useRef(past);
  pastRef.current = past;
  const futureRef = useRef(future);
  futureRef.current = future;
  const undo = useCallback(() => {
    const p = pastRef.current;
    if (!p.length) return;
    const prev = p[p.length - 1];
    const nextFuture = [projectRef.current, ...futureRef.current].slice(0, HISTORY);
    pastRef.current = p.slice(0, -1);
    futureRef.current = nextFuture;
    projectRef.current = prev;
    setPast(pastRef.current);
    setFuture(nextFuture);
    setProject(prev);
  }, []);
  const redo = useCallback(() => {
    const f = futureRef.current;
    if (!f.length) return;
    const next = f[0];
    const nextPast = [...pastRef.current, projectRef.current].slice(-HISTORY);
    pastRef.current = nextPast;
    futureRef.current = f.slice(1);
    projectRef.current = next;
    setPast(nextPast);
    setFuture(futureRef.current);
    setProject(next);
  }, []);

  /** Swap one asset for another everywhere (present + history) without an undo step. */
  const swapAsset = useCallback((fromId: string, to: { assetId: string; src: string }) => {
    const fix = (p: DesignProject): DesignProject => ({
      ...p,
      layers: p.layers.map((l) => (l.kind === "image" && l.assetId === fromId ? { ...l, assetId: to.assetId, src: to.src } : l.kind === "image" && l.sourceAssetId === fromId ? { ...l, sourceAssetId: to.assetId } : l)),
      references: p.references.map((r) => (r.id === fromId ? { ...r, id: to.assetId, url: to.src } : r)),
    });
    const cur = projectRef.current;
    const old = cur.layers.find((l) => l.kind === "image" && l.assetId === fromId) as ImageLayer | undefined;
    if (old) aliasDrawable(old.src, to.src);
    const next = fix(cur);
    projectRef.current = next;
    setProject(next);
    setPast((ps) => ps.map(fix));
    setFuture((fs) => fs.map(fix));
    setStats((s) => {
      // Same pixels, new src — keep the analysis.
      const out = { ...s };
      for (const l of next.layers) if (l.kind === "image" && l.assetId === to.assetId && old && s[old.id]) out[l.id] = s[old.id];
      return out;
    });
  }, []);

  // ----- capabilities + draft restore ------------------------------------------------
  useEffect(() => {
    let alive = true;
    (async () => {
      const c = await api.capabilities().catch(() => null);
      if (!alive) return;
      setCaps(c);
      const params = new URLSearchParams(window.location.search);
      const want = params.get("design");
      if (want && c?.signedIn) {
        const r = await api.project(want).catch(() => null);
        if (r && alive) {
          projectRef.current = r.project;
          setProject(r.project);
          setLoaded(true);
          return;
        }
      }
      const raw = loadDraftLocal();
      const draft = raw ? await hydrateDraft(raw) : null;
      if (draft && alive) {
        projectRef.current = draft;
        setProject(draft);
        setSaveState("local");
      }
      if (alive) setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ----- uploads ---------------------------------------------------------------------
  const uploading = useRef(new Set<string>());

  /** Make sure every local / inline image in the project exists on the server. */
  const syncAssets = useCallback(async (): Promise<boolean> => {
    const c = caps;
    if (!c?.signedIn) return false;
    const p = projectRef.current;
    const pending = p.layers.filter((l): l is ImageLayer => l.kind === "image" && !l.src.startsWith("/api/dtf/assets/"));
    let ok = true;
    for (const l of pending) {
      if (uploading.current.has(l.assetId)) continue;
      uploading.current.add(l.assetId);
      try {
        const blob = await fetch(l.src).then((r) => r.blob());
        const kind = l.origin === "ai" ? "ai" : l.origin === "processed" ? "processed" : "original";
        const src = l.sourceAssetId && l.sourceAssetId.startsWith("ast_") ? l.sourceAssetId : undefined;
        const { asset } = await api.upload(blob, kind, `${l.name || "artwork"}.${blob.type.split("/")[1]?.replace("svg+xml", "svg") ?? "png"}`, src);
        swapAsset(l.assetId, { assetId: asset.id, src: asset.url });
      } catch (e) {
        ok = false;
        notify(e instanceof Error ? e.message : "An upload failed.", "error");
      } finally {
        uploading.current.delete(l.assetId);
      }
    }
    return ok;
  }, [caps, swapAsset, notify]);

  const addFiles = useCallback(
    async (files: FileList | File[], targetSide?: SideId) => {
      const list = Array.from(files).slice(0, 8);
      for (const file of list) {
        const type = file.type || (file.name.toLowerCase().endsWith(".svg") ? "image/svg+xml" : "");
        if (!ACCEPT.includes(type)) {
          notify(`${file.name} isn't a PNG, JPG, WebP or SVG — it can't be printed.`, "error");
          continue;
        }
        if (file.size > 25 * 1024 * 1024) {
          notify(`${file.name} is over 25 MB. Export a smaller PNG.`, "error");
          continue;
        }
        setBusy(`Adding ${file.name}…`);
        const size = await imageSize(file);
        if (!size) {
          setBusy(null);
          notify(`${file.name} couldn't be opened as an image.`, "error");
          continue;
        }
        const assetId = uid("loc");
        await putLocal(assetId, { blob: file, name: file.name, mime: type, width: size.width, height: size.height });
        const src = URL.createObjectURL(file);
        const p = projectRef.current;
        const s = targetSide ?? side;
        const layer = newImageLayer(p, s, { assetId, src, mime: type, naturalW: size.width, naturalH: size.height, origin: "upload", name: file.name });
        pushHistory(p);
        const next = { ...p, layers: [...p.layers, layer], updatedAt: new Date().toISOString() };
        projectRef.current = next;
        setProject(next);
        setSelectedId(layer.id);
        setBusy(null);
      }
      void syncAssets();
    },
    [notify, pushHistory, side, syncAssets],
  );

  /** Background removal → a NEW processed image; the original stays and can be restored. */
  const removeBg = useCallback(
    async (layerId: string, tolerance = 18) => {
      const l = projectRef.current.layers.find((x) => x.id === layerId);
      if (!l || l.kind !== "image") return;
      setBusy("Removing background…");
      try {
        const out = await removeBackground(l.src, tolerance);
        if (out.removedRatio < 0.01) {
          notify("No flat background was found around the artwork — it may already be transparent, or the background is too busy to cut cleanly.", "info");
          return;
        }
        const assetId = uid("loc");
        const blob = new Blob([out.blob], { type: "image/png" });
        await putLocal(assetId, { blob, name: `${l.name}-cutout.png`, mime: "image/png", width: out.width, height: out.height });
        const src = URL.createObjectURL(blob);
        const cur = projectRef.current;
        replace({
          ...cur,
          layers: cur.layers.map((x) =>
            x.id === layerId && x.kind === "image"
              ? { ...x, assetId, src, mime: "image/png", origin: "processed", sourceAssetId: x.sourceAssetId ?? x.assetId, naturalW: out.width, naturalH: out.height }
              : x,
          ),
        });
        notify(`Background removed (${Math.round(out.removedRatio * 100)}% of the image). The original is kept — Restore original undoes it any time.`, "ok");
        void syncAssets();
      } catch (e) {
        notify(e instanceof Error ? e.message : "Background removal failed.", "error");
      } finally {
        setBusy(null);
      }
    },
    [notify, replace, syncAssets],
  );

  // ----- pixel analysis → readiness ---------------------------------------------------
  useEffect(() => {
    let alive = true;
    for (const l of project.layers) {
      if (l.kind !== "image" || stats[l.id] || l.mime === "image/svg+xml") continue;
      analyzeLayer(l).then((s) => {
        if (alive && s) setStats((prev) => (prev[l.id] ? prev : { ...prev, [l.id]: s }));
      });
    }
    return () => {
      alive = false;
    };
  }, [project.layers, stats]);

  const readiness: ReadinessReport = useMemo(
    () => checkProject({ project, printer: getPrinter(), safeWidthMm: caps?.safeWidthMm ?? 290, stats }),
    [project, stats, caps?.safeWidthMm],
  );

  // ----- autosave ------------------------------------------------------------------------
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => saveDraftLocal(project), 350);
    return () => clearTimeout(t);
  }, [project, loaded]);

  useEffect(() => {
    if (!loaded || !caps?.signedIn) return;
    if (!project.layers.length && !past.length) return;
    setSaveState("saving");
    const t = setTimeout(async () => {
      try {
        await syncAssets();
        await api.saveProject(projectRef.current);
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 1400);
    return () => clearTimeout(t);
  }, [project, loaded, caps?.signedIn, syncAssets, past.length]);

  // Keep the active side valid for the garment.
  useEffect(() => {
    const g = getGarment(project.garmentId);
    if (!g.sides.includes(side)) setSide("front");
  }, [project.garmentId, side]);

  const selected = project.layers.find((l) => l.id === selectedId) ?? null;

  const goView = useCallback((v: ViewId) => {
    setView(v);
    setViewNonce((n) => n + 1);
  }, []);

  /** Rename without an undo step (typing a name is not a design change). */
  const rename = useCallback((name: string) => {
    const next = { ...projectRef.current, name: name.slice(0, 120), updatedAt: new Date().toISOString() };
    projectRef.current = next;
    setProject(next);
  }, []);

  /** Once the design fonts have loaded, re-measure every text box with the real glyphs. */
  const remeasureText = useCallback(() => {
    const cur = projectRef.current;
    if (!cur.layers.some((l) => l.kind === "text")) return;
    const next = { ...cur, layers: cur.layers.map((l) => (l.kind === "text" ? { ...l, ...measureText(l) } : l)) };
    projectRef.current = next;
    setProject(next);
  }, []);

  const loadProject = useCallback((p: DesignProject) => {
    projectRef.current = p;
    setProject(p);
    setPast([]);
    setFuture([]);
    setSelectedId(null);
    setStats({});
  }, []);

  return {
    project,
    dispatch,
    replace,
    beginGesture,
    endGesture,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    selected,
    selectedId,
    setSelectedId,
    side,
    setSide,
    view,
    viewNonce,
    goView,
    mode,
    setMode,
    stats,
    readiness,
    caps,
    setCaps,
    saveState,
    busy,
    setBusy,
    toast,
    notify,
    addFiles,
    removeBg,
    syncAssets,
    loadProject,
    rename,
    remeasureText,
    loaded,
  };
}

export type Studio = ReturnType<typeof useStudioState>;

export const StudioContext = createContext<Studio | null>(null);

export function useStudio(): Studio {
  const s = useContext(StudioContext);
  if (!s) throw new Error("useStudio outside StudioContext");
  return s;
}
