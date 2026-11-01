// ---------------------------------------------------------------------------
// The seven studios behind Jarvis's Studio tab.
//
// Studio used to be one wall of workflow cards, and the other six studios the
// owner had built — Image, Audio, Music Video, Game Creator, Personas — were
// plugin cards on a different page that opened in their own tab. So "Studio"
// named one of seven and the rest sat behind a door you had to remember. This
// file is the list of all seven and what each one holds.
//
// It is pure data on purpose: no React, no imports from components. The shell
// (src/components/jarvis/StudioShell.tsx) owns the map from a section's `mount`
// key to the component it mounts, and `MountKey` is a closed union, so a studio
// that names a section the shell cannot mount fails to compile rather than
// rendering an empty pane.
//
// Nothing here reimplements a studio. Each section points at the component that
// already existed as its own app, which is why gathering them cost none of them
// a feature — the same bargain JarvisAudioStudio made with its three.
// ---------------------------------------------------------------------------

/** Every component the shell knows how to mount. Closed on purpose — see above. */
export type MountKey =
  | "video-workflows"
  | "image-workflows"
  | "smart-shot"
  | "video-arena"
  | "studio3d"
  | "gallery"
  | "image-agents"
  | "audio-find"
  | "audio-classify"
  | "audio-create"
  | "music-video"
  | "game-creator"
  | "kart"
  | "slippery"
  | "personas"
  | "dance-vault"
  | "realtime-lucy"
  | "trading-agent"
  | "ea-lab"
  | "calculator";

export interface StudioSection {
  id: string;
  /** The label on the section rail, and on the card's spine. */
  label: string;
  /** One line, shown under the rail label when there is room. */
  blurb: string;
  mount: MountKey;
  /** Icon name from src/components/icons. */
  icon: string;
  /** True when this section is new and has nothing behind it yet. */
  stub?: boolean;
}

export interface Studio {
  id: StudioId;
  name: string;
  /** The line under the name on the wall. */
  tagline: string;
  /**
   * What this studio makes, in a sentence, for the card's back and the shell's
   * header. Longer than the tagline, shorter than the catalog's overview.
   */
  blurb: string;
  /** Card hue, 0–360. Used for the edge glow and the spine ticks, not fills. */
  hue: number;
  /**
   * The looping clip on the card, once `preview-icon` has rendered it. Absent
   * means the card falls back to its poster and then to the CSS motif, which is
   * why this is optional rather than a path to a file that may not exist.
   */
  clip?: { video?: string; poster?: string };
  sections: StudioSection[];
}

export type StudioId =
  | "video"
  | "image"
  | "audio"
  | "music-video"
  | "game"
  | "personas"
  | "money";

/**
 * The wall, in the order it is drawn. Video is first because it is the studio
 * the tab used to be, so the owner's muscle memory still lands on it.
 */
export const STUDIOS: Studio[] = [
  {
    id: "video",
    name: "Video Studio",
    tagline: "The video agent",
    blurb:
      "The wall of workflows and the three engines behind it: a storyboard you can edit before "
      + "anything renders, five engines racing one prompt, and an animation director that builds "
      + "the scene in 3D.",
    hue: 258,
    clip: { video: "/studio/video.mp4", poster: "/studio/video.webp" },
    sections: [
      {
        id: "workflows",
        label: "Workflows",
        blurb: "The wall, the composer and the camera deck",
        mount: "video-workflows",
        icon: "Film",
      },
      {
        id: "smart-shot",
        label: "Smart Shot",
        blurb: "Prompt → editable storyboard → H3 video",
        mount: "smart-shot",
        icon: "Layers",
      },
      {
        id: "arena",
        label: "Arena",
        blurb: "One prompt, five engines, one finished video",
        mount: "video-arena",
        icon: "Target",
      },
      {
        id: "3d",
        label: "3D Director",
        blurb: "Describe a video, an AI animation director makes it",
        mount: "studio3d",
        icon: "Aperture",
      },
      {
        id: "gallery",
        label: "Gallery",
        blurb: "Everything this studio has made",
        mount: "gallery",
        icon: "Image",
      },
    ],
  },
  {
    id: "image",
    name: "Image Studio",
    tagline: "Where the frame gets made",
    blurb:
      "Specialist agents that hold a face across a whole set of stills, plus the image half of "
      + "the workflow wall — so the first frame a video is handed is already the person and the "
      + "look you meant.",
    hue: 190,
    clip: { video: "/studio/image.mp4", poster: "/studio/image.webp" },
    sections: [
      {
        id: "agents",
        label: "Agents",
        blurb: "Specialist image agents, one face across a set",
        mount: "image-agents",
        icon: "Sparkles",
      },
      {
        id: "workflows",
        label: "Workflows",
        blurb: "Covers, posters and the rest of the image wall",
        mount: "image-workflows",
        icon: "Frame",
      },
      {
        id: "gallery",
        label: "Gallery",
        blurb: "Everything this studio has made",
        mount: "gallery",
        icon: "Grid",
      },
    ],
  },
  {
    id: "audio",
    name: "Audio Studio",
    tagline: "Find it, file it, make it",
    blurb:
      "The soundtrack half of Studio, all three parts: pull the exact recording with its licence "
      + "recorded, read back what a track actually is, or write the song when nothing that exists "
      + "fits the film.",
    hue: 142,
    clip: { video: "/studio/audio.mp4", poster: "/studio/audio.webp" },
    sections: [
      {
        id: "find",
        label: "Find",
        blurb: "The exact recording, with its licence recorded",
        mount: "audio-find",
        icon: "Search",
      },
      {
        id: "classify",
        label: "Classify",
        blurb: "Tempo, key and energy, read back off the file",
        mount: "audio-classify",
        icon: "Waveform",
      },
      {
        id: "create",
        label: "Create",
        blurb: "Write and render the song itself",
        mount: "audio-create",
        icon: "Mic",
      },
    ],
  },
  {
    id: "music-video",
    name: "Music Video Studio",
    tagline: "Studio the other way round",
    blurb:
      "Every other studio starts from a prompt and the audio arrives last. This one starts from "
      + "the track — it measures the tempo, the bars, the sections and the drops, transcribes the "
      + "words, and cuts the film to them.",
    hue: 318,
    clip: { video: "/studio/music-video.mp4", poster: "/studio/music-video.webp" },
    sections: [
      {
        id: "engine",
        label: "Engine",
        blurb: "Track → bars → cuts → lip-sync",
        mount: "music-video",
        icon: "Waveform",
      },
    ],
  },
  {
    id: "game",
    name: "Game Creator Studio",
    tagline: "The studio that builds something",
    blurb:
      "Describe a game and Unreal on this PC builds it, playtests it and packages a Windows "
      + "executable — and the screenshots it takes from the player's eye are plates the other "
      + "studios can shoot from.",
    hue: 28,
    clip: { video: "/studio/game.mp4", poster: "/studio/game.webp" },
    sections: [
      {
        id: "creator",
        label: "Game Creator",
        blurb: "Describe a game, Unreal builds and packages it",
        mount: "game-creator",
        icon: "Play",
      },
      {
        id: "kart",
        label: "Kart Teardown",
        blurb: "The interactive 3D showcase",
        mount: "kart",
        icon: "Move",
      },
      {
        id: "slippery",
        label: "Slippery Escape",
        blurb: "First-person physics escape",
        mount: "slippery",
        icon: "Flag",
      },
    ],
  },
  {
    id: "personas",
    name: "Personas Studio",
    tagline: "Who the work is for, and who makes it",
    blurb:
      "Your creator accounts with an AI that knows each one's voice, the verified dances a "
      + "workflow can actually be pointed at, and a live world model that re-imagines your "
      + "webcam as someone else.",
    hue: 280,
    clip: { video: "/studio/personas.mp4", poster: "/studio/personas.webp" },
    sections: [
      {
        id: "personas",
        label: "Personas",
        blurb: "Creator accounts, and an AI that knows them",
        mount: "personas",
        icon: "Users",
      },
      {
        id: "dances",
        label: "Dance Vault",
        blurb: "Real dances that play, with the song and the year",
        mount: "dance-vault",
        icon: "Star",
      },
      {
        id: "lucy",
        label: "Realtime Lucy",
        blurb: "Your webcam, re-imagined live by a world model",
        mount: "realtime-lucy",
        icon: "Camera",
      },
    ],
  },
  {
    id: "money",
    name: "Money Agent Studio",
    tagline: "Reads the setup. Never presses the button.",
    blurb:
      "An agent that reads a setup and argues about the risk, a bench that backtests your "
      + "MetaTrader bots on this PC and files them by how they fail, and the calculator that "
      + "sizes the orders. It has no broker connection and places no orders.",
    hue: 48,
    clip: { video: "/studio/money.mp4", poster: "/studio/money.webp" },
    sections: [
      {
        id: "agent",
        label: "Trading Agent",
        blurb: "Reads a setup, argues the risk, signs nothing",
        mount: "trading-agent",
        icon: "Bot",
      },
      {
        id: "ea-lab",
        label: "EA Lab",
        blurb: "Backtests your bots, filed by how they fail",
        mount: "ea-lab",
        icon: "Server",
      },
      {
        id: "calculator",
        label: "Calculator",
        blurb: "Sizes a multi-order position and charts it",
        mount: "calculator",
        icon: "Cash",
      },
    ],
  },
];

/** The studio with this id, or null. Used by the tab's deep links. */
export function getStudio(id: string): Studio | null {
  return STUDIOS.find((s) => s.id === id) ?? null;
}

/**
 * The section this studio should open on: the one the URL or the remembered
 * choice named, else the first. Nullable `wanted` on purpose — "the link said
 * Arena" and "the link said nothing" lead to different behaviour, and a plain
 * default cannot tell them apart.
 */
export function sectionFor(studio: Studio, wanted: string | null): StudioSection {
  if (wanted) {
    const hit = studio.sections.find((s) => s.id === wanted);
    if (hit) return hit;
  }
  return studio.sections[0];
}

/**
 * The studios that used to be reached as their own app, mapped to where they
 * live now, so an old link or an old pointer still lands somewhere real.
 *
 * `plugins.ts` drops these slugs from the plugin page, and this is the other
 * half of that move: the forwarding address.
 */
export const MOVED_IN: Record<string, { studio: StudioId; section: string }> = {
  "money-agent": { studio: "money", section: "agent" },
  "image-studio": { studio: "image", section: "agents" },
  "jarvis-audio-studio": { studio: "audio", section: "find" },
  "seedance-studio": { studio: "music-video", section: "engine" },
  "game-creator": { studio: "game", section: "creator" },
  "social-personas": { studio: "personas", section: "personas" },
  "tiktok-dances": { studio: "personas", section: "dances" },
  "smart-shot-videos": { studio: "video", section: "smart-shot" },
  "video-studio-arena": { studio: "video", section: "arena" },
  "3d-studio": { studio: "video", section: "3d" },
  "kart-showcase": { studio: "game", section: "kart" },
  "slippery-escape": { studio: "game", section: "slippery" },
  "realtime-lucy": { studio: "personas", section: "lucy" },
  "ea-lab": { studio: "money", section: "ea-lab" },
  "multi-order-calculator": { studio: "money", section: "calculator" },
};

/** The hash a studio section is addressed by, e.g. `#studio/video/arena`. */
export function studioHash(studio: StudioId, section?: string): string {
  return section ? `#studio/${studio}/${section}` : `#studio/${studio}`;
}

/** Reads `#studio/video/arena` back. Returns null for anything else. */
export function parseStudioHash(hash: string): { studio: StudioId; section: string | null } | null {
  const m = /^#?studio\/([a-z-]+)(?:\/([a-z0-9-]+))?$/.exec(hash.trim());
  if (!m) return null;
  const studio = getStudio(m[1]);
  if (!studio) return null;
  return { studio: studio.id, section: m[2] ?? null };
}
