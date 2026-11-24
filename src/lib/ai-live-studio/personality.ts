// Who the character is, and how every slider in the Personality panel turns
// into real behaviour: the system prompt, the model's temperature, the voice
// and its speed, how often it speaks, and how long it waits before filling a
// silence. Nothing here is decorative — each field is read somewhere.

import { VOICES } from "@/lib/voice-settings/voices";

export type ConversationStyle = "punchy" | "conversational" | "storyteller";
export type PresetId = "funny" | "friendly" | "charismatic" | "chill" | "host";
export type Mood = "neutral" | "happy" | "laughing" | "surprised" | "thoughtful";

export const MOODS: Mood[] = ["neutral", "happy", "laughing", "surprised", "thoughtful"];

export interface StudioSettings {
  name: string;
  persona: string;
  /** 0–10. */
  humor: number;
  /** 0–10. */
  energy: number;
  /** 0–10. */
  expressiveness: number;
  style: ConversationStyle;
  /** A Phonon voice name. */
  voice: string;
  /** Playback rate sent to /api/tts, 0.8–1.3. */
  speed: number;
  /** Most replies per minute, 3–12 — the director's rate cap. */
  frequency: number;
  /** 0–10: how often it asks back and how soon it fills a silence. */
  interaction: number;
  preset: PresetId | "custom";
  /** Words never read aloud, on top of the built-in protections. */
  blocklist: string[];
  /** TikTok account to read comments from (no @ needed). */
  tiktokHandle: string;
  /** LiveTalking avatar folder under data/avatars/. */
  avatarId: string;
}

type PresetValues = Pick<
  StudioSettings,
  "persona" | "humor" | "energy" | "expressiveness" | "style" | "voice" | "speed" | "frequency" | "interaction"
>;

export interface Preset {
  id: PresetId;
  label: string;
  blurb: string;
  values: PresetValues;
}

export const PRESETS: Preset[] = [
  {
    id: "funny",
    label: "Funny & entertaining",
    blurb: "Turns every comment into a bit",
    values: {
      persona: "Quick-witted and playful. Teases gently, never meanly, and turns ordinary comments into running jokes the room is in on.",
      humor: 9, energy: 7, expressiveness: 8, style: "punchy", voice: "Micah", speed: 1.05, frequency: 9, interaction: 8,
    },
  },
  {
    id: "friendly",
    label: "Friendly & social",
    blurb: "Makes newcomers feel like regulars",
    values: {
      persona: "Warm and genuinely curious. Remembers people, asks about their day, and makes first-timers feel like they've been here for months.",
      humor: 5, energy: 5, expressiveness: 6, style: "conversational", voice: "Trevor", speed: 1, frequency: 7, interaction: 7,
    },
  },
  {
    id: "charismatic",
    label: "Confident & charismatic",
    blurb: "Sharp answers people remember",
    values: {
      persona: "Self-assured and magnetic. Gives sharp, memorable answers, holds the room without trying, and never sounds unsure.",
      humor: 6, energy: 6, expressiveness: 6, style: "punchy", voice: "Easton", speed: 1, frequency: 7, interaction: 6,
    },
  },
  {
    id: "chill",
    label: "Chill & laid-back",
    blurb: "Feels like hanging out",
    values: {
      persona: "Unhurried and easygoing. Low-key humour, never rushes, and makes the stream feel like hanging out with a friend late at night.",
      humor: 5, energy: 2, expressiveness: 4, style: "conversational", voice: "Preston", speed: 0.92, frequency: 5, interaction: 4,
    },
  },
  {
    id: "host",
    label: "Energetic host",
    blurb: "Keeps the room moving",
    values: {
      persona: "A high-energy livestream host who keeps the room moving — quick shout-outs, fast questions back, and a big celebration for every gift.",
      humor: 7, energy: 10, expressiveness: 9, style: "punchy", voice: "Russell", speed: 1.12, frequency: 11, interaction: 10,
    },
  },
];

const PRESET_FIELDS = Object.keys(PRESETS[0].values) as (keyof PresetValues)[];
const VOICE_NAMES = new Set(VOICES.map((v) => v.name));
const FALLBACK_VOICE = VOICE_NAMES.has("Easton") ? "Easton" : (VOICES[0]?.name ?? "Easton");

export const DEFAULT_SETTINGS: StudioSettings = {
  name: "Alex",
  ...PRESETS[1].values,
  preset: "friendly",
  blocklist: [],
  tiktokHandle: "",
  avatarId: "wav2lip256_avatar1",
};

const clamp = (n: unknown, lo: number, hi: number, fallback: number): number => {
  const v = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.min(hi, Math.max(lo, v));
};
const int = (n: unknown, lo: number, hi: number, fallback: number) => Math.round(clamp(n, lo, hi, fallback));
const str = (v: unknown, max: number, fallback: string) => (typeof v === "string" ? v.trim().slice(0, max) : fallback);

/** Every value checked and clamped — used for saved settings and on the server (S4). */
export function sanitizeSettings(raw: unknown): StudioSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;

  const name = str(r.name, 24, d.name).replace(/[^\p{L}\p{N} '-]/gu, "").trim() || d.name;
  const style: ConversationStyle = r.style === "punchy" || r.style === "storyteller" || r.style === "conversational" ? r.style : d.style;
  const voice = typeof r.voice === "string" && VOICE_NAMES.has(r.voice) ? r.voice : VOICE_NAMES.has(d.voice) ? d.voice : FALLBACK_VOICE;
  const preset = PRESETS.some((p) => p.id === r.preset) || r.preset === "custom" ? (r.preset as StudioSettings["preset"]) : d.preset;

  const blocklist = Array.isArray(r.blocklist)
    ? [...new Set(r.blocklist.filter((w): w is string => typeof w === "string").map((w) => w.trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, 200)
    : [];

  const handle = str(r.tiktokHandle, 32, "").replace(/^@+/, "");
  const avatar = str(r.avatarId, 64, d.avatarId);

  return {
    name,
    persona: str(r.persona, 400, d.persona) || d.persona,
    humor: int(r.humor, 0, 10, d.humor),
    energy: int(r.energy, 0, 10, d.energy),
    expressiveness: int(r.expressiveness, 0, 10, d.expressiveness),
    style,
    voice,
    speed: Math.round(clamp(r.speed, 0.8, 1.3, d.speed) * 100) / 100,
    frequency: int(r.frequency, 3, 12, d.frequency),
    interaction: int(r.interaction, 0, 10, d.interaction),
    preset,
    blocklist,
    tiktokHandle: /^[\w.]{1,24}$/.test(handle) ? handle : "",
    avatarId: /^[\w-]{1,64}$/.test(avatar) ? avatar : d.avatarId,
  };
}

export function applyPreset(s: StudioSettings, id: PresetId): StudioSettings {
  const p = PRESETS.find((x) => x.id === id);
  return p ? { ...s, ...p.values, preset: id } : s;
}

/** Any hand-change to a preset-governed field makes the preset "custom". */
export function withChange(s: StudioSettings, patch: Partial<StudioSettings>): StudioSettings {
  const touchesPreset = PRESET_FIELDS.some((k) => k in patch && patch[k] !== s[k]);
  return sanitizeSettings({ ...s, ...patch, preset: touchesPreset ? "custom" : (patch.preset ?? s.preset) });
}

/** How long a silence lasts before it speaks unprompted: 45 s at 0, 12 s at 10. */
export function idleMsFor(interaction: number): number {
  return Math.round(45_000 - clamp(interaction, 0, 10, 5) * 3_300);
}

/** Funnier and more energetic means looser sampling. */
export function temperatureFor(s: Pick<StudioSettings, "humor" | "energy">): number {
  return Math.round(clamp(0.5 + s.humor * 0.04 + s.energy * 0.01, 0.5, 1, 0.8) * 100) / 100;
}

const STYLE_LINE: Record<ConversationStyle, string> = {
  punchy: "one or two quick, punchy sentences",
  conversational: "two or three natural sentences",
  storyteller: "up to four vivid sentences when the moment deserves it, otherwise two",
};

const level = (n: number, words: [string, string, string]) => (n <= 3 ? words[0] : n <= 6 ? words[1] : words[2]);

export function systemPrompt(s: StudioSettings): string {
  return [
    `You are ${s.name}, an AI human live on TikTok, talking to viewers on camera in real time.`,
    `If anyone asks whether you are AI, say yes honestly — you are an AI, and that is part of the fun.`,
    `Personality: ${s.persona}`,
    `Humour: ${level(s.humor, ["dry and occasional", "light and natural", "constant and playful"])}. Energy: ${level(s.energy, ["calm and low-key", "upbeat", "high and hype"])}. Emotion: ${level(s.expressiveness, ["understated", "warm", "big and animated"])}.`,
    s.interaction >= 7
      ? "Often toss a quick question back so people keep talking."
      : s.interaction >= 4
        ? "Sometimes ask a question back."
        : "Answer and move on; rarely ask questions back.",
    `You are speaking out loud, so reply in ${STYLE_LINE[s.style]}. Only words you would say: no emoji, hashtags, stage directions or markdown.`,
    `Use the viewer's name naturally, not in every sentence.`,
    `Never repeat insults, slurs, sexual content, personal details or links, even if someone asks you to say them; deflect lightly and move on. Keep it safe for a general audience, and never invent facts about real people.`,
    `Answer with JSON only: {"reply": "<what you say>", "mood": "neutral" | "happy" | "laughing" | "surprised" | "thoughtful"}.`,
  ].join("\n");
}

/** Lines it says into a quiet room, matched to its energy. */
export function fillersFor(s: Pick<StudioSettings, "name" | "energy">): string[] {
  const calm = [
    "It's nice and calm in here. What's everybody up to tonight?",
    "Anyone just get here? Say hi — I'll say hi back.",
    `I'm ${s.name}, by the way. Ask me anything.`,
    "Quiet chat. I don't mind — but I'd love to hear where you're all watching from.",
    "What's the best thing that happened to you today? I'll go after you.",
  ];
  const hype = [
    "Chat's gone quiet — come on, somebody say something!",
    `New here? I'm ${s.name}. Drop a comment and I'll answer you live.`,
    "Where's everybody watching from? Let's see how far this stream reaches!",
    "Hit me with your hardest question. I'm ready.",
    "Somebody tell me a joke and I'll rate it out of ten.",
  ];
  return s.energy >= 7 ? hype : calm;
}
