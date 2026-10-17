"use client";

// ---------------------------------------------------------------------------
// "Tell me when…" — the owner writes a notification in their own words.
//
// Type it, Jarvis turns it into a rule and says back exactly what it will do,
// and nothing is saved until the owner taps Save. The same editor sits in the
// Notifications widget and in Settings, so a rule made in one is in the other.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Icon } from "../icons";
import {
  WATCH_EXAMPLES,
  addWatch,
  describeRule,
  parseWatchLocal,
  removeWatch,
  toggleWatch,
  useWatches,
  type ParsedWatch,
} from "@/lib/new-jarvis/watches";

export function WatchesEditor({ compact = false }: { compact?: boolean }) {
  const watches = useWatches();
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  const [draft, setDraft] = useState<(ParsedWatch & { summary: string; prompt: string }) | null>(null);
  const [error, setError] = useState("");

  const understand = async (input = text) => {
    const prompt = input.trim();
    if (!prompt || thinking) return;
    setThinking(true);
    setError("");
    setDraft(null);
    try {
      const r = await fetch("/api/new-jarvis/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: prompt }),
      });
      const d = (await r.json()) as Partial<ParsedWatch> & { summary?: string; error?: string };
      if (!r.ok || !d.rule) throw new Error(d.error || "I couldn't turn that into a notification.");
      setDraft({ title: d.title ?? prompt, rule: d.rule, summary: d.summary ?? describeRule(d.rule), prompt });
    } catch (e) {
      // Offline or the route is missing: the keyword parser still works here.
      const local = parseWatchLocal(prompt);
      if (local) setDraft({ ...local, summary: describeRule(local.rule), prompt });
      else setError(e instanceof Error ? e.message : "I couldn't turn that into a notification.");
    } finally {
      setThinking(false);
    }
  };

  const save = () => {
    if (!draft) return;
    addWatch(draft.prompt, draft);
    setDraft(null);
    setText("");
  };

  return (
    <div className="space-y-2.5">
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void understand();
        }}
      >
        <label htmlFor={compact ? "watch-new-c" : "watch-new"} className="sr-only">
          Describe a notification you want
        </label>
        <input
          id={compact ? "watch-new-c" : "watch-new"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Tell me when… e.g. every weekday at 9 remind me to call leads"
          className="min-h-[38px] min-w-0 flex-1 rounded-lg border border-line bg-panel-2 px-3 text-[12.5px] text-ink placeholder:text-ink-faint"
        />
        <button type="submit" className="deck-btn deck-btn--go" disabled={!text.trim() || thinking}>
          {thinking ? "Reading…" : "Add"}
        </button>
      </form>

      {!draft && !error && watches.length === 0 && (
        <div className="flex flex-wrap gap-1.5">
          {WATCH_EXAMPLES.slice(0, compact ? 3 : 5).map((ex) => (
            <button
              key={ex}
              type="button"
              className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-muted hover:border-[var(--hud)] hover:text-ink"
              onClick={() => {
                setText(ex);
                void understand(ex);
              }}
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {draft && (
        <div className="rounded-lg border border-[var(--hud)] bg-[color-mix(in_oklab,var(--hud)_8%,transparent)] px-3 py-2.5">
          <p className="text-[10.5px] text-[var(--hud)]">I&apos;ll notify you</p>
          <p className="mt-0.5 text-[12.5px] text-ink">{draft.summary}</p>
          <div className="mt-2 flex gap-1.5">
            <button type="button" className="deck-btn deck-btn--go" onClick={save}>
              Save
            </button>
            <button type="button" className="deck-btn" onClick={() => setDraft(null)}>
              Not that
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-[11.5px] text-[var(--hud-amber)]">{error}</p>}

      {watches.length > 0 && (
        <ul className="divide-y divide-line-soft rounded-lg border border-line">
          {watches.map((w) => (
            <li key={w.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className={`truncate text-[12px] ${w.on ? "text-ink" : "text-ink-faint line-through"}`}>{describeRule(w.rule)}</p>
                <p className="truncate text-[10.5px] text-ink-faint">“{w.prompt}”</p>
              </div>
              <button type="button" role="switch" aria-checked={w.on} aria-label={`Use: ${w.title}`} className="deck-switch" onClick={() => toggleWatch(w.id)} />
              <button
                type="button"
                aria-label={`Delete: ${w.title}`}
                className="grid h-7 w-7 place-items-center rounded text-ink-faint hover:text-ink"
                onClick={() => removeWatch(w.id)}
              >
                <Icon.Trash width={12} height={12} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
