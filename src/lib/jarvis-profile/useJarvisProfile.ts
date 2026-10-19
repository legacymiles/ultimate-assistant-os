"use client";

// ---------------------------------------------------------------------------
// Jarvis Profile's state: the build checklist, synced across devices, that
// learns by itself and keeps the Claude Code skill up to date.
//
//   • Learning: at most twice a day, when the owner has said enough new things
//     to Jarvis, the new messages are read for standing build rules. Repeats
//     count up; new rules arrive switched on and marked "new"; a rule the
//     owner removed is never learned back. "Learn now" does it on demand.
//   • Publishing: whenever the rules that are on change, the checklist is
//     re-published as the "website-build-checklist" skill, so Claude Code on
//     the PC and VPS follows the same list. No button.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { useRemotePull } from "@/lib/sync/useSync";
import { SAID_KEY } from "@/lib/new-jarvis/useIdeas";
import type { Said } from "@/lib/new-jarvis/ideas";
import {
  addOwnRule,
  checklistPrompt,
  checklistSkill,
  coerceProfile,
  markSeen,
  mergeLearned,
  removeRule,
  textHash,
  toggleRule,
  type JarvisProfileState,
  type LearnedRule,
} from "./checklist";

export const PROFILE_KEY = "jarvis-profile:v1";
export const PROFILE_CHANGED = "jarvis-profile-changed";

/** Learn by itself no more often than this. */
const LEARN_EVERY_MS = 12 * 60 * 60_000;
/** …and only once this many new things have been said. */
const LEARN_MIN_NEW = 3;
const DIGEST_CHARS = 14_000;

function read(): JarvisProfileState {
  return coerceProfile(loadLocal<unknown>(PROFILE_KEY, null), Date.now());
}

function readSaid(): Said[] {
  const raw = loadLocal<unknown>(SAID_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is Said => !!r && typeof (r as Said).text === "string" && typeof (r as Said).at === "number");
}

/** For the chat: the rules that are on, as text for the brain to follow. Empty when there are none. */
export function readChecklistPrompt(): string {
  try {
    return checklistPrompt(read());
  } catch {
    return "";
  }
}

function digestOf(said: Said[]): string {
  const lines = [...said]
    .sort((a, b) => b.at - a.at)
    .map((s) => `- [${new Date(s.at).toISOString().slice(0, 10)}] ${s.text.replace(/\s+/g, " ").trim().slice(0, 400)}`);
  let text = lines.join("\n");
  if (text.length > DIGEST_CHARS) text = text.slice(0, DIGEST_CHARS);
  return text;
}

export interface UseJarvisProfile {
  state: JarvisProfileState;
  /** Messages said since the last learn. */
  waiting: number;
  learning: boolean;
  notice: string;
  publishing: boolean;
  publishNotice: string;
  add: (text: string) => void;
  toggle: (id: string) => void;
  remove: (id: string) => void;
  seen: () => void;
  learnNow: () => Promise<void>;
}

export function useJarvisProfile(): UseJarvisProfile {
  const [state, setState] = useState<JarvisProfileState>(() => coerceProfile(null, 0));
  const [said, setSaid] = useState<Said[]>([]);
  const [learning, setLearning] = useState(false);
  const [notice, setNotice] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishNotice, setPublishNotice] = useState("");
  const stateRef = useRef(state);
  stateRef.current = state;

  const reload = useCallback(() => setState(read()), []);
  useEffect(() => {
    reload();
    setSaid(readSaid());
    const on = () => reload();
    window.addEventListener(PROFILE_CHANGED, on);
    return () => window.removeEventListener(PROFILE_CHANGED, on);
  }, [reload]);
  useRemotePull(PROFILE_KEY, reload);
  useRemotePull(SAID_KEY, () => setSaid(readSaid()));

  const commit = useCallback((next: JarvisProfileState) => {
    saveSynced(PROFILE_KEY, next);
    setState(next);
    window.dispatchEvent(new Event(PROFILE_CHANGED));
  }, []);

  const add = useCallback((text: string) => commit(addOwnRule(stateRef.current, text, Date.now())), [commit]);
  const toggle = useCallback((id: string) => commit(toggleRule(stateRef.current, id)), [commit]);
  const remove = useCallback((id: string) => commit(removeRule(stateRef.current, id)), [commit]);
  const seen = useCallback(() => {
    const next = markSeen(stateRef.current);
    if (next !== stateRef.current) commit(next);
  }, [commit]);

  const fresh = said.filter((s) => s.at > (state.learnedAt ?? 0));

  const learnNow = useCallback(async () => {
    const cur = stateRef.current;
    const all = readSaid();
    const newer = all.filter((s) => s.at > (cur.learnedAt ?? 0));
    if (!newer.length) {
      setNotice("Nothing new to learn from since last time.");
      return;
    }
    setLearning(true);
    setNotice("");
    try {
      const r = await fetch("/api/jarvis-profile/learn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          said: digestOf(newer),
          existing: cur.rules.map((x) => (x.when === "Always" ? x.then : `${x.when}: ${x.then}`)),
          removed: cur.removed,
        }),
      });
      const d = (await r.json().catch(() => ({}))) as { rules?: LearnedRule[]; notice?: string; error?: string };
      if (!r.ok) {
        setNotice(d.error ?? "Couldn't learn just now. Jarvis will try again later.");
        return;
      }
      const latest = read();
      const newest = Math.max(...newer.map((s) => s.at));
      const next = mergeLearned(latest, d.rules ?? [], newest, all.length);
      commit(next);
      const added = next.rules.filter((x) => x.fresh).length - latest.rules.filter((x) => x.fresh).length;
      setNotice(d.notice ?? (added > 0 ? `Learned ${added} new rule${added === 1 ? "" : "s"} from your chats.` : "Read your latest chats — nothing new to add."));
    } catch {
      setNotice("Couldn't reach Jarvis to learn just now. It will try again later.");
    } finally {
      setLearning(false);
    }
  }, [commit]);

  // Learn by itself.
  const tried = useRef(false);
  useEffect(() => {
    if (tried.current || learning) return;
    const due = !state.learnedAt || Date.now() - state.learnedAt >= LEARN_EVERY_MS;
    if (due && fresh.length >= LEARN_MIN_NEW) {
      tried.current = true;
      void learnNow();
    }
  }, [state.learnedAt, fresh.length, learning, learnNow]);

  // Publish the skill whenever the rules that are on change.
  useEffect(() => {
    const body = checklistSkill(state);
    const hash = textHash(body);
    if (hash === state.publishedHash || publishing) return;
    const t = window.setTimeout(async () => {
      setPublishing(true);
      try {
        const r = await fetch("/api/jarvis-profile/skill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body }),
        });
        const d = (await r.json().catch(() => ({}))) as { published?: boolean; notice?: string };
        if (d.published) {
          setPublishNotice("");
          commit({ ...read(), publishedHash: hash, publishedAt: Date.now() });
        } else {
          setPublishNotice(d.notice ?? "Couldn't update the Claude Code skill just now.");
        }
      } catch {
        setPublishNotice("Couldn't update the Claude Code skill just now. Jarvis will try again.");
      } finally {
        setPublishing(false);
      }
    }, 2500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `publishing` gates re-entry; re-running on it would loop.
  }, [state, commit]);

  return {
    state,
    waiting: fresh.length,
    learning,
    notice,
    publishing,
    publishNotice,
    add,
    toggle,
    remove,
    seen,
    learnNow,
  };
}
