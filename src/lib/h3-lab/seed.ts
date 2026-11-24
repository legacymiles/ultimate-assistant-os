// ---------------------------------------------------------------------------
// First-run content: INPUTS only — a small cast, three sets, six test
// scenarios across genres, the five starting experiments the owner named
// (A character-first … E hybrid) as drafts, and the researched repositories.
// No generations, scores or activity are seeded: every result in the lab comes
// from a real render on the owner's WanGP.
// ---------------------------------------------------------------------------

import type { Character, Environment, Experiment, RepoRow, Scenario, ShotSpec } from "./model";

const T0 = "2026-11-24T12:00:00.000Z";

function char(id: string, c: Omit<Character, "id" | "createdAt" | "updatedAt" | "referenceImages">): Character {
  return { id, ...c, referenceImages: [], createdAt: T0, updatedAt: T0 };
}

function env(id: string, e: Omit<Environment, "id" | "createdAt" | "updatedAt" | "referenceImages">): Environment {
  return { id, ...e, referenceImages: [], createdAt: T0, updatedAt: T0 };
}

export const SEED_CHARACTERS: Character[] = [
  char("char-mara", {
    name: "Mara Voss",
    identity: "A detective in her late thirties, tired but exact; the one who notices.",
    face: "Angular face with high cheekbones and olive skin, dark brown eyes, a thin pale scar through her LEFT eyebrow.",
    hair: "Black hair cut in a blunt chin-length bob with a centre part.",
    wardrobe: "A charcoal wool overcoat over a black roll-neck sweater, dark grey trousers, black leather ankle boots.",
    body: "Tall and lean, square shoulders, stands very still.",
    accessories: "A silver wristwatch on her right wrist.",
    relationships: "Former partner of Theo Okafor; they have not spoken in a year.",
    continuityRules: ["Scar through the LEFT eyebrow, never the right", "Coat always buttoned to the second button", "Watch on the RIGHT wrist"],
  }),
  char("char-theo", {
    name: "Theo Okafor",
    identity: "An ex-boxer in his forties who now runs a diner; warm until cornered.",
    face: "Broad face, deep brown skin, a flattened nose from old breaks, short grey-flecked beard.",
    hair: "Close-cropped black hair, greying at the temples.",
    wardrobe: "A faded navy work shirt with the sleeves rolled to the elbow, a white apron tied at the waist, dark jeans.",
    body: "Heavy-set and broad-chested, thick forearms.",
    accessories: "A white dish towel over his left shoulder.",
    relationships: "Mara's former partner; owns the diner.",
    continuityRules: ["Towel on the LEFT shoulder", "Sleeves rolled to the elbow", "Beard short and grey-flecked, never clean-shaven"],
  }),
  char("char-kid", {
    name: "Jules",
    identity: "A wiry street racer in their early twenties, all nerves and speed.",
    face: "Narrow pale face with freckles across the nose, light green eyes.",
    hair: "Bleached platinum hair shaved on the sides, longer on top.",
    wardrobe: "A cropped red nylon racing jacket with white stripes down the sleeves, black cargo pants, white sneakers.",
    body: "Slight and wiry, quick movements.",
    accessories: "Fingerless black driving gloves.",
    relationships: "Owes Theo money.",
    continuityRules: ["Red jacket with WHITE sleeve stripes", "Platinum hair, shaved sides"],
  }),
];

export const SEED_ENVIRONMENTS: Environment[] = [
  env("env-loft", {
    name: "Loft living room",
    description: "A converted warehouse loft at night, exposed brick and tall steel-framed windows with city lights beyond.",
    architecture: "Exposed red-brick walls, black steel window frames, a concrete floor with a worn rug.",
    furniture: "A tan leather sofa faces the windows; a low wooden coffee table in front of it; a floor lamp to the sofa's right.",
    doorsWindows: "The front door is on the far-left wall; three tall windows fill the back wall.",
    lighting: "Warm amber light from the floor lamp, cool blue city glow through the windows.",
    objects: "Two coffee mugs on the table, a stack of case files, a record player on a side cabinet.",
    cameraPerspectives: "Main angle from behind the sofa toward the windows; reverse from the windows toward the door.",
    spatial: "The sofa is in the centre of the room; the door is about six steps from the sofa.",
    continuityRules: ["Door on the far-LEFT wall", "Lamp to the sofa's RIGHT", "Night outside, always"],
  }),
  env("env-garage", {
    name: "Parking garage level 3",
    description: "An empty concrete parking garage at night under buzzing fluorescent tubes.",
    architecture: "Low concrete ceiling with thick square pillars in two rows, painted yellow parking lines.",
    furniture: "A single dark green sedan parked between the second and third pillars on the left.",
    doorsWindows: "Stairwell door with a red EXIT light on the far wall.",
    lighting: "Hard greenish fluorescent overhead light, one tube flickering near the stairwell.",
    objects: "Oil stains on the floor, a crushed paper cup.",
    cameraPerspectives: "Long lens down the central lane; low angle between pillars.",
    spatial: "The central lane runs straight to the stairwell door.",
    continuityRules: ["Green sedan between the 2nd and 3rd LEFT pillars", "One flickering tube near the stairwell"],
  }),
  env("env-diner", {
    name: "Okafor's diner",
    description: "A small all-night diner with a long counter and red vinyl booths.",
    architecture: "Black-and-white checkerboard floor, chrome-edged counter, a pass-through window to the kitchen.",
    furniture: "Six red counter stools on the right; three red booths along the left window wall.",
    doorsWindows: "Glass front door with a bell at the back; big windows on the left wall.",
    lighting: "Bright, even overhead light; neon OPEN sign glow in the window.",
    objects: "A pie under a glass dome on the counter, a coffee pot on the warmer.",
    cameraPerspectives: "Wide from the door toward the counter; two-shot across the counter.",
    spatial: "The counter runs the length of the right side; booths on the left.",
    continuityRules: ["Counter on the RIGHT, booths on the LEFT", "Pie dome on the counter"],
  }),
];

function spec(s: Partial<ShotSpec> & Pick<ShotSpec, "genre" | "title" | "action">): ShotSpec {
  return {
    durationSec: 5,
    aspect: "16:9",
    framing: "medium shot",
    camera: { move: "static", amount: "small", speed: "slow" },
    beats: [],
    characterIds: [],
    environmentId: null,
    dialogue: [],
    mood: "",
    lighting: "",
    style: "Live-action, cinematic",
    sound: "",
    music: "",
    intentionalChanges: [],
    ...s,
  };
}

export const SEED_SCENARIOS: Scenario[] = [
  {
    id: "sc-loft-talk",
    title: "Loft: the old partner's question",
    createdAt: T0,
    source: "seed",
    spec: spec({
      genre: "dialogue-scene",
      title: "The old partner's question",
      framing: "medium two-shot",
      camera: { move: "push-in", amount: "small", speed: "slow", focus: "Mara's face" },
      action: "Mara sits forward on the sofa and turns her head to face Theo beside her as she speaks",
      characterIds: ["char-mara", "char-theo"],
      environmentId: "env-loft",
      dialogue: [{ speaker: "char-mara", line: "Why did you stop calling?", delivery: "a low, steady voice" }],
      mood: "tense, quiet",
      lighting: "Warm lamp light on their faces, blue window light behind",
      sound: "Distant city traffic through the windows, the hum of the record player",
    }),
  },
  {
    id: "sc-garage-fight",
    title: "Garage: the first exchange",
    createdAt: T0,
    source: "seed",
    spec: spec({
      genre: "fight-scene",
      title: "The first exchange",
      framing: "medium-wide shot showing both fighters head to toe",
      camera: { move: "arc", amount: "medium", speed: "fast", focus: "the two fighters" },
      action: "Jules throws a right hook from frame-left at Theo, who ducks under it and shoves Jules back against the green sedan",
      beats: ["Jules throws a right hook from frame-left", "Theo ducks under the punch", "Theo shoves Jules back against the green sedan"],
      characterIds: ["char-kid", "char-theo"],
      environmentId: "env-garage",
      mood: "sudden, violent",
      lighting: "Hard green fluorescent light from above",
      sound: "Scuffing shoes on concrete, a grunt, the thud of a body hitting the car, the buzzing tube",
      intentionalChanges: ["position"],
    }),
  },
  {
    id: "sc-diner-sitcom",
    title: "Diner: the pie gag",
    createdAt: T0,
    source: "seed",
    spec: spec({
      genre: "sitcom",
      title: "The pie gag",
      durationSec: 6,
      framing: "static medium two-shot across the counter",
      camera: { move: "static", amount: "small", speed: "slow" },
      action: "Theo lifts the glass dome off the pie with a flourish and finds the pie already half eaten, then turns slowly to look at Jules on the stool",
      beats: ["Theo lifts the glass dome off the pie with a flourish", "he sees the pie is half eaten", "he turns slowly to stare at Jules"],
      characterIds: ["char-theo", "char-kid"],
      environmentId: "env-diner",
      dialogue: [{ speaker: "char-theo", line: "Really?", delivery: "flat deadpan" }],
      mood: "comic, deadpan",
      style: "Multi-camera sitcom, bright even studio lighting",
      sound: "Diner clatter, the coffee warmer bubbling, a faint studio audience murmur",
    }),
  },
  {
    id: "sc-mara-intro",
    title: "Mara's introduction",
    createdAt: T0,
    source: "seed",
    spec: spec({
      genre: "character-introduction",
      title: "Mara arrives",
      durationSec: 6,
      framing: "low-angle shot from her boots up to her face",
      camera: { move: "tilt-up", amount: "large", speed: "slow", focus: "Mara's eyes" },
      action: "Mara stands in the garage's central lane, rain dripping from her coat, and lifts her eyes to the camera",
      characterIds: ["char-mara"],
      environmentId: "env-garage",
      mood: "cold, commanding",
      lighting: "Green fluorescent toplight, her face half in shadow",
      sound: "Rain dripping from her coat onto concrete, the buzzing tube",
    }),
  },
  {
    id: "sc-street-chase",
    title: "Street: closing the gap",
    createdAt: T0,
    source: "seed",
    spec: spec({
      genre: "car-chase",
      title: "Closing the gap",
      framing: "wide tracking shot at road level",
      camera: { move: "track", amount: "large", speed: "fast", focus: "the red hatchback" },
      action: "A small red hatchback swerves between two taxis on a wet night avenue with a black sedan two car lengths behind it, both already at full speed",
      characterIds: [],
      environmentId: null,
      mood: "frantic",
      lighting: "Wet asphalt reflecting neon and sodium streetlights",
      sound: "Engines screaming, tyres hissing on wet road, a horn blaring",
    }),
  },
  {
    id: "sc-product-watch",
    title: "Product: the watch",
    createdAt: T0,
    source: "seed",
    spec: spec({
      genre: "product-ad",
      title: "The watch",
      framing: "macro close-up",
      camera: { move: "orbit", amount: "large", speed: "slow", focus: "the watch face" },
      action: "A silver wristwatch rests on black slate as a thin line of light sweeps slowly across its face and the second hand ticks forward",
      characterIds: [],
      environmentId: null,
      mood: "precise, premium",
      lighting: "Single soft key from the left, a crisp rim light, deep black background",
      style: "Studio product film",
      sound: "A single crisp tick, a soft low tone",
    }),
  },
];

function exp(
  code: string,
  name: string,
  hypothesis: string,
  intendedImprovement: string,
  overrides: Experiment["overrides"],
  targets: Experiment["targets"],
): Experiment {
  return {
    id: `exp-${code.toLowerCase()}`,
    code,
    name,
    version: 1,
    hypothesis,
    intendedImprovement,
    overrides,
    instructions: "",
    targets,
    scenarioIds: SEED_SCENARIOS.map((s) => s.id),
    baseVersion: 1,
    status: "draft",
    createdBy: "seed",
    createdAt: T0,
    updatedAt: T0,
    strengths: [],
    weaknesses: [],
    conclusion: "",
  };
}

export const SEED_EXPERIMENTS: Experiment[] = [
  exp("A", "Character-first", "Leading with the cast and repeating each look in every shot reduces identity drift, because H3 weighs early tokens more and has no memory between cuts.", "Fewer face/wardrobe changes; higher character consistency.", { order: "character-first", identity: "repeat-every-shot" }, ["character", "continuity"]),
  exp("B", "Environment-first", "Opening on the set with an explicit layout (where the door, sofa and lamp are) stops furniture drifting between frames.", "Higher environment consistency; fewer moved or missing objects.", { order: "environment-first", environment: "layout-explicit" }, ["environment", "continuity"]),
  exp("C", "Cinematography-first", "A big plain-words camera move tied to the beat, with a rich official-length description, lands camera direction that the official prose sentence gets flattened.", "Higher camera accuracy and cinematography.", { order: "cinematography-first", camera: "plain-big", length: "rich" }, ["camera", "cinematography"]),
  exp("D", "Structured scene-by-scene", "Timed [Shot N] blocks with ordered choreography beats give H3 appointments to keep, so action happens in order instead of freezing.", "Higher action accuracy and movement; fewer frozen stretches.", { structure: "timed-cuts", action: "choreography-beats" }, ["action", "movement"]),
  exp("E", "Hybrid", "Character-first ordering with an anchor clause, an explicit set layout and a plain big camera move combine the likely winners of A-C without the length cost of repeating every look.", "Better overall adherence at standard length.", { order: "character-first", identity: "anchor-clause", environment: "layout-explicit", camera: "plain-big" }, ["adherence", "character", "environment"]),
];

const REVIEWED = "2026-11-24";

function repo(r: Omit<RepoRow, "reviewedAt" | "discoveredBy" | "notes"> & { notes?: string }): RepoRow {
  return { reviewedAt: REVIEWED, discoveredBy: "seed", notes: "", ...r };
}

export const SEED_REPOS: RepoRow[] = [
  repo({ id: "repo-wangp", name: "deepbeepmeep/Wan2GP (WanGP)", url: "https://github.com/deepbeepmeep/Wan2GP", description: "The owner's installed H3 runtime (Pinokio). MCP server on :42004.", capabilities: ["H3 FL2VA / Ref2VA pruned 20B", "turbo LoRAs", "two-phase upscaler", "MCP wangp_generate", "headless --process queue"], license: "Apache-2.0 (code)", compatibility: "good", compatibilityNote: "Already installed and rendering on the RTX 3050.", reusable: ["wangp_generate", "wangp_session get_job", "sliding-window continuation"], recommendation: "integrate", integration: "in-use", notes: "The lab's render backend." }),
  repo({ id: "repo-h3", name: "MiniMax-AI/MiniMax-H3", url: "https://github.com/MiniMax-AI/MiniMax-H3", description: "Official H3 release: model card, serving scripts, 9 agent skills including the prompt-writing guides.", capabilities: ["T2VA/I2VA/FL2VA/L2VA/Ref2VA", "base-en / ref-en prompt guides", "shot-table spec", "QC checklist"], license: "No SPDX; weights under MiniMax H3 Community License", compatibility: "partial", compatibilityNote: "Guides apply to WanGP unchanged; serving code needs multi-GPU.", reusable: ["official section format", "camera type+amplitude+speed", "<d> dialogue tags", "keyframe alignment lines"], recommendation: "adapt", integration: "techniques-learned", notes: "Source of the guide's format sections. The open weights' licence excludes US/EU/UK/KR territory — the owner was told in Sept 2026." }),
  repo({ id: "repo-director", name: "seesee75-commits/ComfyUI-MiniMaxH3-Director", url: "https://github.com/seesee75-commits/ComfyUI-MiniMaxH3-Director", description: "ComfyUI long-video director: render parts on H3's lattice with picture+sound latent pinning.", capabilities: ["part planning", "latent pinning", "character/voice cards", "measured technical paper"], license: "GPL-3.0", compatibility: "poor", compatibilityNote: "ComfyUI-native and copyleft; pinning needs WanGP internals.", reusable: ["measured planning rules (2.4 s head lag, no cut in last 2 s, audio dulls after 4 joins)"], recommendation: "learn", integration: "techniques-learned", notes: "Rules only in the guide's long-form section; no code copied." }),
  repo({ id: "repo-scenedetect", name: "Breakthrough/PySceneDetect", url: "https://github.com/Breakthrough/PySceneDetect", description: "Shot/cut detection (adaptive, content, TransNetV2 ONNX).", capabilities: ["AdaptiveDetector", "split_video_ffmpeg", "save-images"], license: "BSD-3-Clause", compatibility: "good", compatibilityNote: "CPU-only pip package; no VRAM.", reusable: ["detect()", "AdaptiveDetector"], recommendation: "integrate", integration: "approval-needed", notes: "Not installed. The lab uses ffmpeg scdet (already on this PC) and in-browser histogram cuts today; installing scenedetect-headless is a pip install the owner approves." }),
  repo({ id: "repo-awesome", name: "MiniMax-AI/awesome-minimax-h3-integration", url: "https://github.com/MiniMax-AI/awesome-minimax-h3-integration", description: "Community index of 150+ H3 tools and low-VRAM recipes.", capabilities: ["VRAM table", "tool index"], license: "None stated", compatibility: "good", compatibilityNote: "Reading material.", reusable: ["leads: open-h3-ir, minimax-h3-video-reverse-skill"], recommendation: "learn", integration: "techniques-learned", notes: "No 6 GB recipe listed — this PC is below every documented setup." }),
  repo({ id: "repo-imbutus", name: "imbutus/ComfyUI-MiniMaxDirector", url: "https://github.com/imbutus/ComfyUI-MiniMaxDirector", description: "Timeline → official H3 prompt compiler with a 16-check linter and frame lattice, pure Python core.", capabilities: ["compile.py", "lint.py", "lattice.py", "golden tests"], license: "MIT", compatibility: "partial", compatibilityNote: "Pure-Python core is portable; UI is ComfyUI.", reusable: ["lint checks", "length % 17 == 5 lattice"], recommendation: "adapt", integration: "techniques-learned", notes: "Lab linter (lint.ts) is an independent TypeScript implementation of similar checks." }),
  repo({ id: "repo-open-h3-ir", name: "ruashots/open-h3-ir", url: "https://github.com/ruashots/open-h3-ir", description: "Open re-implementation of the hosted Context-IR prompt pre-processor: writes, checks and fixes H3 prompts.", capabilities: ["prompt rewrite", "CLI/HTTP"], license: "Apache-2.0", compatibility: "unknown", compatibilityNote: "Not yet read in depth.", reusable: [], recommendation: "review", integration: "not-integrated", notes: "Lead from the awesome list — a candidate experiment arm (\"IR-rewritten prompt\" vs the lab compiler)." }),
  repo({ id: "repo-reverse", name: "gnipbao/minimax-h3-video-reverse-skill", url: "https://github.com/gnipbao/minimax-h3-video-reverse-skill", description: "Reference video → T2VA or per-shot I2V prompts.", capabilities: ["video reverse engineering"], license: "MIT", compatibility: "unknown", compatibilityNote: "Not yet read in depth.", reusable: [], recommendation: "review", integration: "not-integrated", notes: "Compare against the lab's Video Reverse Engineering blueprint." }),
  repo({ id: "repo-insightface", name: "deepinsight/insightface", url: "https://github.com/deepinsight/insightface", description: "ArcFace face embeddings for identity similarity.", capabilities: ["face detection", "512-d identity embedding"], license: "Code MIT; pretrained models non-commercial", compatibility: "good", compatibilityNote: "CPU onnxruntime, ~300 MB.", reusable: ["cosine similarity vs reference photo"], recommendation: "integrate", integration: "approval-needed", notes: "Would make character consistency a MEASURED dimension. Personal use only under the model licence; facenet-pytorch (MIT) for client work." }),
  repo({ id: "repo-lpips", name: "richzhang/PerceptualSimilarity (lpips)", url: "https://github.com/richzhang/PerceptualSimilarity", description: "LPIPS perceptual distance.", capabilities: ["seam and drift distance"], license: "BSD-2-Clause", compatibility: "good", compatibilityNote: "CPU AlexNet.", reusable: ["seam check", "keyframe drift"], recommendation: "integrate", integration: "approval-needed", notes: "ffmpeg SSIM covers this today at lower fidelity." }),
  repo({ id: "repo-dinov2", name: "facebookresearch/dinov2", url: "https://github.com/facebookresearch/dinov2", description: "Self-supervised features — VBench-style subject/background consistency.", capabilities: ["frame feature similarity"], license: "Apache-2.0", compatibility: "good", compatibilityNote: "ViT-S/14 on CPU.", reusable: ["subject_consistency", "background_consistency"], recommendation: "integrate", integration: "approval-needed", notes: "" }),
  repo({ id: "repo-vbench", name: "Vchitect/VBench", url: "https://github.com/Vchitect/VBench", description: "Video generation benchmark, 16 dimensions.", capabilities: ["motion smoothness", "dynamic degree", "flicker"], license: "Apache-2.0", compatibility: "partial", compatibilityNote: "Heavy, GPU expected — the GPU is busy rendering.", reusable: ["dimension definitions"], recommendation: "adapt", integration: "techniques-learned", notes: "The lab's dimension list borrows its framing; metrics are re-implemented with ffmpeg." }),
  repo({ id: "repo-syncnet", name: "joonson/syncnet_python", url: "https://github.com/joonson/syncnet_python", description: "Lip-sync confidence and offset.", capabilities: ["LSE-C / LSE-D"], license: "MIT", compatibility: "good", compatibilityNote: "CPU (slow).", reusable: ["dialogue-shot lip-sync score"], recommendation: "integrate", integration: "approval-needed", notes: "Would make dialogue quality measured." }),
  repo({ id: "repo-mediapipe", name: "google-ai-edge/mediapipe", url: "https://github.com/google-ai-edge/mediapipe", description: "Face landmarks — mouth-open ratio.", capabilities: ["voiceover lips-closed check", "speaker detection"], license: "Apache-2.0", compatibility: "good", compatibilityNote: "Very light.", reusable: ["mouth opening per frame"], recommendation: "integrate", integration: "approval-needed", notes: "" }),
  repo({ id: "repo-dover", name: "VQAssessment/DOVER", url: "https://github.com/VQAssessment/DOVER", description: "Aesthetic + technical video quality score.", capabilities: ["quality score"], license: "S-Lab (non-commercial)", compatibility: "partial", compatibilityNote: "GPU preferred; non-commercial licence.", reusable: [], recommendation: "learn", integration: "not-integrated", notes: "" }),
];
