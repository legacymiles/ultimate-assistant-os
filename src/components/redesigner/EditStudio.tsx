"use client";

// ---------------------------------------------------------------------------
// Website Redesigner — Edit.
//
// Every website edit starts here: the page, the change, and three Flux 2
// mockups of it painted onto the live page before a line of code moves.
// Pick one (tweak it first if it's nearly right) and it goes to the build
// with the picked picture attached, so the builder is held to what the owner
// actually saw.
//
// It is also where an edit asked for in Claude Code chat lands: the chat
// command (tools/mockup-edit) prints a link here carrying the page, the change
// and the three readings it wrote from the code, and the drawer's cache hands
// this board the same pictures the chat already showed.
//
//   /apps/app-builder?section=redesign&v=edit&url=…&edit=…[&name=…][&l1=…&l2=…&l3=…][&go=1]
//
// Design skill: interactive-web-studio's craft floor in the Redesigner's own
// house skin (void / ink / signal, Archivo Black over JetBrains Mono), closed
// by impeccable.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";

import { MockupBakeOff } from "@/components/mockup/MockupBakeOff";
import { QUEUE_FOLDER, QUEUE_HREF } from "@/lib/app-builder/queue";
import { editBrief, nameFromUrl, type CustomLane, type EditPick } from "@/lib/mockup/edit";
import { shrinkImage } from "@/lib/mockup/shrink";
import { specFromEdits } from "@/lib/mockup/spec";

import "./edit-studio.css";

interface Job {
  url: string;
  edit: string;
  name: string;
  lanes: CustomLane[];
}

interface Picked {
  pick: EditPick;
  image?: string;
}

const RECENT_KEY = "rdx-edit-recent";

/** Turn what was typed into an address the PC can photograph. */
export function normalizeUrl(raw: string, origin = ""): string {
  const t = raw.trim();
  if (!t) return "";
  if (t.startsWith("/")) return origin ? `${origin}${t}` : t;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(t)) return `http://${t}`;
  return `https://${t}`;
}

function readQuery(): (Job & { go: boolean }) | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  const url = q.get("url") ?? "";
  const edit = q.get("edit") ?? "";
  if (!url && !edit) return null;
  const lanes: CustomLane[] = [1, 2, 3].map((i) => ({ instruction: q.get(`l${i}`) ?? "", label: q.get(`n${i}`) ?? "" }));
  return {
    url: normalizeUrl(url, window.location.origin),
    edit,
    name: q.get("name") ?? "",
    lanes: lanes.some((l) => l.instruction) ? lanes : [],
    go: q.get("go") === "1" || Boolean(url && edit),
  };
}

function readRecent(): Job[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as Job[]) : [];
    return Array.isArray(list) ? list.filter((j) => j && typeof j.url === "string" && typeof j.edit === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
}

function writeRecent(list: Job[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 6)));
  } catch {
    /* a private window: the list just isn't remembered */
  }
}

export function EditStudio() {
  const [url, setUrl] = useState("");
  const [edit, setEdit] = useState("");
  const [name, setName] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [recent, setRecent] = useState<Job[]>([]);
  const [picked, setPicked] = useState<Picked | null>(null);

  // A link from the chat command fills the form and starts painting at once.
  useEffect(() => {
    setRecent(readRecent());
    const q = readQuery();
    if (!q) return;
    setUrl(q.url);
    setEdit(q.edit);
    setName(q.name);
    if (q.go && q.url && q.edit.trim()) setJob({ url: q.url, edit: q.edit.trim(), name: q.name, lanes: q.lanes });
  }, []);

  const start = useCallback(
    (next: Job) => {
      setJob(next);
      setPicked(null);
      const list = [next, ...recent.filter((r) => !(r.url === next.url && r.edit === next.edit))].slice(0, 6);
      setRecent(list);
      writeRecent(list);
      // The address bar becomes the link to this board, so it can be shared
      // back into chat or reopened later.
      try {
        const q = new URLSearchParams(window.location.search);
        q.set("section", "redesign");
        q.set("v", "edit");
        q.set("url", next.url);
        q.set("edit", next.edit);
        if (next.name) q.set("name", next.name);
        else q.delete("name");
        window.history.replaceState(null, "", `${window.location.pathname}?${q.toString()}`);
      } catch {
        /* the board still works without the address */
      }
    },
    [recent],
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const u = normalizeUrl(url, window.location.origin);
    if (!u || !edit.trim()) return;
    start({ url: u, edit: edit.trim(), name: name.trim(), lanes: [] });
  };

  const siteName = job ? job.name || nameFromUrl(job.url) : "";
  const spec = useMemo(
    () => (job ? specFromEdits({ siteName, clientName: "", version: "now", edits: [{ text: job.edit }] }) : null),
    [job, siteName],
  );

  const canStart = Boolean(url.trim() && edit.trim());

  return (
    <div className="rdx-edit">
      <header className="rdx-edit-head">
        <p className="rdx-edit-kick">Website Redesigner · Edit</p>
        <h1 className="rdx-edit-h">See the change before it&apos;s built.</h1>
        <p className="rdx-edit-sub">
          Give the page and the change. Flux 2 photographs the live page on your PC and paints your change onto it
          three ways. Tweak the one that&apos;s nearly right, pick it, and the build is held to that picture.
        </p>
      </header>

      <form className="rdx-edit-form" onSubmit={submit}>
        <label className="rdx-edit-field">
          <span>Page</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://yoursite.com/pricing  or  /apps/cook-connect"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            required
          />
        </label>
        <label className="rdx-edit-field wide">
          <span>The change</span>
          <textarea
            value={edit}
            onChange={(e) => setEdit(e.target.value)}
            placeholder="Make the hero dark navy with a glowing purple gradient, and move the reviews up under it"
            rows={3}
            required
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canStart) {
                e.preventDefault();
                (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
              }
            }}
          />
        </label>
        <label className="rdx-edit-field">
          <span>
            Site name <em>optional</em>
          </span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Read from the address" />
        </label>
        <button type="submit" className="rdx-edit-go" disabled={!canStart}>
          {job && job.url === normalizeUrl(url, typeof window === "undefined" ? "" : window.location.origin) && job.edit === edit.trim()
            ? "Painting below"
            : "Paint 3 mockups"}
        </button>
      </form>

      {!job && recent.length > 0 && (
        <nav className="rdx-edit-recent" aria-label="Recent edits">
          <span className="rdx-edit-kick">Recent</span>
          {recent.map((r) => (
            <button
              key={`${r.url}|${r.edit}`}
              type="button"
              onClick={() => {
                setUrl(r.url);
                setEdit(r.edit);
                setName(r.name);
                start(r);
              }}
            >
              <b>{r.name || nameFromUrl(r.url)}</b>
              <span>{r.edit}</span>
            </button>
          ))}
        </nav>
      )}

      {job && spec && (
        <section className="rdx-edit-board" aria-label="Mockups">
          <MockupBakeOff
            key={`${job.url}|${job.edit}`}
            spec={spec}
            edit={job.edit}
            reference={{ url: job.url }}
            customLanes={job.lanes}
            chosen={picked ? { skill: "interactive-web-studio", at: "", by: "owner", edit: picked.pick } : null}
            onChoose={(_skill, pick, image) => pick && setPicked({ pick, image })}
            chooseLabel="Build this one"
          />
          {picked && <SendPanel job={job} siteName={siteName} picked={picked} />}
        </section>
      )}
    </div>
  );
}

/** The pick, turned into a build: the brief, the picture, and where it goes. */
function SendPanel({ job, siteName, picked }: { job: Job; siteName: string; picked: Picked }) {
  const brief = useMemo(() => editBrief({ siteName, url: job.url, pick: picked.pick }), [siteName, job.url, picked.pick]);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  // A new pick is a new brief: sending the old one again would be wrong.
  useEffect(() => {
    setState("idle");
    setError("");
  }, [brief]);

  const send = async () => {
    if (state === "sending" || state === "sent") return;
    setState("sending");
    setError("");
    try {
      const image = picked.image ? await shrinkImage(picked.image, 1280, 0.8) : "";
      const res = await fetch("/api/new-jarvis/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          folder: QUEUE_FOLDER,
          text: brief,
          images: image ? [image] : [],
          from: "website-redesigner",
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || (res.status === 401 ? "Sign in to Jarvis and try again." : "In Queue didn't take it."));
      setState("sent");
    } catch (e) {
      setState("failed");
      setError(
        e instanceof DOMException && e.name === "TimeoutError"
          ? "In Queue didn't answer in time. Your pick is still here — try again."
          : e instanceof Error
            ? e.message
            : "Couldn't send it.",
      );
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(brief);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <aside className="rdx-edit-send" aria-label="Send to build">
      <div className="rdx-edit-send-top">
        <p className="rdx-edit-kick">Picked · {picked.pick.label}</p>
        <p className="rdx-edit-send-t">
          {picked.pick.tweaks.length
            ? `With ${picked.pick.tweaks.length} tweak${picked.pick.tweaks.length === 1 ? "" : "s"}. `
            : ""}
          The builder gets this brief and the picked picture, and checks its result against it.
        </p>
      </div>
      <pre className="rdx-edit-brief">{brief}</pre>
      <div className="rdx-edit-send-row">
        <button type="button" className="rdx-edit-go" onClick={send} disabled={state === "sending" || state === "sent"}>
          {state === "sending" ? "Sending…" : state === "sent" ? "Sent to build" : "Send to build"}
        </button>
        <button type="button" className="rdx-edit-ghost" onClick={copy}>
          {copied ? "Copied" : "Copy brief"}
        </button>
        {state === "sent" && (
          <a className="rdx-edit-link" href={QUEUE_HREF}>
            Watch it in In Queue →
          </a>
        )}
      </div>
      {state === "failed" && (
        <p className="rdx-edit-err" role="alert">
          {error}
        </p>
      )}
    </aside>
  );
}
