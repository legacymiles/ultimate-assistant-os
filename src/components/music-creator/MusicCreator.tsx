"use client";

// ---------------------------------------------------------------------------
// Music Creator — the studio shell.
//
// The shell owns the chrome and nothing else: the header, the home grid, the
// project list, the Voice Library, and the frame a tool is mounted into. It
// knows which tools exist only through the registry in lib/music-creator/tools,
// so adding a music app to this studio never means editing this file beyond one
// lazy import.
// ---------------------------------------------------------------------------

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo } from "react";
import { Icon } from "../icons";
import { AREAS, TOOLS, type ToolDef, type ToolProps, toolById } from "@/lib/music-creator/tools";
import { Projects } from "./Projects";
import { VoiceLibrary } from "./VoiceLibrary";
import { RunBar, missingFor } from "./parts";
import { StudioProvider, useOpenProject, useStudio } from "./studio";
import "./music-creator.css";

// Each tool is its own bundle: the studio home should not carry the weight of
// every instrument in it, and a broken tool cannot take the shell down with it.
const LOADERS: Record<string, React.ComponentType<ToolProps>> = {
  "song-creator": dynamic(() => import("./tools/SongCreator").then((m) => m.SongCreator), { ssr: false }),
  "hook-creator": dynamic(() => import("./tools/HookCreator").then((m) => m.HookCreator), { ssr: false }),
  mashup: dynamic(() => import("./tools/Mashup").then((m) => m.Mashup), { ssr: false }),
  "remix-stems": dynamic(() => import("./tools/RemixStems").then((m) => m.RemixStems), { ssr: false }),
  "artist-voice": dynamic(() => import("./tools/ArtistVoice").then((m) => m.ArtistVoice), { ssr: false }),
};

export function MusicCreator() {
  return (
    <StudioProvider>
      <Shell />
    </StudioProvider>
  );
}

function Shell() {
  const { view } = useStudio();
  return (
    <div className="mc">
      <Header />
      <main className="mc-main">
        {view.kind === "home" && <Home />}
        {view.kind === "projects" && <Projects />}
        {view.kind === "voices" && <VoiceLibrary />}
        {view.kind === "tool" && <ToolFrame />}
      </main>
    </div>
  );
}

function Header() {
  const { view, go, server, checkingServer, refreshServer, projects, voices } = useStudio();
  const tool = view.kind === "tool" ? toolById(view.toolId) : null;

  const status = checkingServer
    ? { cls: "is-wait", text: "checking GPU" }
    : server?.reachable
      ? { cls: "is-on", text: server.health?.gpu?.name ? server.health.gpu.name.replace(/NVIDIA GeForce /, "") : "GPU ready" }
      : { cls: "is-off", text: "no GPU server" };

  return (
    <header className="mc-head">
      <div className="mc-head-l">
        {view.kind === "home" ? (
          <Link href="/" className="mc-back" aria-label="Back to the hub">
            <Icon.ArrowLeft width={14} height={14} />
          </Link>
        ) : (
          <button type="button" className="mc-back" onClick={() => go({ kind: "home" })} aria-label="Back to the studio">
            <Icon.ArrowLeft width={14} height={14} />
          </button>
        )}
        <div className="mc-brand-w">
          <div className="mc-brand">
            MUSIC <span>CREATOR</span>
          </div>
          <div className="mc-tag">{tool ? tool.tagline : "a studio of music tools"}</div>
        </div>
      </div>

      <nav className="mc-nav">
        <button type="button" className={`mc-navb ${view.kind === "home" ? "is-on" : ""}`} onClick={() => go({ kind: "home" })}>
          Studio
        </button>
        <button type="button" className={`mc-navb ${view.kind === "projects" ? "is-on" : ""}`} onClick={() => go({ kind: "projects" })}>
          Projects <i>{projects.length}</i>
        </button>
        <button type="button" className={`mc-navb ${view.kind === "voices" ? "is-on" : ""}`} onClick={() => go({ kind: "voices" })}>
          Voices <i>{voices.length}</i>
        </button>
      </nav>

      <button type="button" className={`mc-status ${status.cls}`} onClick={refreshServer} title={server?.reason ?? "Check the GPU server again"}>
        <span className="mc-dot" />
        {status.text}
      </button>
    </header>
  );
}

function Home() {
  const { openTool, server, projects, openProject } = useStudio();
  const recent = useMemo(() => [...projects].sort((a, b) => b.updated - a.updated).slice(0, 4), [projects]);

  return (
    <div className="mc-home">
      <section className="mc-hero">
        <h1>
          Everything that makes a record,
          <br />
          <em>one tool at a time.</em>
        </h1>
        <p>
          Write it, plan the melody as a score you can read, render it as a real 48 kHz song with YuE2, and put a voice
          you saved on top of it. Each tool below is its own instrument — the studio is what they share.
        </p>
      </section>

      {AREAS.map((area) => {
        const tools = TOOLS.filter((t) => t.area === area.id);
        if (!tools.length) return null;
        return (
          <section key={area.id} className="mc-area">
            <div className="mc-area-h">
              <h2>{area.title}</h2>
              <p>{area.note}</p>
            </div>
            <div className="mc-grid">
              {tools.map((tool) => (
                <Tile key={tool.id} tool={tool} onOpen={() => openTool(tool.id)} offline={missingFor(tool, server).length > 0} />
              ))}
            </div>
          </section>
        );
      })}

      {recent.length > 0 && (
        <section className="mc-area">
          <div className="mc-area-h">
            <h2>Pick up where you left off</h2>
            <p>Projects save themselves as you work.</p>
          </div>
          <div className="mc-recent">
            {recent.map((p) => (
              <button key={p.id} type="button" className="mc-recent-c" onClick={() => openProject(p)}>
                <strong>{p.title || "Untitled"}</strong>
                <span>{toolById(p.toolId)?.title ?? p.toolId}</span>
                <time>{new Date(p.updated).toLocaleDateString()}</time>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Tile({ tool, onOpen, offline }: { tool: ToolDef; onOpen: () => void; offline: boolean }) {
  const Glyph = Icon[tool.icon];
  return (
    <button
      type="button"
      className="mc-tile"
      onClick={onOpen}
      style={{ ["--a" as string]: `${tool.hue[0]}`, ["--b" as string]: `${tool.hue[1]}` }}
    >
      <span className="mc-tile-art" aria-hidden>
        <Glyph width={20} height={20} />
      </span>
      <strong>{tool.title}</strong>
      <span className="mc-tile-tag">{tool.tagline}</span>
      <span className="mc-tile-blurb">{tool.blurb}</span>
      {offline && <span className="mc-tile-off">needs the GPU server to render</span>}
    </button>
  );
}

function ToolFrame() {
  const { view, updateProject, patchProject } = useStudio();
  const project = useOpenProject();
  const tool = view.kind === "tool" ? toolById(view.toolId) : null;

  if (!project || !tool) {
    return <p className="mc-empty">That project is no longer here.</p>;
  }

  const Tool = LOADERS[tool.id];
  if (!Tool) {
    return <p className="mc-empty">{tool.title} is registered but not built yet.</p>;
  }

  return (
    <div className="mc-tool">
      <div className="mc-tool-h">
        <input
          className="mc-title"
          value={project.title}
          onChange={(e) => updateProject(project.id, { title: e.target.value })}
          placeholder="Untitled"
          aria-label="Project title"
        />
        <p className="mc-tool-blurb">{tool.blurb}</p>
      </div>
      <RunBar />
      <Tool
        project={project}
        update={(patch) => updateProject(project.id, patch)}
        // Merged against the live project, not this render's copy: a tool can
        // write into `data` after a job that ran for minutes, and the fields
        // the user edited meanwhile must survive it.
        setData={(patch) => patchProject(project.id, (p) => ({ data: { ...(p.data ?? {}), ...patch } }))}
        patch={(fn) => patchProject(project.id, fn)}
      />
    </div>
  );
}
