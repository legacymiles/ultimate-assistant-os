// Realtime Lucy — what the browser and the GPU server say to each other.
//
// Transport: one HTTP POST of the browser's SDP to the server's /offer, then
// everything else rides the WebRTC peer connection — the webcam as an
// outgoing video track, the model's frames as the incoming video track, and
// a "control" data channel carrying the JSON messages below.
// Server implementation: tools/realtime-lucy/server/server.py.

/** 0 = pure generation after the anchor; 3 = closest to the camera. */
export type Strength = 0 | 1 | 2 | 3;

export const STRENGTHS: { value: Strength; label: string; blurb: string }[] = [
  { value: 3, label: "Faithful", blurb: "1 denoising step from σ≈0.62; keeps most of what the camera sees" },
  { value: 2, label: "Balanced", blurb: "2 steps from σ≈0.83; structure from the camera, look from the prompt" },
  { value: 1, label: "Dreamy", blurb: "3 steps from σ≈0.94; loose, painterly" },
  { value: 0, label: "Free", blurb: "all 4 steps from pure noise: ignores the camera after the anchor" },
];

export type CondMode = "sdedit" | "keyframe";

/** Browser → server. */
export type ControlMessage =
  | { type: "prompt"; text: string }
  | { type: "strength"; value: Strength }
  | { type: "keys"; keys: string[] }
  | { type: "reset" }
  | { type: "cond_mode"; value: CondMode };

export interface StreamInfo {
  width: number;
  height: number;
  lat_w: number;
  lat_h: number;
  frame_seqlen: number;
  chunk_size: number;
  frames_per_chunk: number;
  kv_latents: number;
  kv_tokens: number;
  strength: number;
  sigmas: number[];
  cond_mode: CondMode;
  max_stream_latents: number;
  prompt: string;
  open_ms?: number;
  reanchors?: number;
}

export interface Stats {
  encode_ms?: number;
  denoise_ms?: number;
  kv_update_ms?: number;
  decode_ms?: number;
  total_ms?: number;
  chunk_id?: number;
  latent_pos?: number;
  frames_in?: number;
  frames_out?: number;
  gen_fps?: number;
  peak_vram_mb?: number;
  vram_reserved_mb?: number;
  strength?: number;
  steps?: number;
  ring?: number;
  cam_received?: number;
  cam_kept?: number;
  frames_sent?: number;
  reanchors?: number;
  glass_to_glass_ms?: number;
  queue_wait_ms?: number;
  keys?: string[];
}

/** Server → browser. */
export type ServerMessage =
  | { type: "status"; state: "connected" | "opening" | "prompt" | "streaming"; message?: string; stream?: StreamInfo }
  | ({ type: "stats" } & Stats)
  | { type: "error"; message: string };

export interface Health {
  ok: boolean;
  name: string;
  ready: boolean;
  error: string | null;
  model: string;
  gpu: string | null;
  config: {
    size: string;
    chunk_size: number;
    local_attn_size: number;
    sink_size: number;
    vae_dtype: string;
    fps: number;
  };
  session: string | null;
  auth: boolean;
}

export const MODEL_FPS = 16;
export const DEFAULT_SERVER_URL = "http://localhost:8765";

export const PROMPT_PRESETS = [
  "A person in a softly lit room, cinematic film look, natural motion, rich colour, gentle depth of field.",
  "An oil painting come to life: thick brushstrokes, warm gallery light, impressionist colour.",
  "A neon-soaked cyberpunk street at night, rain on the lens, magenta and cyan light, cinematic.",
  "Hand-drawn anime, clean line art, soft cel shading, a bright studio, gentle camera drift.",
  "A claymation scene shot on a tabletop, stop-motion texture, warm tungsten light.",
  "Black and white film noir, hard shadows, venetian blinds, smoke drifting through the light.",
];
