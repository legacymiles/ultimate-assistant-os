"use client";

// ---------------------------------------------------------------------------
// Dance Studio — put one of your characters into any dance.
//
// Owns the library state and the one polling loop that advances renders, so a
// generation started from the Generate tab keeps progressing while you browse
// the library, and a regenerate from the library shows up in both.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/dance-studio/client";
import { isActive } from "@/lib/dance-studio/limits";
import type { Generation, StudioState } from "@/lib/dance-studio/types";

import { CharacterLibrary } from "./CharacterLibrary";
import { DanceLibrary } from "./DanceLibrary";
import { GeneratePanel } from "./GeneratePanel";

export type StudioTab = "generate" | "library" | "characters";

export interface GenerateIntent {
  danceId?: string;
  characterId?: string;
  link?: { url: string; name: string };
}

interface Props {
  /** A link handed over from the wall ("put a character in it"). */
  seedLink?: { url: string; name: string } | null;
  onSeedUsed?: () => void;
}

const TABS: { id: StudioTab; label: string }[] = [
  { id: "generate", label: "Generate" },
  { id: "library", label: "Dance library" },
  { id: "characters", label: "Characters" },
];

export function DanceStudio({ seedLink, onSeedUsed }: Props) {
  const [state, setState] = useState<StudioState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<StudioTab>("generate");
  const [intent, setIntent] = useState<GenerateIntent>({});
  const [latestId, setLatestId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await api<StudioState>("/api/dance-studio"));
      setLoadError("");
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!seedLink) return;
    setIntent({ link: seedLink });
    setTab("generate");
    onSeedUsed?.();
  }, [seedLink, onSeedUsed]);

  const activeIds =
    state?.library.generations
      .filter((g) => isActive(g.status))
      .map((g) => g.id)
      .join(",") ?? "";

  useEffect(() => {
    if (!activeIds) return;
    let stopped = false;
    const tick = async () => {
      for (const id of activeIds.split(",")) {
        try {
          const { generation } = await api<{ generation: Generation }>(`/api/dance-studio/generations/${id}`);
          if (stopped) return;
          setState((s) =>
            s && { ...s, library: { ...s.library, generations: s.library.generations.map((g) => (g.id === id ? generation : g)) } },
          );
        } catch {
          // A missed check is retried on the next tick.
        }
      }
    };
    const timer = setInterval(tick, 6000);
    void tick();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [activeIds]);

  const go = (next: GenerateIntent) => {
    setIntent(next);
    setTab("generate");
  };

  return (
    <section className="ds">
      <div className="ds__bar">
        <div className="ds__tabs" role="tablist" aria-label="Dance Studio">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`dv-chip${tab === t.id ? " is-on" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.id === "library" && state ? <em>{state.library.dances.length}</em> : null}
              {t.id === "characters" && state ? <em>{state.library.characters.length}</em> : null}
            </button>
          ))}
        </div>
        {state && (
          <p className="ds__status">
            <span className={`ds__dot${state.provider.ready && state.storage.remote ? "" : " is-off"}`} />
            {state.provider.ready ? `${state.provider.label} · ${state.provider.model}` : state.provider.reason}
            {!state.storage.remote && <span className="ds-warn">{state.storage.note}</span>}
            {state.provider.notice && <span className="ds-warn">{state.provider.notice}</span>}
          </p>
        )}
      </div>

      {loadError && <p className="dm__err">{loadError}</p>}

      {!state ? (
        <p className="dance-wall__empty">Opening the studio…</p>
      ) : tab === "generate" ? (
        <GeneratePanel
          state={state}
          intent={intent}
          onIntentUsed={() => setIntent({})}
          onChanged={refresh}
          latestId={latestId}
          onStarted={setLatestId}
          onCreateCharacter={() => setTab("characters")}
        />
      ) : tab === "library" ? (
        <DanceLibrary state={state} onChanged={refresh} onGenerate={go} />
      ) : (
        <CharacterLibrary state={state} onChanged={refresh} onUse={(characterId) => go({ characterId })} />
      )}
    </section>
  );
}
