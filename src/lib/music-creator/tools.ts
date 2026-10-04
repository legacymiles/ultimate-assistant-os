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
  /**
   * A looping clip for the tile, and the still that shows at rest.
   *
   * Made by the preview-icon skill, which films what the tool DOES to
   * something rather than a picture of its screen — a generated interface is
   * garbled mush at this size and dates instantly. The poster is what paints;
   * the clip is mounted only on hover (see `Tile`), so a grid of these costs
   * nothing until somebody reaches for one.
   */
  previewIcon?: { src: string; poster: string };
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
    tagline: "Type a style and lyrics — an AI producer does the rest",
    blurb:
      "Type the style (a one-line idea or a full production prompt) and, optionally, lyrics. The AI Producer " +
      "reads the idea, designs the record, and engineers a ≤1,000-character style, finished lyrics, vocal and " +
      "arrangement direction — shown next to your original — or send it exactly as typed. Renders a complete " +
      "48 kHz stereo song on YuE2, waking the GPU if it is asleep.",
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
    tagline: "Hear both records in parts, then decide what each one gives",
    blurb:
      "Say which two records you want in one line; the catalogue finds them. Hear one part at a time " +
      "first — each song's vocal, drums, bass and instruments as separate files, one click each — then " +
      "choose what comes from which, and which record wins. Generated builds a new recording from both " +
      "(SheetSage2 + YuE2); Layered lays one record's real vocal over the other's real backing, reusing " +
      "the stems you already compared. Prompt for a change and the next version joins the same session, " +
      "every one of them still playable and downloadable.",
    area: "transform",
    icon: "Layers",
    hue: [190, 286],
    // Two slabs, each banded into its parts, interlocking into one.
    previewIcon: { src: "/hub/icons/mashup.mp4", poster: "/hub/icons/mashup.webp" },
    // YuE2 only, even though the tool can also use SheetSage2 and AuK.
    //
    // `requires` gates the WHOLE tool, and this tool has two routes that need
    // different engines: generated needs YuE2 to render (and SheetSage2 only
    // to transcribe, which a pasted score makes optional), layered needs AuK.
    // Listing all three meant a server without SheetSage2 disabled rendering,
    // which SheetSage2 has nothing to do with. The per-step engines are
    // checked next to the buttons that need them instead, where the message
    // can say what to do about it.
    requires: ["yue2"],
    ready: true,
    offlineNote:
      "Finding the songs, the blend plan and the style line all work with no GPU. Transcription, " +
      "separation and rendering need the server.",
  },
  {
    id: "remix-stems",
    title: "Remix",
    tagline: "Search a song, say what it should become",
    blurb:
      "Search the catalogue for a record, then say what to turn it into — a NY drill remix, a slow " +
      "country ballad. Its melody is transcribed and performed in the style you asked for, with that " +
      "style's real tempo and arrangement behind it rather than its name alone. Heard it? Ask for one " +
      "more change and the next version joins the same session. The record's own parts are here too, " +
      "separated: play the vocal or the kit on its own, or take the score apart by hand.",
    area: "transform",
    icon: "Target",
    hue: [160, 199],
    // A record on edge, its grooves re-cut behind a passing band of light.
    previewIcon: { src: "/hub/icons/remix.mp4", poster: "/hub/icons/remix.webp" },
    requires: ["yue2"],
    ready: true,
    offlineNote:
      "Searching, the style presets, the plan, the score editor and the lyric sheet all work with no " +
      "GPU. Transcription, separation and rendering need the server.",
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
