import "server-only";
import { aiConfigured, aiFetch, describeFailure } from "@/lib/ai/provider";
import type { JudgeOutput, AnalyzeRequest, ShotDraft } from "../api";
import type { Blueprint, Character, Environment, Generation, LabState, RepoRow, ShotSpec } from "../model";
import { DIMENSIONS, DIMENSION_LABEL } from "../model";
import { genreById, GENRES } from "../genres";
import { ISSUE_LABEL } from "../inspect";

// ---------------------------------------------------------------------------
// The lab's reasoning calls. Each builds ONE prompt + images and parses ONE
// JSON answer, so the same step can run on the hub's AI (aiFetch) or be handed
// to Claude Code on the PC as a think job — the transport changes, the prompt
// and the parser do not.
// ---------------------------------------------------------------------------

export interface Ask {
  system: string;
  user: string;
  images: string[];
}

export function brainAvailable(state: LabState): { ok: boolean; why: string } {
  if (state.agent.brain === "claude-code") {
    const online = state.worker.lastSeen && Date.now() - Date.parse(state.worker.lastSeen) < 90_000;
    if (!online) return { ok: false, why: "The PC worker is offline, so Claude Code cannot think right now." };
    if (!state.worker.claude) return { ok: false, why: "The PC worker did not find the claude CLI." };
    return { ok: true, why: "" };
  }
  return aiConfigured() ? { ok: true, why: "" } : { ok: false, why: "No hub AI key is configured (OPENROUTER_API_KEY or AI_GATEWAY_API_KEY)." };
}

/** Run an Ask on the hub's AI. Returns the raw text, or throws a plain-English error. */
export async function askHub(ask: Ask, model: string): Promise<string> {
  const content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [{ type: "text", text: ask.user }];
  for (const url of ask.images) content.push({ type: "image_url", image_url: { url } });
  const res = await aiFetch({
    method: "POST",
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      temperature: 0.2,
      messages: [
        { role: "system", content: ask.system },
        { role: "user", content },
      ],
    }),
  });
  if (!res.ok) throw new Error(await describeFailure(res));
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content ?? "";
}

/** Text for Claude Code on the PC: the same Ask, as one prompt (it reads the images as files). */
export function askAsText(ask: Ask): string {
  return `${ask.system}\n\n${ask.user}\n\nAnswer with ONLY the JSON object, no prose before or after it.`;
}

export function parseJson<T>(text: string): T | null {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

// ----- judge --------------------------------------------------------------------------

function describeCast(spec: ShotSpec, characters: Character[], environments: Environment[]): string {
  const cast = spec.characterIds
    .map((id) => characters.find((c) => c.id === id))
    .filter(Boolean)
    .map((c) => `- ${c!.name}: ${c!.face} ${c!.hair} Wearing ${c!.wardrobe}. Rules: ${c!.continuityRules.join("; ") || "none"}`)
    .join("\n");
  const env = spec.environmentId ? environments.find((e) => e.id === spec.environmentId) : null;
  return [cast ? `Cast:\n${cast}` : "No named cast.", env ? `Set: ${env.name}: ${env.description} Layout: ${env.furniture} ${env.doorsWindows} Rules: ${env.continuityRules.join("; ")}` : "No named set."].join("\n");
}

export function judgeAsk(g: Generation, spec: ShotSpec, frames: string[], previousFrames: string[], state: LabState): Ask {
  const genre = genreById(g.genre);
  const weights = genre ? Object.entries(genre.weights).filter(([, w]) => (w ?? 0) >= 0.9).map(([d]) => d).join(", ") : "";
  const times = g.metrics?.sampleTimes ?? [];
  const measured = g.metrics
    ? `Measured by ffmpeg (trust these numbers): ${g.metrics.cuts.length} scene change(s) at ${g.metrics.cuts.map((c) => `${c.t.toFixed(1)}s`).join(", ") || "none"}; lowest frame-to-frame SSIM ${g.metrics.ssimMin.toFixed(2)} at ${g.metrics.ssimMinAt.toFixed(1)}s; frozen stretches ${g.metrics.freezes.map((f) => `${f.start.toFixed(1)}-${f.end.toFixed(1)}s`).join(", ") || "none"}; camera motion estimate: ${g.metrics.measuredMove}.`
    : "";
  const system = `You are the H3 Prompt Lab's judge: a film editor and continuity supervisor scoring ONE generated clip from MiniMax H3 against what it was asked to show. You only score what you can SEE in the frames provided — every score's evidence must name the frame number(s) (0-based, in the order given) and what is visible there. You never reward taste; you measure adherence to the intended shot. If a dimension cannot be judged from these frames (e.g. dialogue with no audio), omit it.`;
  const user = [
    `Genre: ${genre?.name ?? g.genre}. This genre is scored hardest on: ${weights || "balanced"}.`,
    `Intended shot: ${spec.title}. ${spec.durationSec}s, ${spec.aspect}, framing "${spec.framing}". Camera: ${spec.camera.move} (${spec.camera.amount} amplitude, ${spec.camera.speed} speed${spec.camera.focus ? `, toward ${spec.camera.focus}` : ""}).`,
    `What should happen: ${spec.action}${spec.beats.length ? ` Beats: ${spec.beats.join(" → ")}.` : ""}`,
    spec.dialogue.length ? `Dialogue intended: ${spec.dialogue.map((d) => `"${d.line}"`).join(" ")} (you cannot hear audio; judge only visible lip movement/performance).` : "",
    describeCast(spec, state.characters, state.environments),
    spec.intentionalChanges.length ? `Changes that are SUPPOSED to happen (never flag them): ${spec.intentionalChanges.join(", ")}.` : "No intentional changes: everything should hold.",
    measured,
    `Frames: ${frames.length} frames from this clip at ${times.map((t) => `${t.toFixed(1)}s`).join(", ")}.${previousFrames.length ? ` THEN ${previousFrames.length} frame(s) from the END of the previous scene of the same production (frame indices ${frames.length}..${frames.length + previousFrames.length - 1}) — check that identity, wardrobe, set and light carry across the cut.` : ""}`,
    `Score each dimension 0-10 (10 = exactly as intended) with confidence 0-1 and one line of visual evidence:\n${DIMENSIONS.map((d) => `- ${d}: ${DIMENSION_LABEL[d]}`).join("\n")}`,
    `List continuity issues you can see, each with kind (one of: ${Object.keys(ISSUE_LABEL).join(", ")}), severity low|medium|high, confidence 0-1, frame (index of the clearest frame), evidence (what is visible), recommendation (a concrete prompt fix).`,
    `Answer JSON: {"scores": {"<dimension>": {"value": n, "confidence": n, "evidence": "..."}}, "issues": [{"kind": "...", "severity": "...", "confidence": n, "frame": n, "evidence": "...", "recommendation": "..."}], "summary": "two sentences"}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { system, user, images: [...frames, ...previousFrames] };
}

export function parseJudge(text: string): JudgeOutput | null {
  const j = parseJson<JudgeOutput>(text);
  if (!j || typeof j !== "object" || !j.scores) return null;
  return { scores: j.scores ?? {}, issues: Array.isArray(j.issues) ? j.issues : [], summary: String(j.summary ?? "") };
}

// ----- reverse engineering ---------------------------------------------------------------

export function analyzeAsk(req: AnalyzeRequest): Ask {
  const genres = GENRES.map((g) => g.id).join(", ");
  const system = `You are a film analyst reverse-engineering a reference video into a production blueprint so it can be RECREATED with entirely new characters on MiniMax H3 (never face-swapped). You describe only what is visible in the frames. Label people neutrally ("Person A", "Person B") consistently across shots by their clothing and look; label places ("living room", "street").`;
  const shotLines = req.shots
    .map((s, i) => `Shot ${i + 1}: ${s.start.toFixed(2)}–${s.end.toFixed(2)}s (${(s.end - s.start).toFixed(1)}s), cut strength ${s.cutStrength.toFixed(2)}, frames ${s.frames.length} (start, middle, end).`)
    .join("\n");
  const user = [
    `Video: "${req.name}", ${req.durationSec.toFixed(1)}s, ${req.width}x${req.height}. ${req.shots.length} shots were detected by measuring colour-histogram changes between frames.`,
    req.note ? `Owner's note: ${req.note}` : "",
    req.audio ? `Audio measured in the browser: ${req.audio}` : "",
    shotLines,
    `Images follow in shot order, each shot's frames consecutively.`,
    `Return JSON: {"genre": one of [${genres}], "style": "...", "editingRhythm": "...", "sound": "...", "characters": [{"label": "Person A", "description": "look + wardrobe"}], "environments": [{"label": "...", "description": "layout, light"}], "shots": [{"characters": ["Person A"], "positions": "where each person is in frame and the room", "actions": "what physically happens, as a change", "dialogue": "visible speech or ''", "emotion": "...", "camera": {"angle": "framing + angle, e.g. 'medium two-shot, eye level'", "move": one of [static, handheld, push-in, pull-out, dolly-in, track, pan-left, pan-right, tilt-up, tilt-down, crane-up, crane-down, arc, orbit, zoom-in, zoom-out, pov, shake], "amount": "small|medium|large", "speed": "slow|medium|fast"}, "lighting": "...", "environment": "label of the place", "props": "...", "transitionIn": "cut|dissolve|whip|match cut|fade"}]} with exactly ${req.shots.length} shots in order.`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { system, user, images: req.shots.flatMap((s) => s.frames) };
}

export interface AnalysisDraft {
  genre: string;
  style: string;
  editingRhythm: string;
  sound: string;
  characters: Blueprint["characters"];
  environments: Blueprint["environments"];
  shots: ShotDraft[];
}

const MOVES = new Set(["static", "handheld", "push-in", "pull-out", "dolly-in", "track", "pan-left", "pan-right", "tilt-up", "tilt-down", "crane-up", "crane-down", "arc", "orbit", "zoom-in", "zoom-out", "pov", "shake"]);

export function parseAnalysis(text: string, n: number): AnalysisDraft | null {
  const j = parseJson<Partial<AnalysisDraft>>(text);
  if (!j || !Array.isArray(j.shots)) return null;
  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 600) : "");
  const shots: ShotDraft[] = [];
  for (let i = 0; i < n; i++) {
    const s = (j.shots[i] ?? {}) as Partial<ShotDraft>;
    const cam = (s.camera ?? {}) as Partial<ShotDraft["camera"]>;
    shots.push({
      characters: Array.isArray(s.characters) ? s.characters.map(String).slice(0, 8) : [],
      positions: str(s.positions),
      actions: str(s.actions),
      dialogue: str(s.dialogue),
      emotion: str(s.emotion),
      camera: {
        angle: str(cam.angle),
        move: (MOVES.has(String(cam.move)) ? cam.move : "static") as ShotDraft["camera"]["move"],
        amount: (["small", "medium", "large"].includes(String(cam.amount)) ? cam.amount : "medium") as ShotDraft["camera"]["amount"],
        speed: (["slow", "medium", "fast"].includes(String(cam.speed)) ? cam.speed : "medium") as ShotDraft["camera"]["speed"],
      },
      lighting: str(s.lighting),
      environment: str(s.environment),
      props: str(s.props),
      transitionIn: str(s.transitionIn) || "cut",
    });
  }
  return {
    genre: GENRES.some((g) => g.id === j.genre) ? String(j.genre) : "movie-scene",
    style: str(j.style),
    editingRhythm: str(j.editingRhythm),
    sound: str(j.sound),
    characters: Array.isArray(j.characters) ? j.characters.slice(0, 12).map((c) => ({ label: str((c as { label?: string }).label), description: str((c as { description?: string }).description) })) : [],
    environments: Array.isArray(j.environments) ? j.environments.slice(0, 8).map((c) => ({ label: str((c as { label?: string }).label), description: str((c as { description?: string }).description) })) : [],
    shots,
  };
}

/** No AI: the measured structure only, honestly labelled. */
export function offlineAnalysis(req: AnalyzeRequest, genre: string): AnalysisDraft {
  const avg = req.shots.reduce((s, x) => s + (x.end - x.start), 0) / Math.max(1, req.shots.length);
  return {
    genre,
    style: "",
    editingRhythm: `${req.shots.length} shots, average ${avg.toFixed(1)}s (measured)`,
    sound: req.audio ?? "",
    characters: [],
    environments: [],
    shots: req.shots.map(() => ({
      characters: [],
      positions: "",
      actions: "",
      dialogue: "",
      emotion: "",
      camera: { angle: "", move: "static", amount: "medium", speed: "medium" },
      lighting: "",
      environment: "",
      props: "",
      transitionIn: "cut",
    })),
  };
}

// ----- research -----------------------------------------------------------------------------

export function researchAsk(results: { title: string; url: string; description: string }[], known: RepoRow[]): Ask {
  return {
    system: `You curate open-source repositories that could improve prompting, continuity, evaluation or generation for MiniMax H3 video, for an owner who runs H3 locally in WanGP (Pinokio) on a 6 GB RTX 3050 laptop with 32 GB RAM. You never invent a repository: you only pick from the search results given, and only GitHub repository URLs.`,
    user: [
      `Already known (skip these): ${known.map((r) => r.url).join(", ")}`,
      `Search results:\n${results.map((r, i) => `${i + 1}. ${r.title} — ${r.url}\n   ${r.description}`).join("\n")}`,
      `Return JSON {"repos": [{"name": "owner/repo", "url": "https://github.com/owner/repo", "description": "...", "capabilities": ["..."], "license": "as stated in the result or 'unknown'", "compatibility": "good|partial|poor|unknown", "compatibilityNote": "...", "reusable": ["..."], "recommendation": "integrate|adapt|learn|skip|review"}]} — at most 4, only genuinely relevant ones, an empty list is a fine answer.`,
    ].join("\n\n"),
    images: [],
  };
}

export function parseResearch(text: string): Partial<RepoRow>[] {
  const j = parseJson<{ repos?: Partial<RepoRow>[] }>(text);
  return (j?.repos ?? []).filter((r) => typeof r.url === "string" && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(r.url));
}
