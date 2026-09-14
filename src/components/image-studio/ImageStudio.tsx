"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { AgentPicker } from "./AgentPicker";
import { Composer, type Ref } from "./Composer";
import { Gallery, type Job } from "./Gallery";
import { generateOne, rewrite } from "./api";
import { AGENTS, agentById } from "@/lib/image-studio/agents";
import { loadGallery, saveGallery, type GalleryItem } from "@/lib/image-studio/gallery";
import { dataUrlToBlob, deleteMedia, downscaleToDataUrl, getMedia, putMedia } from "@/lib/image-studio/media";
import { fallbackPrompt, MAX_REFS } from "@/lib/image-studio/prompt";
import { uid } from "@/lib/utils";

export function ImageStudio() {
  const [agentId, setAgentId] = useState(AGENTS[0].id);
  const [prompt, setPrompt] = useState("");
  const [refs, setRefs] = useState<Ref[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [count, setCount] = useState(2);
  const [rewriting, setRewriting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [offline, setOffline] = useState(false);
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  /** Images that could not be written to IndexedDB, kept for this tab only. */
  const memory = useRef(new Map<string, string>());
  const composerTop = useRef<HTMLDivElement>(null);

  const agent = agentById(agentId) ?? AGENTS[0];

  useEffect(() => setItems(loadGallery()), []);

  const updateItems = (fn: (prev: GalleryItem[]) => GalleryItem[]) =>
    setItems((prev) => {
      const next = fn(prev);
      saveGallery(next);
      return next;
    });

  const pickAgent = (id: string) => {
    if (id === agentId) return;
    setAgentId(id);
    setExpanded(null);
    setNotice("");
  };

  const refInputs = (list: Ref[]) => list.map((r) => ({ role: r.role, dataUrl: r.dataUrl }));

  const doRewrite = async (soften = false, basePrompt = prompt) => {
    if (!basePrompt.trim()) return setError("Write a prompt first.");
    setError("");
    setRewriting(true);
    try {
      const res = await rewrite({ agentId, prompt: basePrompt, refs: refInputs(refs), soften });
      setExpanded(res.prompt);
      if (res.offline) setOffline(true);
      setNotice(res.warning ?? (soften ? "Softened — check the prompt, then generate again." : ""));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRewriting(false);
    }
  };

  const runJob = async (job: Job) => {
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...job, status: "running", message: "" } : j)));
    try {
      const res = await generateOne({ agentId: job.agentId, prompt: job.prompt, refs: job.refs, variant: job.variant });
      if (!res.image) {
        setJobs((prev) =>
          prev.map((j) => (j.id === job.id ? { ...j, status: "refused", message: res.refusal ?? "No image came back." } : j)),
        );
        return;
      }
      if (res.offline) setOffline(true);
      const blob = await dataUrlToBlob(res.image);
      let mediaId = await putMedia(blob);
      if (!mediaId) {
        mediaId = uid("mem");
        memory.current.set(mediaId, URL.createObjectURL(blob));
      }
      const item: GalleryItem = {
        id: uid("gal"),
        agentId: job.agentId,
        rawPrompt: job.rawPrompt,
        prompt: job.prompt,
        refRoles: job.refs.map((r) => r.role),
        mediaId,
        model: res.model ?? "",
        offline: !!res.offline,
        createdAt: Date.now(),
      };
      updateItems((prev) => [item, ...prev]);
      setJobs((prev) => prev.filter((j) => j.id !== job.id));
    } catch (err) {
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: "failed", message: (err as Error).message } : j)));
    }
  };

  const generate = () => {
    if (!prompt.trim() && !expanded?.trim()) return setError("Write a prompt first.");
    setError("");
    const finalPrompt = expanded?.trim() || fallbackPrompt(agent, prompt);
    const snapshot = refInputs(refs);
    const batch: Job[] = Array.from({ length: count }, (_, i) => ({
      id: uid("job"),
      agentId,
      rawPrompt: prompt.trim() || finalPrompt,
      prompt: finalPrompt,
      refs: snapshot,
      variant: i,
      status: "running",
      message: "",
    }));
    setJobs((prev) => [...batch, ...prev]);
    batch.forEach(runJob);
  };

  const soften = (job: Job) => {
    setJobs((prev) => prev.filter((j) => j.status !== "refused"));
    setAgentId(job.agentId);
    void doRewrite(true, job.rawPrompt);
    composerTop.current?.scrollIntoView({ behavior: "smooth" });
  };

  const addFiles = async (files: File[]) => {
    const room = MAX_REFS - refs.length;
    if (room <= 0) return setError(`You can use up to ${MAX_REFS} reference images.`);
    if (files.length > room) setNotice(`Only the first ${room} image${room === 1 ? "" : "s"} were added (limit ${MAX_REFS}).`);
    const added: Ref[] = [];
    for (const file of files.filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name)).slice(0, room)) {
      try {
        added.push({ id: uid("ref"), role: "person", name: file.name, dataUrl: await downscaleToDataUrl(file) });
      } catch {
        setError(`Couldn't read "${file.name}". HEIC photos from iPhone may need converting to JPEG first.`);
      }
    }
    if (added.length) {
      setRefs((prev) => [...prev, ...added].slice(0, MAX_REFS));
      setExpanded(null);
    }
  };

  const refine = async (item: GalleryItem) => {
    const blob = memory.current.has(item.mediaId)
      ? await dataUrlToBlob(memory.current.get(item.mediaId)!)
      : await getMedia(item.mediaId);
    if (!blob) return setError("That image is no longer stored in this browser.");
    if (refs.length >= MAX_REFS) return setError(`Remove a reference first — the limit is ${MAX_REFS}.`);
    const dataUrl = await downscaleToDataUrl(blob);
    setRefs((prev) => [...prev, { id: uid("ref"), role: "person", name: "Refined result", dataUrl }]);
    setAgentId(item.agentId);
    setPrompt(item.rawPrompt);
    setExpanded(null);
    setNotice("Added the image as a Person reference. Change the prompt and generate again.");
    composerTop.current?.scrollIntoView({ behavior: "smooth" });
  };

  const remove = async (item: GalleryItem) => {
    updateItems((prev) => prev.filter((i) => i.id !== item.id));
    memory.current.delete(item.mediaId);
    await deleteMedia(item.mediaId);
  };

  const running = jobs.filter((j) => j.status === "running").length;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
        >
          <Icon.ArrowLeft width={13} height={13} />
          Hub
        </Link>
        <span className="text-sm font-semibold text-ink">Image Studio</span>
        <span className="ml-auto text-xs text-ink-faint">
          {running ? `Generating ${running}…` : `${items.length} image${items.length === 1 ? "" : "s"}`}
        </span>
      </header>

      {offline && (
        <div className="border-b border-line bg-panel-2 px-4 py-2 text-center text-xs text-ink-muted">
          Offline preview mode — no AI key is configured, so you&apos;re seeing placeholders. Add OPENROUTER_API_KEY to generate real images.
        </div>
      )}

      <main className="mx-auto grid max-w-[1500px] gap-5 px-4 py-5 lg:grid-cols-[440px_1fr]">
        <div ref={composerTop} className="flex scroll-mt-16 flex-col gap-4 lg:sticky lg:top-16 lg:max-h-[calc(100dvh-5rem)] lg:overflow-y-auto lg:pr-1">
          <AgentPicker agents={AGENTS} selected={agentId} onSelect={pickAgent} />
          <Composer
            agent={agent}
            prompt={prompt}
            onPrompt={setPrompt}
            refs={refs}
            onRefs={(next) => {
              setRefs(next);
              setExpanded(null);
            }}
            onFiles={addFiles}
            expanded={expanded}
            onExpanded={setExpanded}
            count={count}
            onCount={setCount}
            rewriting={rewriting}
            onRewrite={() => doRewrite(false)}
            onGenerate={generate}
            error={error}
            notice={notice}
          />
        </div>

        <Gallery
          items={items}
          jobs={jobs}
          memory={memory.current}
          onRetry={runJob}
          onDismiss={(job) => setJobs((prev) => prev.filter((j) => j.id !== job.id))}
          onSoften={soften}
          onRefine={refine}
          onDelete={remove}
        />
      </main>
    </div>
  );
}
