"use client";

// ---------------------------------------------------------------------------
// Smart Shot — the one place project state changes.
//
// Every writer goes through commit(): it reads the latest project from a
// ref, never from a closure, so two updates in one tick (a panel finishing
// while a take polls) can't clobber each other. Same rule Auteur learned the
// hard way.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { downloadRender, renderStatus, requestPanel, requestPlan, requestRevision, startRender } from "@/lib/smart-shot/client";
import { QUALITY, standaloneSeconds } from "@/lib/smart-shot/constants";
import { composeFullH3Prompt, composeH3Prompt, EMPTY_MEDIA, type H3Brief, type H3Media } from "@/lib/smart-shot/h3prompt";
import { dataUrlToBlob, downscaleToDataUrl, mediaDataUrl, mediaUrl, putMedia } from "@/lib/smart-shot/media";
import {
  characterSheetPrompt,
  cutFramePrompt,
  elevationPrompt,
  environmentPrompt,
  floorPlanPrompt,
  lightingPrompt,
  panelFor,
  panelsFor,
  productSheetPrompt,
  type PanelRef,
  type PanelSpec,
} from "@/lib/smart-shot/panels";
import { stalePanels } from "@/lib/smart-shot/plan/revise";
import { renumber } from "@/lib/smart-shot/plan/schema";
import { loadProjects, newProject, saveProjects, upsert } from "@/lib/smart-shot/repo";
import { renderSheet } from "@/lib/smart-shot/sheetImage";
import type { Panel, PanelKind, Plan, PlanCut, Project, Take } from "@/lib/smart-shot/types";
import { nowIso, uid } from "@/lib/utils";

export const FULL = "full";

export interface Studio {
  project: Project;
  projects: Project[];
  urls: Record<string, string>;
  busy: string;
  error: string;
  notice: string;
  commit: (fn: (p: Project) => Project) => void;
  open: (id: string) => void;
  create: () => void;
  remove: (id: string) => void;
  setStage: (s: Project["stage"]) => void;
  /** Plan + draw the sheet (OpenArt's "Preview Shot Plan"). */
  plan: () => Promise<void>;
  /** Plan + draw + render the film in one go (OpenArt's "Create Video"). */
  createVideo: () => Promise<void>;
  drawAll: () => Promise<void>;
  drawPanel: (kind: PanelKind, targetId: string) => Promise<void>;
  updatePlan: (fn: (plan: Plan) => Plan) => void;
  updateCut: (id: string, patch: Partial<PlanCut>) => void;
  moveCut: (id: string, dir: -1 | 1) => void;
  addCut: (afterId?: string) => void;
  deleteCut: (id: string) => void;
  /** Compose the sheet PNG from the current panels; returns its object URL. */
  composeSheet: () => Promise<string | null>;
  briefFor: (cut: PlanCut) => Promise<H3Brief>;
  fullBrief: () => Promise<H3Brief>;
  render: (cutId: string) => Promise<void>;
  renderFull: () => Promise<void>;
  /** Storyboard → video page, starting the film unless one is already rendering. */
  startVideo: () => void;
  /** Ask the AI director to change the plan; redraws only what changed. */
  revise: (message: string) => Promise<void>;
  chatBusy: boolean;
  setPromptOverride: (key: string, text: string | null) => void;
  dismiss: () => void;
}

export function useStudio(): Studio {
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project>(() => newProject());
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const ref = useRef(project);
  const listRef = useRef(projects);
  const loaded = useRef(false);

  useEffect(() => {
    const list = loadProjects();
    listRef.current = list;
    setProjects(list);
    if (list[0]) {
      ref.current = list[0];
      setProject(list[0]);
    }
    loaded.current = true;
  }, []);

  // Resolve object URLs for every media id the project refers to.
  useEffect(() => {
    const ids = [...project.panels.map((p) => p.mediaId), ...project.takes.map((t) => t.mediaId), project.sheetMediaId].filter(
      (id): id is string => Boolean(id) && !urls[id!],
    );
    if (!ids.length) return;
    let alive = true;
    (async () => {
      const found: Record<string, string> = {};
      for (const id of ids) {
        const u = await mediaUrl(id);
        if (u) found[id] = u;
      }
      if (alive && Object.keys(found).length) setUrls((prev) => ({ ...prev, ...found }));
    })();
    return () => {
      alive = false;
    };
  }, [project.panels, project.takes, project.sheetMediaId, urls]);

  const commit = useCallback((fn: (p: Project) => Project) => {
    const next = { ...fn(ref.current), updatedAt: nowIso() };
    ref.current = next;
    setProject(next);
    if (loaded.current) {
      const list = upsert(listRef.current, next);
      listRef.current = list;
      setProjects(list);
      saveProjects(list);
    }
  }, []);

  const open = (id: string) => {
    const hit = listRef.current.find((p) => p.id === id);
    if (!hit) return;
    ref.current = hit;
    setProject(hit);
    setError("");
  };

  const create = () => {
    const p = newProject();
    ref.current = p;
    setProject(p);
    setError("");
    setNotice("");
  };

  const remove = (id: string) => {
    const list = listRef.current.filter((p) => p.id !== id);
    listRef.current = list;
    setProjects(list);
    saveProjects(list);
    if (ref.current.id === id) create();
  };

  const setStage = (stage: Project["stage"]) => commit((p) => ({ ...p, stage }));

  // ----- planning ------------------------------------------------------------

  const plan = async () => {
    const p = ref.current;
    if (!p.brief.prompt.trim()) {
      setError("Write what the video is about first.");
      return;
    }
    setError("");
    setNotice("");
    setBusy("Planning the shoot…");
    try {
      const res = await requestPlan(p.brief, p.uploads);
      commit((cur) => ({
        ...cur,
        title: res.plan.title,
        plan: res.plan,
        panels: panelsFor(res.plan),
        takes: [],
        promptOverrides: {},
        sheetMediaId: undefined,
        stage: "storyboard",
      }));
      if (res.warning) setNotice(res.warning);
      setBusy("");
      await drawAll();
    } catch (err) {
      setBusy("");
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  };

  const createVideo = async () => {
    try {
      await plan();
    } catch {
      return;
    }
    commit((p) => ({ ...p, stage: "video" }));
    await renderFull();
  };

  // ----- drawing panels --------------------------------------------------------

  const uploadRef = (uploadId: string | null, role: PanelRef["role"], label: string): PanelRef[] => {
    const u = ref.current.uploads.find((x) => x.id === uploadId);
    return u ? [{ role, label, dataUrl: u.dataUrl }] : [];
  };

  const styleRefs = (): PanelRef[] =>
    ref.current.uploads.filter((u) => u.role === "style").slice(0, 2).map((u) => ({ role: "style" as const, label: u.name || "style", dataUrl: u.dataUrl }));

  const panelImage = async (kind: PanelKind, targetId: string, max = 768): Promise<string | null> => {
    const panel = panelFor(ref.current.panels, kind, targetId);
    if (!panel?.mediaId || panel.placeholder) return null;
    const data = await mediaDataUrl(panel.mediaId);
    if (!data) return null;
    try {
      return await downscaleToDataUrl(await dataUrlToBlob(data), max, 0.82);
    } catch {
      return data;
    }
  };

  /** The identity references a cut needs: drawn sheets when they exist, raw photos otherwise. */
  const subjectRefs = async (cut: PlanCut, plan: Plan): Promise<PanelRef[]> => {
    const refs: PanelRef[] = [];
    for (const cid of cut.characterIds) {
      const c = plan.characters.find((x) => x.id === cid);
      if (!c) continue;
      const sheet = await panelImage("character", c.id, 768);
      if (sheet) refs.push({ role: "character-sheet", label: c.name, dataUrl: sheet });
      else refs.push(...uploadRef(c.uploadId, "photo", c.name));
    }
    for (const pid of cut.productIds) {
      const p = plan.products.find((x) => x.id === pid);
      if (!p) continue;
      const sheet = await panelImage("product", p.id, 768);
      if (sheet) refs.push({ role: "product-sheet", label: p.name, dataUrl: sheet });
      else refs.push(...uploadRef(p.uploadId, "product-photo", p.name));
    }
    return refs;
  };

  const specFor = async (kind: PanelKind, targetId: string): Promise<{ spec: PanelSpec; caption: string } | null> => {
    const p = ref.current;
    const plan = p.plan;
    if (!plan) return null;
    switch (kind) {
      case "character": {
        const c = plan.characters.find((x) => x.id === targetId);
        if (!c) return null;
        return { spec: characterSheetPrompt(plan, c.id, p.brief, [...uploadRef(c.uploadId, "photo", c.name), ...styleRefs()]), caption: c.name };
      }
      case "product": {
        const pr = plan.products.find((x) => x.id === targetId);
        if (!pr) return null;
        return { spec: productSheetPrompt(plan, pr.id, p.brief, [...uploadRef(pr.uploadId, "product-photo", pr.name), ...styleRefs()]), caption: pr.name };
      }
      case "environment": {
        const e = plan.environments.find((x) => x.id === targetId);
        if (!e) return null;
        return { spec: environmentPrompt(plan, e.id, p.brief, [...uploadRef(e.uploadId, "location-photo", e.name), ...styleRefs()]), caption: e.name };
      }
      case "floorplan": {
        const refs: PanelRef[] = [];
        const env = plan.environments[0];
        const plate = env && (await panelImage("environment", env.id, 640));
        if (env && plate) refs.push({ role: "environment-plate", label: env.name, dataUrl: plate });
        else if (env) refs.push(...uploadRef(env.uploadId, "location-photo", env.name));
        return { spec: floorPlanPrompt(plan, refs), caption: "Top-down floor plan" };
      }
      case "elevation": {
        const last = plan.cuts[plan.cuts.length - 1];
        const env = plan.environments.find((e) => e.id === last?.environmentId) ?? plan.environments[0];
        const refs: PanelRef[] = [];
        const plate = env && (await panelImage("environment", env.id, 640));
        if (env && plate) refs.push({ role: "environment-plate", label: env.name, dataUrl: plate });
        return { spec: elevationPrompt(plan, refs), caption: `${last?.title ?? "Final cut"} — side elevation` };
      }
      case "cut": {
        const cut = plan.cuts.find((x) => x.id === targetId);
        if (!cut) return null;
        const refs: PanelRef[] = await subjectRefs(cut, plan);
        const env = plan.environments.find((e) => e.id === cut.environmentId);
        if (env) {
          const plate = await panelImage("environment", env.id, 640);
          if (plate) refs.push({ role: "environment-plate", label: env.name, dataUrl: plate });
          else refs.push(...uploadRef(env.uploadId, "location-photo", env.name));
        }
        refs.push(...styleRefs());
        return { spec: cutFramePrompt(plan, cut, p.brief, refs.slice(0, 8)), caption: cut.title };
      }
      case "lighting": {
        const l = plan.lighting.find((x) => x.id === targetId);
        if (!l) return null;
        const refs: PanelRef[] = [];
        const env = plan.environments[0];
        const plate = env && (await panelImage("environment", env.id, 512));
        if (env && plate) refs.push({ role: "environment-plate", label: env.name, dataUrl: plate });
        const hero = plan.products[0] ?? plan.characters[0];
        if (hero) {
          const kind: PanelKind = "notes" in hero ? "product" : "character";
          const sheet = await panelImage(kind, hero.id, 512);
          if (sheet) refs.push({ role: kind === "product" ? "product-sheet" : "character-sheet", label: hero.name, dataUrl: sheet });
        }
        return { spec: lightingPrompt(plan, l.id, p.brief, refs), caption: l.caption };
      }
    }
  };

  const setPanel = (kind: PanelKind, targetId: string, patch: Partial<Panel>) =>
    commit((p) => ({
      ...p,
      panels: p.panels.map((x) => (x.kind === kind && x.targetId === targetId ? { ...x, ...patch } : x)),
    }));

  const drawPanel = async (kind: PanelKind, targetId: string) => {
    const made = await specFor(kind, targetId);
    if (!made) return;
    setPanel(kind, targetId, { status: "drawing", error: undefined });
    try {
      let res;
      try {
        res = await requestPanel(made.spec, made.caption);
      } catch (err) {
        // OpenRouter reserves credit per in-flight request; on a low balance a
        // burst of panels trips a 402 that clears once the others settle.
        if (!/402|in-flight|credits/i.test(err instanceof Error ? err.message : "")) throw err;
        await new Promise((r) => setTimeout(r, 6000));
        res = await requestPanel(made.spec, made.caption);
      }
      if (res.refusal) throw new Error(res.refusal);
      const blob = await dataUrlToBlob(res.image);
      const mediaId = await putMedia(blob);
      // Any panel change makes the composed sheet stale.
      commit((p) => ({
        ...p,
        sheetMediaId: undefined,
        panels: p.panels.map((x) => (x.kind === kind && x.targetId === targetId ? { ...x, status: "done", mediaId, placeholder: res.placeholder === true } : x)),
      }));
    } catch (err) {
      setPanel(kind, targetId, { status: "error", error: err instanceof Error ? err.message : String(err) });
    }
  };

  /**
   * Draw order matters: characters, products and environments first, because
   * every cut frame is drawn FROM those so faces, packs and places match;
   * then the plan views and the cuts in parallel; lighting last.
   */
  /** Run jobs at most `limit` at a time — a burst of image calls can outrun a small OpenRouter balance. */
  const pool = async (jobs: (() => Promise<void>)[], limit = 4) => {
    const queue = [...jobs];
    await Promise.all(
      Array.from({ length: Math.min(limit, queue.length) }, async () => {
        while (queue.length) await queue.shift()!();
      }),
    );
  };

  const drawAll = async () => {
    const plan = ref.current.plan;
    if (!plan) return;
    commit((p) => ({ ...p, panels: panelsFor(plan, p.panels) }));
    const need = (kind: PanelKind, id: string) => {
      const x = panelFor(ref.current.panels, kind, id);
      return !x || x.status === "idle" || x.status === "error";
    };
    setBusy("Drawing reference sheets and set plates…");
    await pool([
      ...plan.characters.filter((c) => need("character", c.id)).map((c) => () => drawPanel("character", c.id)),
      ...plan.products.filter((p) => need("product", p.id)).map((p) => () => drawPanel("product", p.id)),
      ...plan.environments.filter((e) => need("environment", e.id)).map((e) => () => drawPanel("environment", e.id)),
    ]);
    setBusy("Drawing the storyboard…");
    await pool([
      ...(need("floorplan", "floorplan") ? [() => drawPanel("floorplan", "floorplan")] : []),
      ...(need("elevation", "elevation") ? [() => drawPanel("elevation", "elevation")] : []),
      ...plan.cuts.filter((c) => need("cut", c.id)).map((c) => () => drawPanel("cut", c.id)),
    ]);
    setBusy("Drawing lighting references…");
    await pool(plan.lighting.filter((l) => need("lighting", l.id)).map((l) => () => drawPanel("lighting", l.id)));
    setBusy("");
  };

  // ----- editing the plan --------------------------------------------------------

  const updatePlan = (fn: (plan: Plan) => Plan) =>
    commit((p) => {
      if (!p.plan) return p;
      const plan = fn(p.plan);
      return { ...p, plan, panels: panelsFor(plan, p.panels), sheetMediaId: undefined };
    });

  const updateCut = (id: string, patch: Partial<PlanCut>) =>
    updatePlan((plan) => ({ ...plan, cuts: plan.cuts.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));

  const moveCut = (id: string, dir: -1 | 1) =>
    updatePlan((plan) => {
      const i = plan.cuts.findIndex((c) => c.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= plan.cuts.length) return plan;
      const cuts = [...plan.cuts];
      [cuts[i], cuts[j]] = [cuts[j], cuts[i]];
      return { ...plan, cuts: renumber(cuts) };
    });

  const addCut = (afterId?: string) =>
    updatePlan((plan) => {
      if (plan.cuts.length >= 8) return plan;
      const i = afterId ? plan.cuts.findIndex((c) => c.id === afterId) : plan.cuts.length - 1;
      const base = plan.cuts[Math.max(0, i)];
      const fresh: PlanCut = {
        id: uid("cut"),
        title: "",
        lensMm: 50,
        aperture: "f/2",
        durationSec: Math.max(2, Math.round(ref.current.brief.totalSec / (plan.cuts.length + 1))),
        move: "static",
        framing: "medium",
        description: "New cut — describe what the frame shows.",
        action: "",
        dialogue: "",
        characterIds: base?.characterIds ?? [],
        productIds: base?.productIds ?? [],
        environmentId: base?.environmentId ?? plan.environments[0]?.id ?? null,
        position: "",
      };
      const cuts = [...plan.cuts];
      cuts.splice(i + 1, 0, fresh);
      return { ...plan, cuts: renumber(cuts) };
    });

  const deleteCut = (id: string) =>
    updatePlan((plan) => (plan.cuts.length <= 1 ? plan : { ...plan, cuts: renumber(plan.cuts.filter((c) => c.id !== id)) }));

  const setPromptOverride = (key: string, text: string | null) =>
    commit((p) => {
      const promptOverrides = { ...p.promptOverrides };
      if (text === null) delete promptOverrides[key];
      else promptOverrides[key] = text;
      return { ...p, promptOverrides };
    });

  // ----- the AI director chat ------------------------------------------------------

  const revise = async (message: string) => {
    const text = message.trim();
    const start = ref.current;
    if (!text || !start.plan || chatBusy) return;
    const history = (start.chat ?? []).map(({ role, text }) => ({ role, text }));
    commit((p) => ({ ...p, chat: [...(p.chat ?? []), { role: "user", text, at: nowIso() }] }));
    setChatBusy(true);
    try {
      const res = await requestRevision({ brief: start.brief, plan: start.plan, uploads: start.uploads, history, message: text });
      if (!res.plan) {
        commit((p) => ({ ...p, chat: [...(p.chat ?? []), { role: "ai", text: res.reply, at: nowIso() }] }));
        return;
      }
      const next = res.plan;
      const old = ref.current.plan ?? start.plan;
      const stale = new Set(stalePanels(old, next).map((x) => `${x.kind}:${x.targetId}`));
      commit((p) => {
        const kept = panelsFor(next, p.panels).map((x) =>
          stale.has(`${x.kind}:${x.targetId}`) ? { id: x.id, kind: x.kind, targetId: x.targetId, status: "idle" as const } : x,
        );
        const redraw = kept.filter((x) => x.status === "idle").length;
        return {
          ...p,
          title: next.title,
          plan: next,
          brief: { ...p.brief, cutCount: res.cutCount ?? p.brief.cutCount, totalSec: res.totalSec ?? p.brief.totalSec },
          panels: kept,
          sheetMediaId: undefined,
          promptOverrides: {},
          chat: [
            ...(p.chat ?? []),
            { role: "ai", text: `${res.reply}${redraw ? ` Redrawing ${redraw} panel${redraw === 1 ? "" : "s"}.` : ""}`, at: nowIso() },
          ],
        };
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      commit((p) => ({ ...p, chat: [...(p.chat ?? []), { role: "ai", text: `That didn't go through (${msg}). Try again.`, at: nowIso() }] }));
      return;
    } finally {
      setChatBusy(false);
    }
    await drawAll();
  };

  // ----- the composed sheet ----------------------------------------------------

  const composeSheet = async (): Promise<string | null> => {
    const p = ref.current;
    if (!p.plan) return null;
    if (p.sheetMediaId && urls[p.sheetMediaId]) return urls[p.sheetMediaId];
    // Resolve every panel's URL fresh so a just-finished panel is included.
    const map: Record<string, string> = {};
    for (const panel of p.panels) {
      if (!panel.mediaId) continue;
      const u = await mediaUrl(panel.mediaId);
      if (u) map[panel.mediaId] = u;
    }
    try {
      const { blob } = await renderSheet({ plan: p.plan, panels: p.panels, urls: map });
      const mediaId = await putMedia(blob);
      commit((cur) => ({ ...cur, sheetMediaId: mediaId }));
      return await mediaUrl(mediaId);
    } catch (err) {
      setError(`Could not compose the sheet (${err instanceof Error ? err.message : String(err)}).`);
      return null;
    }
  };

  // ----- video -------------------------------------------------------------------

  const mediaFor = async (cuts: PlanCut[], withSheet: boolean): Promise<H3Media> => {
    const p = ref.current;
    const plan = p.plan!;
    const media: H3Media = { ...EMPTY_MEDIA, characterSheets: [], productSheets: [], environmentPlates: [], styles: [] };
    for (const id of [...new Set(cuts.flatMap((c) => c.characterIds))]) {
      const sheet = await panelImage("character", id, 1024);
      const c = plan.characters.find((x) => x.id === id);
      const u = p.uploads.find((x) => x.id === c?.uploadId);
      // No drawn sheet: the raw photo is still the best identity anchor.
      const dataUrl = sheet ?? u?.dataUrl;
      if (dataUrl) media.characterSheets.push({ characterId: id, dataUrl });
    }
    for (const id of [...new Set(cuts.flatMap((c) => c.productIds))]) {
      const sheet = await panelImage("product", id, 1024);
      const pr = plan.products.find((x) => x.id === id);
      const u = p.uploads.find((x) => x.id === pr?.uploadId);
      const dataUrl = sheet ?? u?.dataUrl;
      if (dataUrl) media.productSheets.push({ productId: id, dataUrl });
    }
    for (const id of [...new Set(cuts.map((c) => c.environmentId).filter((v): v is string => Boolean(v)))]) {
      const plate = await panelImage("environment", id, 1024);
      if (plate) media.environmentPlates.push({ environmentId: id, dataUrl: plate });
    }
    if (cuts.length === 1) media.cutFrame = (await panelImage("cut", cuts[0].id, 1024)) ?? undefined;
    if (withSheet) {
      const url = await composeSheet();
      if (url) {
        try {
          media.sheet = await downscaleToDataUrl(await (await fetch(url)).blob(), 1600, 0.8);
        } catch {
          /* the film still renders without the sheet */
        }
      }
    }
    media.styles = p.uploads.filter((u) => u.role === "style").slice(0, 1).map((u) => ({ name: u.name || "style", dataUrl: u.dataUrl }));
    return media;
  };

  const briefFor = async (cut: PlanCut): Promise<H3Brief> => {
    const p = ref.current;
    const brief = composeH3Prompt(p.plan!, cut, p.brief, await mediaFor([cut], false));
    const override = p.promptOverrides[cut.id];
    return override ? { ...brief, text: override } : brief;
  };

  const fullBrief = async (): Promise<H3Brief> => {
    const p = ref.current;
    const brief = composeFullH3Prompt(p.plan!, p.brief, await mediaFor(p.plan!.cuts, true));
    const override = p.promptOverrides[FULL];
    return override ? { ...brief, text: override } : brief;
  };

  const setTake = (id: string, patch: Partial<Take>) =>
    commit((p) => ({ ...p, takes: p.takes.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));

  const runTake = async (cutId: string | null, brief: H3Brief, durationSec: number) => {
    const p = ref.current;
    const take: Take = { id: uid("take"), cutId, createdAt: nowIso(), prompt: brief.text, durationSec, status: "queued", engine: "minimax" };
    commit((cur) => ({ ...cur, takes: [...cur.takes, take] }));
    try {
      const start = await startRender({
        prompt: brief.text,
        durationSec,
        aspectRatio: p.brief.aspectRatio,
        resolution: QUALITY[p.brief.quality].resolution,
        references: brief.references.map((r) => ({ label: r.label, kind: "image" as const, dataUrl: r.dataUrl })),
      });
      if (start.mode === "done") return setTake(take.id, { status: "done", engine: "placeholder", note: "No video backend configured — animatic placeholder." });
      if (start.mode === "inline" && start.videoBase64) {
        const blob = await dataUrlToBlob(`data:video/mp4;base64,${start.videoBase64}`);
        return setTake(take.id, { status: "done", mediaId: await putMedia(blob) });
      }
      if (!start.taskId) throw new Error("The render started but returned no task id.");
      setTake(take.id, { status: "generating", taskId: start.taskId });
      await pollTake(take.id, start.taskId);
    } catch (err) {
      setTake(take.id, { status: "error", error: err instanceof Error ? err.message : String(err) });
    }
  };

  const render = async (cutId: string) => {
    const cut = ref.current.plan?.cuts.find((c) => c.id === cutId);
    if (!cut) return;
    setBusy(`Composing ${cut.title}…`);
    const brief = await briefFor(cut);
    setBusy("");
    await runTake(cutId, brief, standaloneSeconds(cut.durationSec));
  };

  const renderFull = async () => {
    const plan = ref.current.plan;
    if (!plan) return;
    setBusy("Composing the shot plan sheet…");
    const brief = await fullBrief();
    setBusy("");
    const total = plan.cuts.reduce((a, c) => a + c.durationSec, 0);
    await runTake(null, brief, Math.min(15, Math.max(4, total)));
  };

  const startVideo = () => {
    const full = ref.current.takes.filter((t) => t.cutId === null).pop();
    commit((p) => ({ ...p, stage: "video" }));
    if (full && (full.status === "queued" || full.status === "generating")) return;
    void renderFull();
  };

  const pollTake = async (takeId: string, taskId: string) => {
    for (let i = 0; i < 360; i++) {
      await new Promise((r) => setTimeout(r, i < 6 ? 4000 : 8000));
      const s = await renderStatus(taskId);
      if (s.status === "error") throw new Error(s.error || "The render failed.");
      if (s.status === "done") {
        let blob: Blob;
        if (s.videoBase64) blob = await dataUrlToBlob(`data:video/mp4;base64,${s.videoBase64}`);
        else blob = await downloadRender(taskId);
        setTake(takeId, { status: "done", mediaId: await putMedia(blob), note: undefined });
        return;
      }
      setTake(takeId, { status: s.status, note: s.note });
    }
    throw new Error("Timed out waiting for the render.");
  };

  // Resume polls for takes that were mid-render when the page was last open.
  const resumed = useRef(new Set<string>());
  useEffect(() => {
    for (const t of project.takes) {
      if ((t.status === "queued" || t.status === "generating") && t.taskId && !resumed.current.has(t.id)) {
        resumed.current.add(t.id);
        pollTake(t.id, t.taskId).catch((err) => setTake(t.id, { status: "error", error: err instanceof Error ? err.message : String(err) }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  return {
    project,
    projects,
    urls,
    busy,
    error,
    notice,
    commit,
    open,
    create,
    remove,
    setStage,
    plan,
    createVideo,
    drawAll,
    drawPanel,
    updatePlan,
    updateCut,
    moveCut,
    addCut,
    deleteCut,
    composeSheet,
    briefFor,
    fullBrief,
    render,
    renderFull,
    startVideo,
    revise,
    chatBusy,
    setPromptOverride,
    dismiss: () => {
      setError("");
      setNotice("");
    },
  };
}
