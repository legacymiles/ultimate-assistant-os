"use client";

// ---------------------------------------------------------------------------
// The mockup bake-off — one surface, used by App Builder, Website Studio, the
// Website Redesigner and Client Review.
//
// Three lanes side by side, pick one. Shared rather than written twice because
// the owner and their client must be looking at the SAME thing: a client
// approving a look the owner never saw rendered the same way is the bug this
// component exists to make impossible.
//
// Every lane is a real page Claude writes in HTML and CSS (lib/mockup/coded.ts),
// shown in a sandboxed iframe at a true device width. Owner's call, 18 Nov
// 2026: better looking, more accurate and faster than the Flux 2 paintings it
// replaced — the words are exact and all three are written at once.
//
// Two modes:
//
//   look  — three DESIGN DIRECTIONS for something new or redesigned. Each lane
//           shows an instant layout drawing (render.ts) while Claude writes
//           the finished design from the same spec and direction.
//   edit  — three READINGS OF ONE CHANGE to a live page (`edit` prop). Claude
//           reads the page's markup and screenshot and recreates it with only
//           the asked-for part changed.
//
// Any lane can then be tweaked ("make the button green") — Claude edits that
// lane's current page, so tweaks stack. A note on the board (`revision`) is a
// tweak to all three.
//
// Iframes are `sandbox="allow-same-origin"` and never `allow-scripts` — the
// writer is told not to use scripts and coded.ts strips any anyway.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { CODED_WIDTH, mockupMeta, roleLabel, type CodedRequest } from "@/lib/mockup/coded";
import { codedLook, codedSpec } from "@/lib/mockup/codedLook";
import { directionsFor } from "@/lib/mockup/directions";
import { editLanes, type CustomLane, type EditLaneId, type EditPick, type SiteFacts } from "@/lib/mockup/edit";
import { FRAME_HEIGHT, FRAME_WIDTH, renderMockup } from "@/lib/mockup/render";
import { shrinkImage } from "@/lib/mockup/shrink";
import type { Chrome, Device, LookChoice, MockupSpec } from "@/lib/mockup/types";
import {
  photographPage,
  readPageMarkup,
  useCodedMockups,
  type CodedJob,
  type CodedState,
} from "@/lib/mockup/useCodedMockups";

import "./mockup.css";

/** One saved lane: its page (and, from before 18 Nov 2026, maybe a picture). */
export interface SharedLane {
  lane: string;
  html?: string;
  image?: string;
}

/** One finished lane, handed to the host so others can see it. */
export interface PaintedLane {
  lane: EditLaneId;
  html: string;
  label: string;
  instruction: string;
}

interface Props {
  spec: MockupSpec;
  /** The design skill the spec recommends — lane 1. In edit mode, the site's own look. */
  recommended?: string | null;
  /** The direction already settled on, when there is one. */
  chosen?: LookChoice | null;
  /**
   * Pick (or re-pick) a lane. Omit to make the bake-off read-only. In edit
   * mode `pick` says which reading of the change was picked, with its tweaks;
   * `html` is the lane's coded mockup, for the build to be held to.
   */
  onChoose?: (skill: string, pick?: EditPick, html?: string) => void;
  /** Shown on the button. "Build this look" for the owner, "Approve" for a client. */
  chooseLabel?: string;
  /** Who is looking. A client is never shown the skill's internal name. */
  as?: "owner" | "client";
  /** A short line above the lanes, in the host app's voice. */
  caption?: string;
  /**
   * Have Claude write each lane as a finished page. On by default. Off on a
   * client's screen: they see the owner's saved mockups, or the layouts.
   */
  pictures?: boolean;
  /**
   * EDIT MODE: the change being asked for, in the asker's words. When set,
   * the three lanes are three readings of this change made on the live page,
   * instead of three design directions.
   */
  edit?: string;
  /** The page as it is now: its address and/or a picture already taken. */
  reference?: { url?: string; image?: string } | null;
  /** What is known about the site beyond the screenshot (colours, fonts, features). */
  facts?: SiteFacts;
  /** Lane readings written by someone who read the code (Claude in chat), by position. */
  customLanes?: CustomLane[];
  /** Mockups saved earlier (Client Review keeps the owner's), shown wherever new ones aren't written. */
  shared?: SharedLane[] | null;
  /** Called once all three edit lanes are written, so the host can save them for others to see. */
  onPainted?: (lanes: PaintedLane[]) => void;
  /**
   * The owner's note on the three on screen ("a deeper purple, keep the white
   * cards"), for the request it was added to (`edit` = that request's words
   * with the note in them). Claude applies it to all three. A new `id` is a
   * new note.
   */
  revision?: { id: number; change: string; edit: string } | null;
}

/** A lane that could not be drawn still holds its place, carrying why. */
interface Lane {
  /** The lane's identity: a skill (look mode) or a reading (edit mode). */
  id: string;
  /** The skill a pick saves. In edit mode, the site's own look. */
  skill: string;
  title: string;
  note: string;
  role: "recommended" | "contrast";
  chrome?: Chrome;
  editId?: EditLaneId;
  /** Set when someone already wrote this lane's reading (Claude in chat). */
  custom?: CustomLane;
  instruction?: string;
  /** The instant layout drawing (look mode). */
  html: string;
  error: string;
  /** What Claude is asked to write for this lane; null until there is enough to ask. */
  request: CodedRequest | null;
}

interface Before {
  device: Device;
  image: string;
  state: "taking" | "done" | "none";
}

export function MockupBakeOff({
  spec,
  recommended,
  chosen,
  onChoose,
  chooseLabel = "Build this look",
  as = "owner",
  caption,
  pictures: write = true,
  edit,
  reference,
  facts,
  customLanes,
  shared,
  onPainted,
  revision,
}: Props) {
  const [device, setDevice] = useState<Device>("desktop");
  /** Show Claude's design, or the instant layout, in each lane (look mode). */
  const [view, setView] = useState<"designed" | "layout">("designed");
  /** Which lane is open full-width. null = all three side by side. */
  const [solo, setSolo] = useState<string | null>(null);
  /** Tweaks per lane, in order. */
  const [tweaks, setTweaks] = useState<Record<string, string[]>>({});
  const headingId = useId();
  const editing = Boolean(edit?.trim());
  const owner = as === "owner";

  // ----- the page as it is now (edit mode) ---------------------------------
  const [before, setBefore] = useState<Before | null>(null);
  const refUrl = reference?.url?.trim() || "";
  const refImage = reference?.image || "";
  useEffect(() => {
    if (!editing) return;
    // A picture in hand is used at desktop width; the phone layout is a
    // different page, so it is always photographed fresh when it can be.
    if (refImage && (device === "desktop" || !refUrl)) {
      setBefore({ device, image: refImage, state: "done" });
      return;
    }
    if (!refUrl || !write) {
      setBefore({ device, image: "", state: "none" });
      return;
    }
    let alive = true;
    setBefore({ device, image: "", state: "taking" });
    void photographPage(refUrl, device).then((image) => {
      if (alive) setBefore({ device, image, state: image ? "done" : "none" });
    });
    return () => {
      alive = false;
    };
  }, [editing, refUrl, refImage, device, write]);

  // The page's markup: what Claude recreates it from, beside the screenshot.
  const [markup, setMarkup] = useState<{ url: string; text: string; state: "reading" | "done" } | null>(null);
  useEffect(() => {
    if (!editing || !write || !owner || !refUrl) return;
    if (markup?.url === refUrl) return;
    let alive = true;
    setMarkup({ url: refUrl, text: "", state: "reading" });
    void readPageMarkup(refUrl).then((text) => {
      if (alive) setMarkup({ url: refUrl, text, state: "done" });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once per address
  }, [editing, write, owner, refUrl]);

  const shot = editing && before?.device === device && before.state === "done" ? before.image : "";
  // The screenshot Claude looks at: small enough to send, sharp enough to read.
  const [lookAt, setLookAt] = useState<{ src: string; small: string } | null>(null);
  useEffect(() => {
    if (!shot || lookAt?.src === shot) return;
    let alive = true;
    void shrinkImage(shot, 1280, 0.8)
      .catch(() => shot)
      .then((small) => {
        if (alive) setLookAt({ src: shot, small });
      });
    return () => {
      alive = false;
    };
  }, [shot, lookAt?.src]);
  const shotSmall = lookAt?.src === shot ? lookAt.small : "";

  const directions = useMemo(() => directionsFor(recommended), [recommended]);
  const baseSkill = directions[0]?.skill ?? "interactive-web-studio";

  // Edit lanes wait for the page to be read: a mockup written before the
  // screenshot and markup arrive is a stranger's website.
  const pageReady =
    !editing ||
    (before?.device === device &&
      before.state !== "taking" &&
      (!refUrl || markup?.url !== refUrl || markup.state === "done") &&
      (!shot || Boolean(shotSmall)));

  const given = customLanes?.some((l) => l?.instruction?.trim()) ? customLanes : null;

  // Building the lanes is pure string work, so it happens in a memo.
  const lanes = useMemo<Lane[]>(() => {
    if (editing) {
      const site = spec.name;
      return editLanes(edit ?? "", given ?? []).map((l, i) => {
        const custom = given?.[i]?.instruction?.trim() ? (given[i] as CustomLane) : undefined;
        return {
          id: l.id,
          editId: l.id,
          skill: baseSkill,
          title: custom ? l.label : roleLabel(l.id),
          note: l.note,
          role: i === 0 ? ("recommended" as const) : ("contrast" as const),
          custom,
          instruction: l.instruction,
          html: "",
          error: "",
          request: pageReady
            ? {
                kind: "edit" as const,
                edit: edit ?? "",
                lane: l.id,
                ...(custom ? { reading: custom } : {}),
                siteName: site,
                ...(refUrl ? { url: refUrl } : {}),
                device,
                ...(facts ? { facts } : {}),
                ...(markup?.url === refUrl && markup.text ? { markup: markup.text } : {}),
              }
            : null,
        };
      });
    }
    const cspec = codedSpec(spec);
    return directions.map((d) => {
      let html = "";
      try {
        html = renderMockup(spec, d, { device });
      } catch {
        html = "";
      }
      return {
        ...d,
        id: d.skill,
        title: d.skill,
        html,
        error: "",
        request: { kind: "look" as const, spec: cspec, look: codedLook(d, Boolean(spec.site)), role: d.role, device },
      };
    });
  }, [editing, edit, given, directions, spec, device, facts, refUrl, markup, pageReady, baseSkill]);

  // ----- the jobs: each lane, then each tweak on top of the step before -----
  // A tweak edits the page it changes, so step n is listed once step n-1 has
  // landed. `seen` mirrors the finished pages so the list can grow as they
  // arrive; every step keeps its own id, so stepping back is instant.
  const [seen, setSeen] = useState<Record<string, string>>({});
  const jobs = useMemo<CodedJob[]>(() => {
    const out: CodedJob[] = [];
    for (const l of lanes) {
      if (l.request) out.push({ id: l.id, request: l.request, image: editing ? shotSmall || undefined : undefined });
    }
    for (const l of lanes) {
      let prev = seen[`${device}:${l.id}`];
      const list = tweaks[l.id] ?? [];
      for (let n = 0; n < list.length && prev; n += 1) {
        const id = `${l.id}#${n + 1}`;
        out.push({ id, request: { kind: "tweak", html: prev, change: list[n], siteName: spec.name, device } });
        prev = seen[`${device}:${id}`];
      }
    }
    return out;
  }, [lanes, tweaks, seen, device, spec.name, editing, shotSmall]);

  const wanted = write && owner;
  const { docs, rewrite } = useCodedMockups(jobs, wanted);

  useEffect(() => {
    setSeen((had) => {
      let changed = false;
      const next = { ...had };
      for (const [id, d] of Object.entries(docs)) {
        const key = `${device}:${id}`;
        if (d.status === "done" && d.html && next[key] !== d.html) {
          next[key] = d.html;
          changed = true;
        }
      }
      return changed ? next : had;
    });
  }, [docs, device]);

  // A note on the board is a tweak to all three, once per note.
  const appliedNote = useRef(0);
  useEffect(() => {
    if (!revision || revision.id === appliedNote.current) return;
    if (revision.edit.trim() !== (edit ?? "").trim() || !revision.change.trim()) return;
    appliedNote.current = revision.id;
    setTweaks((all) => {
      const next = { ...all };
      for (const l of lanes) next[l.id] = [...(next[l.id] ?? []), revision.change.trim()].slice(0, 6);
      return next;
    });
  }, [revision, edit, lanes]);

  // Saved mockups stand in for a lane not written on THIS screen. Desktop only.
  const sharedDocs = useMemo(() => {
    const out: Record<string, CodedState & { image?: string }> = {};
    if (device !== "desktop") return out;
    for (const l of shared ?? []) {
      if (l.html) out[l.lane] = { status: "done", html: l.html, ms: 0 };
      else if (l.image) out[l.lane] = { status: "done", image: l.image, ms: 0 };
    }
    return out;
  }, [shared, device]);

  /** The newest finished page for a lane: its last tweak, else its first version. */
  const current = useCallback(
    (laneId: string): { id: string; doc?: CodedState & { image?: string }; step: number } => {
      for (let k = (tweaks[laneId] ?? []).length; k >= 1; k -= 1) {
        const d = docs[`${laneId}#${k}`];
        if (d?.status === "done") return { id: `${laneId}#${k}`, doc: d, step: k };
      }
      const own = docs[laneId];
      if (own?.status !== "done" && sharedDocs[laneId]) return { id: laneId, doc: sharedDocs[laneId], step: 0 };
      return { id: laneId, doc: own, step: 0 };
    },
    [docs, tweaks, sharedDocs],
  );

  /** What Claude says a lane does — its own label and reading, when it wrote one. */
  const laneText = useCallback(
    (lane: Lane): { title: string; instruction: string } => {
      const html = current(lane.id).doc?.html ?? "";
      const meta = html ? mockupMeta(html) : { label: "", reading: "" };
      return {
        title: lane.custom ? lane.title : meta.label || lane.title,
        instruction: meta.reading || lane.instruction || edit || "",
      };
    },
    [current, edit],
  );

  // All three written here → hand them to the host once, so it can keep them
  // where others can see them (Client Review shows them to the client).
  const told = useRef("");
  useEffect(() => {
    if (!editing || !onPainted || device !== "desktop") return;
    const done = lanes.map((l) => ({ lane: l, now: current(l.id) }));
    if (done.length !== 3 || done.some((d) => docs[d.lane.id]?.status !== "done" || !d.now.doc?.html)) return;
    const sig = `${edit}|${done.map((d) => `${d.lane.id}:${d.now.id}:${d.now.doc!.html!.length}`).join(",")}`;
    if (told.current === sig) return;
    told.current = sig;
    onPainted(
      done.map((d) => {
        const t = laneText(d.lane);
        return { lane: d.lane.editId!, html: d.now.doc!.html!, label: t.title, instruction: t.instruction };
      }),
    );
  }, [editing, onPainted, device, lanes, docs, edit, current, laneText]);

  const shown = solo ? lanes.filter((l) => l.id === solo) : lanes;
  const pickedId = editing ? chosen?.edit?.lane : chosen?.skill;

  const choose = useCallback(
    (lane: Lane) => {
      if (!onChoose) return;
      const html = current(lane.id).doc?.html;
      if (editing && lane.editId) {
        const t = laneText(lane);
        const pick: EditPick = {
          lane: lane.editId,
          label: t.title,
          edit: edit ?? "",
          instruction: t.instruction,
          tweaks: tweaks[lane.id] ?? [],
        };
        // Same lane with the same tweaks is already saved (checklist D5).
        const same = chosen?.edit?.lane === pick.lane && (chosen.edit.tweaks ?? []).join("\n") === pick.tweaks.join("\n");
        if (!same) onChoose(lane.skill, pick, html);
        return;
      }
      // Picking the direction that is already picked is a no-op rather than a
      // second write (checklist D5).
      if (chosen?.skill !== lane.skill) onChoose(lane.skill, undefined, html);
    },
    [onChoose, chosen, editing, edit, tweaks, current, laneText],
  );

  const addTweak = useCallback((laneId: string, text: string) => {
    const t = text.trim();
    if (!t) return;
    setTweaks((all) => ({ ...all, [laneId]: [...(all[laneId] ?? []), t].slice(0, 6) }));
  }, []);
  const undoTweak = useCallback((laneId: string) => {
    setTweaks((all) => ({ ...all, [laneId]: (all[laneId] ?? []).slice(0, -1) }));
  }, []);

  const heading = solo
    ? editing
      ? "One version"
      : "One direction"
    : editing
      ? "Three versions of your change"
      : "Three directions";

  const anyDone = Object.values(docs).some((d) => d.status === "done") || Object.keys(sharedDocs).length > 0;

  return (
    <section className="mk" aria-labelledby={headingId} data-mode={editing ? "edit" : "look"}>
      <header className="mk-top">
        <div>
          <h3 className="mk-h" id={headingId}>
            {heading}
          </h3>
          <p className="mk-sub">
            {caption ??
              (editing
                ? as === "client"
                  ? "Your change, made on your site three ways. Pick the one you want and we build that."
                  : "Real pages Claude writes from your live page, with only the change made. Pick one and the build is held to it."
                : as === "client"
                  ? "How your site could look. Pick the one you want and we build that."
                  : "Designed by Claude from the features you accepted. Pick one and the build is held to it.")}
          </p>
        </div>
        <div className="mk-controls">
          {wanted && !editing && (
            <div className="mk-seg" role="group" aria-label="What each lane shows">
              {(["designed", "layout"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`mk-seg-b${view === v ? " on" : ""}`}
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                >
                  {v === "designed" ? "Designed" : "Layout"}
                </button>
              ))}
            </div>
          )}
          <div className="mk-seg" role="group" aria-label="Mockup width">
            {(["desktop", "phone"] as const).map((d) => (
              <button
                key={d}
                type="button"
                className={`mk-seg-b${device === d ? " on" : ""}`}
                aria-pressed={device === d}
                onClick={() => setDevice(d)}
              >
                {d === "desktop" ? "Desktop" : "Phone"}
              </button>
            ))}
          </div>
          {solo && (
            <button type="button" className="mk-ghost" onClick={() => setSolo(null)}>
              Compare all three
            </button>
          )}
        </div>
      </header>

      {editing && <BeforeStrip edit={edit ?? ""} before={before} url={refUrl} device={device} />}

      {wanted && (
        <StatusLine
          docs={docs}
          any={anyDone}
          editing={editing}
          reading={editing && !pageReady}
          noted={Boolean(revision && appliedNote.current === revision.id)}
        />
      )}

      <div className={`mk-lanes${solo ? " mk-solo" : ""}`} data-count={shown.length}>
        {shown.map((lane) => {
          const picked = pickedId === (editing ? lane.editId : lane.skill);
          const now = current(lane.id);
          const steps = tweaks[lane.id] ?? [];
          const pending = steps.length > now.step ? docs[`${lane.id}#${now.step + 1}`] : undefined;
          const tweakFailed = pending?.status === "failed";
          const t = laneText(lane);
          const name = editing ? t.title : as === "client" ? directionLabel(lane) : lane.skill;
          const base = docs[lane.id];
          const showDoc = now.doc?.status === "done" && (editing || view === "designed" || !wanted);
          return (
            <article key={lane.id} className={`mk-lane${picked ? " picked" : ""}`}>
              <div className="mk-lane-top">
                <span className="mk-name">{name}</span>
                {lane.role === "recommended" && (
                  <span className="mk-badge">{editing ? "Closest to your words" : "Recommended"}</span>
                )}
                {picked && <span className="mk-badge yes">Chosen</span>}
              </div>

              {lane.error ? (
                <div className="mk-fail" role="status">
                  <p>{lane.error}</p>
                </div>
              ) : showDoc && now.doc?.html ? (
                <div className="mk-frame-wrap">
                  <Frame
                    html={now.doc.html}
                    device={device}
                    title={`${spec.name}: ${name}`}
                    onOpen={() => setSolo(solo ? null : lane.id)}
                    expanded={Boolean(solo)}
                  />
                  {wanted && (
                    <button type="button" className="mk-redraw" onClick={() => rewrite(now.id)} title="Have Claude write this one again">
                      Rewrite
                    </button>
                  )}
                  {pending && <WritingBadge doc={pending} tweak />}
                </div>
              ) : showDoc && now.doc?.image ? (
                <div className="mk-frame-wrap">
                  <div className={`mk-pic is-${device}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- a mockup saved as a picture before 18 Nov 2026 */}
                    <img src={now.doc.image} alt={`${spec.name}: ${name}`} />
                  </div>
                </div>
              ) : editing ? (
                <div className="mk-frame-wrap">
                  <EditPlaceholder
                    shot={shot}
                    device={device}
                    instruction={lane.custom?.instruction ?? ""}
                    doc={wanted ? base : undefined}
                    reading={!pageReady}
                    writes={wanted}
                    onRetry={wanted ? () => rewrite(lane.id) : undefined}
                  />
                </div>
              ) : (
                <div className="mk-frame-wrap">
                  {lane.html ? (
                    <Frame
                      html={lane.html}
                      device={device}
                      title={`${spec.name} in the ${directionLabel(lane)} direction`}
                      onOpen={() => setSolo(solo ? null : lane.id)}
                      expanded={Boolean(solo)}
                    />
                  ) : (
                    <div className="mk-fail" role="status">
                      <p>This direction&apos;s layout didn&apos;t draw. The other two still work.</p>
                    </div>
                  )}
                  {wanted && view === "designed" && <WritingBadge doc={base} onRetry={() => rewrite(lane.id)} />}
                </div>
              )}

              <p className="mk-note">{editing && t.instruction !== edit ? t.instruction : lane.note}</p>

              {steps.length > 0 && (
                <ol className="mk-steps" aria-label="Tweaks to this one">
                  {steps.map((s, i) => (
                    <li key={`${i}-${s}`} data-done={i < now.step ? "yes" : "no"}>
                      {s}
                    </li>
                  ))}
                </ol>
              )}

              {wanted && !lane.error && now.doc?.status === "done" && now.doc.html && (
                <TweakBox
                  busy={Boolean(pending) && !tweakFailed}
                  canUndo={steps.length > 0}
                  onTweak={(text) => addTweak(lane.id, text)}
                  onUndo={() => undoTweak(lane.id)}
                />
              )}

              {onChoose && !lane.error && (
                <button
                  type="button"
                  className={`mk-pick${picked ? " on" : ""}`}
                  onClick={() => choose(lane)}
                  aria-pressed={picked}
                >
                  {picked ? (editing ? "This is the one" : "This is the look") : chooseLabel}
                </button>
              )}
            </article>
          );
        })}
      </div>

      <p className="mk-fine">
        {editing
          ? "A mockup of the change, not the built page — the builder matches it, then checks its work against it."
          : "A mockup, not the finished app — the numbers in it are illustrative. Everything else is your own spec."}
      </p>
    </section>
  );
}

/** The page as it is, and the change asked of it — what the three lanes answer. */
function BeforeStrip({ edit, before, url, device }: { edit: string; before: Before | null; url: string; device: Device }) {
  const now = before?.device === device ? before : null;
  // No picture and none coming (a client's phone can't photograph pages): the
  // strip is just the words, rather than an empty grey box.
  const showPic = now?.state === "done" || now?.state === "taking";
  return (
    <div className={`mk-before${showPic ? "" : " no-pic"}`}>
      {showPic && (
        <div className={`mk-before-pic is-${device}`}>
          {now?.state === "done" ? (
            // eslint-disable-next-line @next/next/no-img-element -- a data: URL photographed on the owner's PC
            <img src={now.image} alt="The page as it is now" />
          ) : (
            <span className="mk-before-empty">Photographing the live page…</span>
          )}
        </div>
      )}
      <dl className="mk-before-text">
        <dt>Now</dt>
        <dd>
          {url ? (
            <a href={url} target="_blank" rel="noreferrer">
              {url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
            </a>
          ) : (
            "The page as it is"
          )}
        </dd>
        <dt>The change</dt>
        <dd className="mk-before-q">{edit}</dd>
      </dl>
    </div>
  );
}

/**
 * A lane while its mockup is being written: the page as it is now, a sweep
 * moving across it, and words that say exactly what is happening — the owner
 * should never stare at an empty card wondering whether anything is happening.
 */
function EditPlaceholder({
  shot,
  device,
  instruction,
  doc,
  reading,
  writes,
  onRetry,
}: {
  shot: string;
  device: Device;
  instruction: string;
  doc?: CodedState;
  reading: boolean;
  writes: boolean;
  onRetry?: () => void;
}) {
  const writing = doc?.status === "writing" || doc?.status === "waiting";
  const [since, setSince] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (writing) setSince(Date.now());
  }, [writing]);
  useEffect(() => {
    if (!writing) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [writing]);
  const secs = writing && since ? Math.max(0, Math.round((now - since) / 1000)) : 0;
  const failed = doc?.status === "failed";
  const busy = writes && !failed;
  const title = failed ? "This one didn't write" : !writes ? "Mockups are made on the owner's screen" : reading ? "Reading your live page" : "Claude is writing this version";
  const line = failed
    ? doc?.error || "Claude couldn't write this one."
    : !writes
      ? "Nothing has been mocked up for this change yet."
      : reading
        ? "Photographing the page and reading its markup, so the mockup is your real page with only the change made…"
        : writing
          ? `Recreating your page in HTML with the change made · ${secs}s`
          : "Getting ready…";
  return (
    <div className={`mk-pic mk-pic-wait mk-gen is-${device}${busy ? " is-busy" : ""}${writing ? " is-drawing" : ""}`} role="status" aria-live="polite">
      {/* eslint-disable-next-line @next/next/no-img-element -- the before picture, dimmed behind the words */}
      {shot && <img src={shot} alt="" aria-hidden />}
      {busy && <span className="mk-gen-sweep" aria-hidden />}
      <span className="mk-gen-light" aria-hidden />
      <div className="mk-gen-copy">
        <b>{title}</b>
        <span>{line}</span>
        {instruction && <em>{instruction}</em>}
        {failed && onRetry && (
          <button type="button" className="mk-tweak-b" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

/** "Change this one": a tweak, made to this lane's current page. */
function TweakBox({
  busy,
  canUndo,
  onTweak,
  onUndo,
}: {
  busy: boolean;
  canUndo: boolean;
  onTweak: (text: string) => void;
  onUndo: () => void;
}) {
  const [text, setText] = useState("");
  const id = useId();
  return (
    <form
      className="mk-tweak"
      onSubmit={(e) => {
        e.preventDefault();
        if (busy || !text.trim()) return;
        onTweak(text);
        setText("");
      }}
    >
      <label htmlFor={id} className="mk-sr">
        Change this one
      </label>
      <input
        id={id}
        className="mk-tweak-in"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={busy ? "Claude is making your tweak…" : "Change this one, e.g. make the button green"}
        disabled={busy}
        maxLength={300}
        enterKeyHint="send"
        autoComplete="off"
      />
      <button type="submit" className="mk-tweak-b" disabled={busy || !text.trim()}>
        Tweak
      </button>
      {canUndo && (
        <button type="button" className="mk-tweak-b ghost" onClick={onUndo} disabled={busy} title="Drop the last tweak">
          Undo
        </button>
      )}
    </form>
  );
}

/** One line saying what Claude is doing with the mockups. */
function StatusLine({
  docs,
  any,
  editing,
  reading,
  noted,
}: {
  docs: Record<string, CodedState>;
  any: boolean;
  editing: boolean;
  reading: boolean;
  noted: boolean;
}) {
  const all = Object.values(docs);
  const left = all.filter((d) => d.status === "writing" || d.status === "waiting").length;
  const failed = all.filter((d) => d.status === "failed").length;
  const by = all.find((d) => d.status === "done" && d.by)?.by ?? "";
  let text: string;
  let state = "is-direct";
  if (reading) {
    text = "Reading your live page — a screenshot and its markup — so Claude recreates the real thing…";
    state = "is-busy";
  } else if (left) {
    text = noted
      ? `Claude is applying your note to the mockups — ${left} to go.`
      : `Claude is writing the mockups as real pages, all at once — each appears as it lands. ${left} to go.`;
    state = "is-busy";
  } else if (failed && !any) {
    text = "Claude couldn't write the mockups — your PC's Claude isn't reachable and the hub's AI didn't answer. Press Try again on a lane.";
    state = "is-off";
  } else if (any) {
    text = `${editing ? "Your live page, recreated with the change" : "Designed"}${by ? ` by ${by}` : ""}. Tweak any one, or pick it.`;
  } else {
    text = "Getting ready to write the mockups…";
    state = "is-busy";
  }
  return (
    <p className={`mk-pc ${state}`} role="status">
      <span className="mk-pc-dot" aria-hidden />
      {text}
    </p>
  );
}

function WritingBadge({ doc, tweak = false, onRetry }: { doc?: CodedState; tweak?: boolean; onRetry?: () => void }) {
  if (!doc || doc.status === "done") return null;
  if (doc.status === "failed") {
    return (
      <span className="mk-paint is-failed" title={doc.error}>
        {tweak ? "That tweak didn't go through — Undo, or try other words" : "Claude didn't write this one"}
        {onRetry && (
          <button type="button" className="mk-paint-retry" onClick={onRetry}>
            Try again
          </button>
        )}
      </span>
    );
  }
  return (
    <span className="mk-paint" aria-live="polite">
      <span className="mk-paint-dot" aria-hidden />
      {tweak ? "Making your tweak…" : "Claude is designing this one…"}
    </span>
  );
}

/** What a client is told a direction is, without the skill's internal name. */
function directionLabel(lane: { skill: string; role: string }): string {
  if (lane.role === "recommended") return "Our recommendation";
  const pretty = lane.skill
    .replace(/-skill$/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return pretty;
}

/**
 * One mockup, scaled to fit.
 *
 * The scale is measured from the column rather than guessed with a media
 * query, because this component is dropped into a full-width panel in one app
 * and a narrow side column in another, and the frame has to be right in both
 * without either host knowing about it.
 *
 * Side by side, an overlay owns the pointer so a scaled iframe never traps a
 * finger mid-swipe (checklist U1) and a tap opens the lane full width. Open
 * full width, the page itself scrolls, so the whole mockup can be read.
 */
function Frame({
  html,
  device,
  title,
  onOpen,
  expanded,
}: {
  html: string;
  device: Device;
  title: string;
  onOpen: () => void;
  expanded: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.3);
  const w = FRAME_WIDTH[device] ?? CODED_WIDTH[device];
  const h = FRAME_HEIGHT[device];

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const fit = () => {
      const avail = host.clientWidth;
      if (avail > 0) setScale(Math.min(1, avail / w));
    };
    fit();
    // ResizeObserver rather than a window listener: the column changes width
    // when a lane goes solo, which no window event reports.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    ro.observe(host);
    return () => ro.disconnect();
  }, [w, device, expanded]);

  return (
    <div className="mk-frame" ref={hostRef} style={{ height: `${Math.round(h * scale)}px` }}>
      <iframe
        className={`mk-iframe${expanded ? " is-live" : ""}`}
        title={title}
        srcDoc={html}
        sandbox="allow-same-origin"
        loading="lazy"
        tabIndex={expanded ? 0 : -1}
        style={{
          width: `${w}px`,
          height: `${h}px`,
          transform: `scale(${scale})`,
        }}
      />
      <button type="button" className={`mk-open${expanded ? " is-corner" : ""}`} onClick={onOpen}>
        <span>{expanded ? "Close" : "Open full width"}</span>
      </button>
    </div>
  );
}
