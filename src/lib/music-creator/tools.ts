// ---------------------------------------------------------------------------
// Music Creator — the tool registry.
//
// This is the extension point of the whole app. A tool is a self-contained
// music app that happens to live inside the studio: it owns its own screen,
// its own interface and its own state, and shares only the project store, the
// voice library and the GPU client with the others.
//
// To add a tool:
//   1. write `src/components/music-creator/tools/<YourTool>.tsx`, exporting a
//      component that takes `ToolProps`;
//   2. add one entry below;
//   3. lazy-load it in `toolComponent()` at the bottom of this file.
//
// Nothing else in the studio needs to change — the home grid, the routing, the
// project list and the "open in its own tool" behaviour all read this array.
//
// `requires` is what keeps the studio honest. A tool that needs a model the
// server does not have is shown with the reason spelled out rather than opening
// onto a button that cannot work. Tools requiring nothing (the writing tools)
// stay fully usable with no GPU at all, which is most of the studio's value on
// a laptop.
// ---------------------------------------------------------------------------

import type { Project } from "./types";

/** A capability a tool needs from the GPU server, or "ai" for the text model. */
export type Requirement = "yue2" | "auk" | "sheetsage" | "ai";

export interface ToolDef {
  id: string;
  title: string;
  /** One line under the title on the studio home. */
  tagline: string;
  /** The longer description on the tool's own header. */
  blurb: string;
  /** Grouping on the home screen. */
  area: "create" | "transform" | "voice";
  /** Icon key from the hub's icon set. */
  icon: "Sparkles" | "Layers" | "Bulb" | "Film" | "Mic" | "Note" | "Target";
  /** Two hues for the tile's gradient. */
  hue: [number, number];
  requires: Requirement[];
  /** False while a tool is registered but not yet written. */
  ready: boolean;
  /** What the tool can do with no GPU server at all. Shown in the offline note. */
  offlineNote?: string;
}

export const TOOLS: ToolDef[] = [
  {
    id: "song-creator",
    title: "Song Creator",
    tagline: "Full-song production, start to finish",
    blurb:
      "Write the style and the lyrics, plan the melody and harmony as a score you can read, " +
      "then render a complete 48 kHz stereo song with vocals and accompaniment on YuE2.",
    area: "create",
    icon: "Note",
    hue: [268, 199],
    requires: ["yue2"],
    ready: true,
    offlineNote:
      "Writing, the style builder, the lyric sheet and the arrangement all work with no GPU. " +
      "Only the render itself needs the server.",
  },
  {
    id: "hook-creator",
    title: "Hook Creator",
    tagline: "Catchy hooks, many at once",
    blurb:
      "Chase one earworm. Write a handful of hook candidates, then render the short ones you " +
      "like across several seeds and keep the take that sticks.",
    area: "create",
    icon: "Bulb",
    hue: [42, 330],
    requires: ["yue2"],
    ready: true,
    offlineNote: "Hook writing and comparison work offline; rendering needs the server.",
  },
  {
    id: "mashup",
    title: "Mashup",
    tagline: "One song's melody, another song's world",
    blurb:
      "Take the melody out of one recording as a readable score, then have it performed in the " +
      "style of another. SheetSage2 transcribes, YuE2 realises the result in melody mode.",
    area: "transform",
    icon: "Layers",
    hue: [190, 286],
    requires: ["sheetsage", "yue2"],
    ready: true,
    offlineNote: "The mashup plan can be built offline; transcription and rendering need the server.",
  },
  {
    id: "remix-stems",
    title: "Remix / Stems",
    tagline: "Edit the score, split the audio",
    blurb:
      "The white-box side of YuE2. Reharmonise, change tempo, swap instruments or restructure a " +
      "song by editing its ABC score and re-rendering — and split any audio into vocal and music.",
    area: "transform",
    icon: "Target",
    hue: [160, 199],
    requires: ["yue2"],
    ready: true,
    offlineNote: "Score editing and comparison work offline; re-rendering and separation need the server.",
  },
  {
    id: "artist-voice",
    title: "Artist Voice Studio",
    tagline: "Clone a voice, keep it, perform with it",
    blurb:
      "Find a voice, clone it with AuK, and save it to the Voice Library so it is never processed " +
      "twice. Then have it perform your words over music from the studio.",
    area: "voice",
    icon: "Mic",
    hue: [330, 22],
    requires: ["auk"],
    ready: true,
    offlineNote: "The library, the artist search and clip preparation work offline; cloning needs the server.",
  },
];

export function toolById(id: string): ToolDef | undefined {
  return TOOLS.find((t) => t.id === id);
}

export const AREAS: { id: ToolDef["area"]; title: string; note: string }[] = [
  { id: "create", title: "Create", note: "Start from nothing but an idea." },
  { id: "transform", title: "Transform", note: "Start from music that already exists." },
  { id: "voice", title: "Voice", note: "Who is singing, speaking or rapping it." },
];

/** What every tool component is handed by the studio shell. */
export interface ToolProps {
  project: Project;
  /** Merge a patch into the open project and persist it. */
  update: (patch: Partial<Project>) => void;
  /** Merge into the tool's own `data` bag without touching the rest. */
  setData: (patch: Record<string, unknown>) => void;
  /**
   * Update against the project as it is NOW rather than as it was at render.
   *
   * Use this for anything written AFTER an `await` — a model answer, a finished
   * job. `update({ request: { ...project.request, style } })` spreads the copy
   * the component rendered with, so a lyric typed while the model was thinking
   * would be thrown away when the answer landed.
   */
  patch: (fn: (current: Project) => Partial<Project>) => void;
}
