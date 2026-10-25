"use client";

// ---------------------------------------------------------------------------
// Money Agent Studio's state: its own board, Personas Studio's board (read for
// accounts and views, written once per Approve), and In Queue (where the PC
// picks up clip and video jobs and sends the finished files back).
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRemotePull } from "@/lib/sync/useSync";
import { useRequests } from "@/lib/new-jarvis/useRequests";
import { KEY as PERSONAS_KEY, loadBoard as loadPersonas, saveBoard as savePersonas, upsertPersona } from "@/lib/social-personas/store";
import type { Board as PersonasBoard, DraftMedia } from "@/lib/social-personas/types";
import {
  QUEUE_FOLDER,
  addItems,
  addPayout,
  arrivedFromPc,
  clipBrief,
  defaultCaption,
  draftFor,
  newId,
  newItem,
  removeAgent,
  removeItem,
  removePayout,
  totals,
  updateItem,
  upsertAgent,
  videoBrief,
  wentLive,
} from "./logic";
import { KEY, loadBoard, saveBoard } from "./store";
import type { Agent, Board, Item, Moment, Payout, Script, VideoIdea } from "./types";

export interface Toast {
  id: number;
  text: string;
  undo?: () => void;
  tone?: "ok" | "warn";
}

export function useMoneyAgents() {
  const [board, setBoard] = useState<Board>(() => loadBoard());
  const [personas, setPersonas] = useState<PersonasBoard>(() => loadPersonas());
  const [toast, setToast] = useState<Toast | null>(null);
  const requests = useRequests();
  const boardRef = useRef(board);
  boardRef.current = board;

  useRemotePull(KEY, () => setBoard(loadBoard()));
  useRemotePull(PERSONAS_KEY, () => setPersonas(loadPersonas()));

  // Personas Studio may change in another tab (a sync, a post going out).
  useEffect(() => {
    const again = () => {
      if (document.visibilityState === "visible") setPersonas(loadPersonas());
    };
    document.addEventListener("visibilitychange", again);
    window.addEventListener("focus", again);
    return () => {
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("focus", again);
    };
  }, []);

  const commit = useCallback((next: Board) => {
    boardRef.current = next;
    setBoard(next);
    saveBoard(next);
  }, []);

  const say = useCallback((text: string, undo?: () => void, tone: Toast["tone"] = "ok") => {
    setToast({ id: Date.now(), text, undo, tone });
  }, []);

  // Finished videos from the PC move to Approve; posts Personas Studio has
  // seen go live move to Posted. Automatic, no button (the owner's rule).
  useEffect(() => {
    let next = boardRef.current;
    const arrived = arrivedFromPc(next.items, requests.ready ? requests.doc : null);
    for (const id of arrived) next = updateItem(next, id, { stage: "ready" });
    const live = wentLive(next.items, personas.personas);
    for (const id of live) next = updateItem(next, id, { stage: "posted" });
    if (arrived.length || live.length) {
      commit(next);
      if (arrived.length) say(`${arrived.length} new video${arrived.length > 1 ? "s" : ""} ready for your approval.`);
    }
  }, [requests.doc, requests.ready, personas, commit, say]);

  const saveAgent = useCallback((a: Agent) => commit(upsertAgent(boardRef.current, a)), [commit]);

  const deleteAgent = useCallback(
    (id: string) => {
      const before = boardRef.current;
      const name = before.agents.find((a) => a.id === id)?.name ?? "Agent";
      commit(removeAgent(before, id));
      say(`${name} deleted.`, () => commit(before));
    },
    [commit, say],
  );

  /** Moments from a long video become Idea items for an agent. */
  const keepMoments = useCallback(
    (agent: Agent, sourceUrl: string, moments: Moment[]) => {
      const items = moments.map((m) => {
        const fallback = defaultCaption({ hook: m.hook, title: m.title }, agent);
        return newItem(agent.id, {
          kind: "clip",
          stage: "idea",
          title: m.title,
          hook: m.hook,
          why: m.why,
          score: m.score,
          sourceUrl,
          start: m.start,
          end: m.end,
          caption: m.caption || fallback.caption,
          hashtags: m.hashtags?.length ? m.hashtags : fallback.hashtags,
        });
      });
      const { board: next, added, skipped } = addItems(boardRef.current, items);
      commit(next);
      say(
        skipped
          ? `Kept ${added.length} clip${added.length === 1 ? "" : "s"} — ${skipped} you already had ${skipped === 1 ? "was" : "were"} skipped.`
          : `Kept ${added.length} clip${added.length === 1 ? "" : "s"}.`,
      );
      // Remember the source on the agent, newest first, once.
      if (sourceUrl && !agent.sources.includes(sourceUrl)) {
        commit(upsertAgent(boardRef.current, { ...agent, sources: [sourceUrl, ...agent.sources].slice(0, 200) }));
      }
      return added;
    },
    [commit, say],
  );

  const keepIdeas = useCallback(
    (agent: Agent, ideas: VideoIdea[]) => {
      const items = ideas.map((i) =>
        newItem(agent.id, { kind: "video", stage: "idea", title: i.title, hook: i.hook, why: [i.angle, i.why].filter(Boolean).join(" — ") }),
      );
      const { board: next, added, skipped } = addItems(boardRef.current, items);
      commit(next);
      say(skipped ? `Kept ${added.length} — ${skipped} already on the list.` : `Kept ${added.length} idea${added.length === 1 ? "" : "s"}.`);
    },
    [commit, say],
  );

  const setScript = useCallback(
    (item: Item, script: Script) => {
      commit(
        updateItem(boardRef.current, item.id, {
          script,
          stage: item.stage === "idea" ? "script" : item.stage,
          hook: script.hook || item.hook,
          caption: item.caption || script.description,
        }),
      );
    },
    [commit],
  );

  const patchItem = useCallback((id: string, patch: Partial<Item>) => commit(updateItem(boardRef.current, id, patch)), [commit]);

  /** Send items to the PC to be made. One In Queue request per item. */
  const make = useCallback(
    async (items: Item[]) => {
      let ok = 0;
      for (const item of items) {
        const agent = boardRef.current.agents.find((a) => a.id === item.agentId);
        if (!agent) continue;
        const text = item.kind === "clip" ? clipBrief(agent, item) : videoBrief(agent, item);
        const added = await requests.add(QUEUE_FOLDER, text);
        const req = added[0];
        if (!req) continue;
        commit(updateItem(boardRef.current, item.id, { stage: "rendering", requestId: req.id }));
        ok++;
      }
      if (ok) {
        say(
          `Sent ${ok} to your PC. It makes ${ok === 1 ? "it" : "them"} the next time Claude Code works your queue ("work my Jarvis queue"), and ${ok === 1 ? "it shows" : "they show"} up in Approve.`,
        );
      } else {
        say(requests.error ?? "In Queue didn't take that. Sign in, then try again.", undefined, "warn");
      }
      return ok;
    },
    [commit, requests, say],
  );

  const reject = useCallback(
    (item: Item) => {
      const before = boardRef.current;
      commit(updateItem(before, item.id, { stage: "rejected" }));
      say("Skipped. It won't be made again.", () => commit(before));
    },
    [commit, say],
  );

  const restore = useCallback((item: Item) => commit(updateItem(boardRef.current, item.id, { stage: item.script ? "script" : "idea" })), [commit]);

  const deleteItem = useCallback(
    (item: Item) => {
      const before = boardRef.current;
      commit(removeItem(before, item.id));
      say("Deleted.", () => commit(before));
    },
    [commit, say],
  );

  /**
   * Yes: the item becomes a Personas Studio draft (Ready, or Scheduled when a
   * time was picked) on the agent's persona and accounts, with its video. From
   * there Personas Studio's own posting queue does the posting.
   */
  const approve = useCallback(
    async (item: Item, opts: { personaId: string; accountIds: string[]; scheduledAt: string | null }): Promise<boolean> => {
      const agent = boardRef.current.agents.find((a) => a.id === item.agentId);
      const fresh = loadPersonas();
      const persona = fresh.personas.find((p) => p.id === opts.personaId);
      if (!agent || !persona) {
        say("Pick a persona to post as first — set one up in Personas Studio if you have none.", undefined, "warn");
        return false;
      }
      let media: DraftMedia | null = null;
      if (item.requestId) {
        try {
          const res = await fetch("/api/money-agents/handoff", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requestId: item.requestId, name: item.title || item.hook }),
          });
          const data = (await res.json()) as { media?: DraftMedia; error?: string };
          if (res.ok && data.media) media = data.media;
          else say(`${data.error ?? "The video couldn't be copied."} It's in Personas Studio without its video — attach it there.`, undefined, "warn");
        } catch {
          say("Couldn't reach the website to copy the video. It's in Personas Studio without it — attach it there.", undefined, "warn");
        }
      }
      const draftId = newId("dr");
      const draft = draftFor(item, agent, { accountIds: opts.accountIds, scheduledAt: opts.scheduledAt, media, draftId });
      const nextPersonas = upsertPersona(fresh, { ...persona, drafts: [draft, ...persona.drafts] });
      savePersonas(nextPersonas);
      setPersonas(nextPersonas);
      commit(updateItem(boardRef.current, item.id, { stage: "approved", personaId: persona.id, draftId }));
      if (media) say(opts.scheduledAt ? `Approved — scheduled in Personas Studio as ${persona.name}.` : `Approved — ready to post in Personas Studio as ${persona.name}.`);
      return true;
    },
    [commit, say],
  );

  const logPayout = useCallback(
    (p: Omit<Payout, "id" | "createdAt">) => {
      const payout: Payout = { ...p, id: newId("pay"), createdAt: new Date().toISOString() };
      commit(addPayout(boardRef.current, payout));
      say(`Logged ${p.amount.toLocaleString("en-US", { style: "currency", currency: "USD" })}.`);
    },
    [commit, say],
  );

  const deletePayout = useCallback(
    (id: string) => {
      const before = boardRef.current;
      commit(removePayout(before, id));
      say("Payout removed.", () => commit(before));
    },
    [commit, say],
  );

  const sums = useMemo(() => totals(board, personas.personas), [board, personas]);

  return {
    board,
    personas: personas.personas,
    requests,
    sums,
    toast,
    dismissToast: () => setToast(null),
    say,
    saveAgent,
    deleteAgent,
    keepMoments,
    keepIdeas,
    setScript,
    patchItem,
    make,
    reject,
    restore,
    deleteItem,
    approve,
    logPayout,
    deletePayout,
  };
}

export type MoneyAgents = ReturnType<typeof useMoneyAgents>;
