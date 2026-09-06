"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { generateSegment, fileToMediaRef } from "@/lib/seedance/client";
import { EDIT_MAX_DURATION, EDIT_MIN_DURATION } from "@/lib/seedance/constants";
import { KEY as SEEDANCE_KEY, blankProject, blankSegment, loadProjects, saveProject } from "@/lib/seedance/repo";
import { useRemotePull } from "@/lib/sync/useSync";
import type { AspectRatio, SeedanceProject, Segment } from "@/lib/seedance/types";
import { Icon } from "../icons";
import { Composer } from "./Composer";
import { Inspector } from "./Inspector";
import { PreviewPlayer } from "./PreviewPlayer";
import { Timeline } from "./Timeline";

export function SeedanceStudio() {
  const [project, setProject] = useState<SeedanceProject>(() => blankProject());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [saved, setSaved] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playheadSec, setPlayheadSec] = useState(0);

  const projectRef = useRef(project);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  const songInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // A reel saved on another device is pulled down, then the same restore
  // logic below runs again against the settled localStorage copy.
  useRemotePull(SEEDANCE_KEY, () => {
    const list = loadProjects();
    if (list.length) {
      setProject(list[0]);
      setSelectedId(list[0].segments[0]?.id ?? null);
    }
  });

  // Restore the most recent saved reel's structure on first mount.
  useEffect(() => {
    const list = loadProjects();
    if (list.length) {
      setProject(list[0]);
      setSelectedId(list[0].segments[0]?.id ?? null);
    } else {
      setSelectedId(projectRef.current.segments[0]?.id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalSec = useMemo(
    () => project.segments.reduce((s, seg) => s + seg.durationSec, 0),
    [project.segments],
  );
  const renderedCount = useMemo(
    () => project.segments.filter((s) => s.status === "done").length,
    [project.segments],
  );

  // Which segment is under the playhead.
  const { currentSegment, currentIndex } = useMemo(() => {
    let acc = 0;
    for (let i = 0; i < project.segments.length; i++) {
      const seg = project.segments[i];
      if (playheadSec < acc + seg.durationSec || i === project.segments.length - 1) {
        return { currentSegment: seg, currentIndex: i };
      }
      acc += seg.durationSec;
    }
    return { currentSegment: null as Segment | null, currentIndex: 0 };
  }, [project.segments, playheadSec]);

  const selected = project.segments.find((s) => s.id === selectedId) ?? null;
  const selectedIndex = project.segments.findIndex((s) => s.id === selectedId);

  // ----- playback ----------------------------------------------------------
  // Timestamp-based so the rate is correct even if more than one interval ever
  // ticks (e.g. React StrictMode double-mounts in dev): every tick derives the
  // playhead from a fixed start time rather than incrementing.
  const startRef = useRef(0);
  useEffect(() => {
    if (!playing) return;
    startRef.current = performance.now() - playheadSec * 1000;
    const id = window.setInterval(() => {
      const elapsed = (performance.now() - startRef.current) / 1000;
      if (elapsed >= totalSec) {
        setPlayheadSec(totalSec);
        setPlaying(false);
        audioRef.current?.pause();
      } else {
        setPlayheadSec(Math.round(elapsed * 10) / 10);
      }
    }, 100);
    return () => window.clearInterval(id);
    // playheadSec is only read to resume; adding it would restart every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, totalSec]);

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      audioRef.current?.pause();
      return;
    }
    if (playheadSec >= totalSec) setPlayheadSec(0);
    setPlaying(true);
    const audio = audioRef.current;
    if (audio && project.song?.url) {
      audio.currentTime = playheadSec >= totalSec ? 0 : playheadSec;
      void audio.play().catch(() => {});
    }
  };

  // ----- project mutations -------------------------------------------------
  const patch = (p: Partial<SeedanceProject>) => setProject((prev) => ({ ...prev, ...p }));
  const patchSegment = (id: string, sp: Partial<Segment>) =>
    setProject((prev) => ({
      ...prev,
      segments: prev.segments.map((s) => (s.id === id ? { ...s, ...sp } : s)),
    }));

  const addSegment = () => {
    const seg = { ...blankSegment(), mood: project.globalMood };
    setProject((prev) => ({ ...prev, segments: [...prev.segments, seg] }));
    setSelectedId(seg.id);
  };

  const deleteSegment = (id: string) =>
    setProject((prev) => {
      const segments = prev.segments.filter((s) => s.id !== id);
      if (selectedId === id) setSelectedId(segments[0]?.id ?? null);
      return { ...prev, segments };
    });

  const resizeSegment = (id: string, durationSec: number) => {
    const clamped = Math.min(EDIT_MAX_DURATION, Math.max(EDIT_MIN_DURATION, durationSec));
    patchSegment(id, { durationSec: clamped });
  };

  const moveSegment = (id: string, dir: -1 | 1) =>
    setProject((prev) => {
      const i = prev.segments.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.segments.length) return prev;
      const segments = [...prev.segments];
      [segments[i], segments[j]] = [segments[j], segments[i]];
      return { ...prev, segments };
    });

  const addRefs = async (segId: string, files: FileList) => {
    const refs = await Promise.all(Array.from(files).map(fileToMediaRef));
    setProject((prev) => ({
      ...prev,
      segments: prev.segments.map((s) =>
        s.id === segId ? { ...s, refs: [...s.refs, ...refs] } : s,
      ),
    }));
  };

  const removeRef = (segId: string, refId: string) =>
    setProject((prev) => ({
      ...prev,
      segments: prev.segments.map((s) =>
        s.id === segId ? { ...s, refs: s.refs.filter((r) => r.id !== refId) } : s,
      ),
    }));

  const onSongFile = (file: File) => {
    patch({ song: { name: file.name, type: file.type, url: URL.createObjectURL(file) } });
  };

  // ----- generation --------------------------------------------------------
  const generateOne = async (id: string) => {
    const cur = projectRef.current;
    const seg = cur.segments.find((s) => s.id === id);
    if (!seg) return;
    patchSegment(id, { status: "generating", error: undefined });
    const res = await generateSegment(cur, seg);
    if (res.status === "done") {
      patchSegment(id, {
        status: "done",
        engine: res.engine,
        videoUrl: res.videoUrl,
        posterHue: res.posterHue,
      });
    } else {
      patchSegment(id, { status: "error", error: res.error });
    }
  };

  const generateAll = async () => {
    setGeneratingAll(true);
    const ids = projectRef.current.segments.map((s) => s.id);
    for (const id of ids) await generateOne(id);
    setGeneratingAll(false);
  };

  const onSave = () => {
    saveProject(projectRef.current);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  };

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-2 border-b border-line bg-panel px-3 py-2.5 sm:px-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
          aria-label="Back to hub"
        >
          <Icon.ArrowLeft width={14} height={14} />
          <span className="hidden sm:inline">Hub</span>
        </Link>
        <span className="ml-1 text-sm font-semibold text-ink">Seedance Studio</span>
        <span className="ml-2 rounded-md bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
          Seedance 2 · prompt builder
        </span>
      </div>

      <div className="mx-auto w-full max-w-6xl space-y-3 px-3 py-4 sm:px-5">
        <Composer
          project={project}
          generatingAll={generatingAll}
          saved={saved}
          onName={(name) => patch({ name })}
          onBasePrompt={(basePrompt) => patch({ basePrompt })}
          onGlobalMood={(globalMood) => patch({ globalMood })}
          onAspect={(aspectRatio: AspectRatio) => patch({ aspectRatio })}
          onGenerateAll={generateAll}
          onSave={onSave}
        />

        <Timeline
          project={project}
          selectedId={selectedId}
          playheadSec={playheadSec}
          onSelectSegment={setSelectedId}
          onAddSegment={addSegment}
          onDeleteSegment={deleteSegment}
          onMoveSegment={moveSegment}
          onResizeSegment={resizeSegment}
          onPickSong={() => songInputRef.current?.click()}
          onClearSong={() => patch({ song: null })}
        />

        <div className="grid gap-3 lg:grid-cols-[minmax(320px,360px)_1fr]">
          <div className="min-h-[360px]">
            <Inspector
              segment={selected}
              index={selectedIndex < 0 ? 0 : selectedIndex}
              onChange={(sp) => selectedId && patchSegment(selectedId, sp)}
              onAddRefs={(files) => selectedId && addRefs(selectedId, files)}
              onRemoveRef={(refId) => selectedId && removeRef(selectedId, refId)}
              onGenerate={() => selectedId && generateOne(selectedId)}
              onDelete={() => selectedId && deleteSegment(selectedId)}
            />
          </div>
          <div className="min-h-[360px]">
            <PreviewPlayer
              aspectRatio={project.aspectRatio}
              currentSegment={currentSegment}
              currentIndex={currentIndex}
              playing={playing}
              playheadSec={playheadSec}
              totalSec={totalSec}
              renderedCount={renderedCount}
              totalCount={project.segments.length}
              onTogglePlay={togglePlay}
            />
          </div>
        </div>
      </div>

      {/* Hidden inputs / audio */}
      <input
        ref={songInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.[0]) onSongFile(e.target.files[0]);
          e.target.value = "";
        }}
      />
      {project.song?.url && <audio ref={audioRef} src={project.song.url} className="hidden" />}
    </div>
  );
}
