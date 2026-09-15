// ---------------------------------------------------------------------------
// The studio's tool registry.
//
// Every production tool the director can hand work to is declared here once:
// what kind of work it does, where it runs, and which MCP server (if any)
// Claude drives it through. The director, the tool-plan UI, the builder prompt
// and the skill all read this list, so adding a tool later — a voice model, a
// music model, an image model for concept art — is one entry here plus a
// reference file in the animation-director skill. Nothing else hardcodes the
// three core tools.
// ---------------------------------------------------------------------------

export type ToolId = "blender" | "mixamo" | "cascadeur" | "animatic" | "voice" | "music" | "concept-art";

export type ToolKind =
  | "3d-engine"
  | "mocap-library"
  | "motion-ai"
  | "previz"
  | "voice"
  | "music"
  | "image";

export interface StudioTool {
  id: ToolId;
  name: string;
  kind: ToolKind;
  /** pc = the studio builder on the owner's PC; browser = this site. */
  runsOn: "pc" | "browser" | "server";
  /** core = always part of the pipeline; optional = used when the plan needs it; planned = slot reserved. */
  status: "core" | "optional" | "planned";
  role: string;
  strengths: string[];
  mcp?: { server: string; install: string };
  /** Brand-ish colour for chips. */
  color: string;
}

export const TOOLS: StudioTool[] = [
  {
    id: "blender",
    name: "Blender",
    kind: "3d-engine",
    runsOn: "pc",
    status: "core",
    role: "Builds every scene: characters, sets, cameras, lights, effects, retargeting and the final render.",
    strengths: ["Scene layout & set dressing", "Cameras and lighting", "Object, vehicle & effect animation", "Physics, particles, cloth", "EEVEE / Cycles rendering to MP4"],
    mcp: { server: "blender", install: "claude mcp add blender -s user -- uvx blender-mcp" },
    color: "#f5792a",
  },
  {
    id: "mixamo",
    name: "Mixamo",
    kind: "mocap-library",
    runsOn: "pc",
    status: "optional",
    role: "Auto-rigs humanoid characters and supplies ready-made motion-capture clips.",
    strengths: ["Walking, running, jumping", "Talking & gesturing", "Dancing", "Idles, waves, reactions"],
    color: "#ff3a7a",
  },
  {
    id: "cascadeur",
    name: "Cascadeur",
    kind: "motion-ai",
    runsOn: "pc",
    status: "optional",
    role: "Custom, physics-correct character motion when no library clip fits.",
    strengths: ["Flips, falls, stunts", "Fight choreography", "Creatures & quadrupeds", "Contact with objects", "AutoPosing & AutoPhysics"],
    mcp: { server: "cascadeur", install: "github.com/ysk424/cascadeur-mcp (needs Cascadeur running)" },
    color: "#7c5cff",
  },
  {
    id: "animatic",
    name: "Animatic",
    kind: "previz",
    runsOn: "browser",
    status: "core",
    role: "Plays the storyboard as a moving 3D previz in the browser and exports it, before any PC render.",
    strengths: ["Instant preview", "Timing & camera check", "WebM export"],
    color: "#2dd4bf",
  },
  {
    id: "voice",
    name: "Voice-over",
    kind: "voice",
    runsOn: "server",
    status: "planned",
    role: "Narration and character lines (slot for a TTS model such as the hub's Voice Studio).",
    strengths: ["Narration", "Dialogue"],
    color: "#60a5fa",
  },
  {
    id: "music",
    name: "Score",
    kind: "music",
    runsOn: "server",
    status: "planned",
    role: "Music bed matched to the plan's music brief (slot for a music model).",
    strengths: ["Soundtrack", "Stingers"],
    color: "#facc15",
  },
  {
    id: "concept-art",
    name: "Concept art",
    kind: "image",
    runsOn: "server",
    status: "planned",
    role: "Character and set concept frames to steer look-dev (slot for an image model).",
    strengths: ["Character sheets", "Set concepts"],
    color: "#f472b6",
  },
];

export function toolById(id: string): StudioTool | undefined {
  return TOOLS.find((t) => t.id === id);
}

/** Tools the director may assign work to today. */
export const ACTIVE_TOOLS = TOOLS.filter((t) => t.status !== "planned");
