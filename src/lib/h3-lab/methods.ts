// Every way we have of making or fixing a film — a folder per method.
//
// This is deliberately NOT "every skill whose description mentions video". That
// swept in website builders and design skills and made the list useless. A
// method here is something that can actually produce or repair footage: a
// prompting skill, a model, a post-process, or an outside workflow worth trying.
//
// `status` is the honest part. "used" means footage exists that was made this
// way. "untried" means it is installed or available and has never been run, and
// those are the rows that should bother us.

export type MethodKind = "skill" | "model" | "tool" | "workflow";
export type MethodStatus = "used" | "untried";

export interface Method {
  id: string;
  name: string;
  kind: MethodKind;
  status: MethodStatus;
  /** One honest sentence: what it does and what it is for. */
  description: string;
  /** Where it lives — a repo URL, or a WanGP model id. */
  source?: string;
  /** What we actually learned, or why it is worth trying. */
  note?: string;
}

export const SEED_METHODS: Method[] = [
  // ---- prompting and planning skills, all used -----------------------------
  {
    id: "h3-cinematic-prompt", name: "h3-cinematic-prompt", kind: "skill", status: "used",
    description: "Writes the sentences that go to the model — plain caption style, one big camera move said in ordinary words, a look made of concrete nouns.",
    note: "Measured: 226 characters beat 1321 AND produced the turn the long one failed to.",
  },
  {
    id: "h3-prompt", name: "h3-prompt", kind: "skill", status: "used",
    description: "The model's own section format — integrated_multimodal_description, soundscape, retention — and which generation mode applies.",
  },
  {
    id: "h3-stitched-film", name: "h3-stitched-film", kind: "skill", status: "used",
    description: "One scene: how many clips, how they chain on real frames, the one-action-per-clip budget, and how to read a join.",
    note: "Made the 10-second two-clip tests and the action/person queues.",
  },
  {
    id: "h3-long-story", name: "h3-long-story", kind: "skill", status: "used",
    description: "The story layer — scenes of chained clips instead of cuts, casting by shot size, props drawn mid-event, creatures designed before they are shot.",
    note: "FIXED identity: one man across 46s and nine shots. Did not fix direction — nobody in the film is afraid.",
  },
  {
    id: "h3-scene-continuity", name: "h3-scene-continuity", kind: "skill", status: "used",
    description: "Measures a finished cut with continuity.mjs — motion per clip, dead shots, locked landings, join ratios.",
  },
  {
    id: "viggle-motion-swap", name: "viggle-motion-swap", kind: "skill", status: "used",
    description: "Replaces one or more people in an existing clip, keeping the original motion, camera and background. Qwen inpaints one frame, Viggle propagates it.",
    note: "Holds a face across a whole clip BETTER than H3 holds its own, because it tracks rather than imagines.",
  },
  {
    id: "film-plan", name: "film-plan", kind: "skill", status: "used",
    description: "Jarvis Studio's in-app flow: a brief plus photos become one Storyboard object and a pre-flight gate.",
    note: "The one film planned end to end through this came back mediocre. It earns its place by making a plan a person can edit, not by making the picture better.",
  },
  {
    id: "shot-plan-storyboard", name: "shot-plan-storyboard", kind: "skill", status: "used",
    description: "Draws a Storyboard as the editable paper shot-plan sheet — cast, set plates, floor plan, one frame per cut.",
  },

  // ---- the identity tools, which is where the real answer probably is ------
  {
    id: "h3_face_refiner", name: "H3 Face Refiner", kind: "tool", status: "untried",
    source: "WanGP postprocessing/h3_face_refiner (ComfyUI-H3-FaceRefine port)",
    description: "Post-process on a FINISHED film: tracks faces frame by frame and re-renders them, anchored to a supplied reference photo's embedding.",
    note: "identity_threshold 0.28, denoising 0.45, 4 steps. Takes a reference image and rejects faces that do not match it. This is the direct answer to 'one man looks like five' and it has been installed the whole time.",
  },
  {
    id: "phantom_14B", name: "Phantom 14B", kind: "model", status: "untried",
    source: "WanGP model: phantom_14B",
    description: "Subject-consistency video model — keeping one person the same person across a generation is its entire job.",
  },
  {
    id: "standin", name: "StandIn", kind: "model", status: "untried",
    source: "WanGP model: standin",
    description: "Identity-preserving generation; also combines with VACE as vace_standin_14B.",
  },
  {
    id: "lynx", name: "Lynx", kind: "model", status: "untried",
    source: "WanGP model: lynx (also vace_lynx_14B)",
    description: "Identity-preserving video generation from a reference face.",
  },
  {
    id: "vace_14B", name: "VACE 14B", kind: "model", status: "untried",
    source: "WanGP model: vace_14B",
    description: "All-in-one reference-driven video creation and editing — generation conditioned on reference images rather than imagined from a caption.",
  },

  // ---- models that change the shape of the problem --------------------------
  {
    id: "k5_lite_t2v_10s_distil", name: "K5 Lite 10s", kind: "model", status: "untried",
    source: "WanGP model: k5_lite_t2v_10s_distil",
    description: "Ten-second generations, distilled. Twice H3's clip length, so half as many joins in the same film.",
  },
  {
    id: "ltx2_distilled_q4", name: "LTX-2 22B distilled (GGUF q4)", kind: "model", status: "untried",
    source: "WanGP model: ltx2_22B_distilled_gguf_q4_k_m",
    description: "LTX-2, distilled and quantised — the one line explicitly built to run on a small card.",
  },
  {
    id: "hunyuan_1_5_480_i2v_step_distilled", name: "Hunyuan 1.5 480 i2v (distilled)", kind: "model", status: "untried",
    source: "WanGP model: hunyuan_1_5_480_i2v_step_distilled",
    description: "Hunyuan 1.5 image-to-video at 480p, step-distilled. Cheap enough to iterate on.",
  },

  // ---- outside workflows worth stealing from -------------------------------
  {
    id: "openvideo", name: "OpenVideo (agent-next)", kind: "workflow", status: "untried",
    source: "https://github.com/agent-next/video-agent",
    description: "Local-first H3 through ComfyUI, 'install -> pull -> run' like Ollama, with a CLI any coding agent can drive via its h3-video skill harness.",
    note: "The two parts worth stealing: a PROMPT GRAMMAR the prompt is validated against, and a VLM quality judge with a retry loop. That is the self-improving loop, already built.",
  },
  {
    id: "minimax_h3_workflow", name: "minimax_h3_workflow (eamars)", kind: "workflow", status: "untried",
    source: "https://github.com/eamars/minimax_h3_workflow",
    description: "ComfyUI workflow framework for H3: setup and model-download scripts, typed API templates, artifact schemas, 17 project-local skills.",
    note: "Has a 'seamless chain' builder for continuity ACROSS scene boundaries — exactly where our films break. Its concrete configs are gitignored, so the value is the architecture.",
  },
];

/** Only these skills are video METHODS. Everything else in the library is not. */
export const VIDEO_SKILL_IDS = new Set(
  SEED_METHODS.filter((m) => m.kind === "skill").map((m) => m.id),
);

export const KIND_ORDER: MethodKind[] = ["skill", "tool", "model", "workflow"];
