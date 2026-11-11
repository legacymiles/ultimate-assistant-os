"use client";

// ---------------------------------------------------------------------------
// The mockup bake-off — one surface, used by App Builder, the Website
// Redesigner and Client Review.
//
// Three lanes, drawn, side by side, pick one. Shared rather than written
// twice because the owner and their client must be looking at the SAME thing:
// a client approving a look the owner never saw rendered the same way is the
// bug this component exists to make impossible.
//
// Two modes:
//
//   look  — three DESIGN DIRECTIONS for something new or redesigned. Each lane
//           is a coded drawing (exact layout and words), and Flux 2 paints a
//           finished picture FROM that drawing, so the words come out right.
//   edit  — three READINGS OF ONE CHANGE to a live page (`edit` prop). The
//           page is photographed on the owner's PC and Flux 2 paints each
//           reading onto that screenshot, so the mockup is the owner's own
//           site with only the asked-for part moved.
//
// Any lane can then be tweaked ("make the button green") — drawn from that
// lane's current picture, so tweaks stack like Google Stitch's.
//
// Why iframes for the coded drawings and not a React preview: a mockup has to
// be able to use its own type scale, corner radius and colour polarity without
// the hub's stylesheet leaking in. They are `sandbox="allow-same-origin"` and
// never `allow-scripts` — same-origin so the hub's woff2 faces load, no
// scripts because a drawing has no business running anything.
//
// Each lane is drawn at a real device width and then SCALED to fit its
// column, so what the owner judges is a true 1280px page, not one reflowed
// into 380px of panel and made to look broken.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { directionsFor } from "@/lib/mockup/directions";
import { editLanes, laneSeed, refineFluxPrompt, type CustomLane, type EditLaneId, type EditPick, type SiteFacts } from "@/lib/mockup/edit";
import { fluxPrompt } from "@/lib/mockup/flux";
import { FRAME_HEIGHT, FRAME_WIDTH, renderMockup } from "@/lib/mockup/render";
import type { Chrome, Device, LookChoice, MockupRef, MockupSpec } from "@/lib/mockup/types";
import {
  photographPage,
  useMockupPictures,
  type PcState,
  type PictureJob,
  type PictureState,
} from "@/lib/mockup/useMockupPictures";
import { shrinkImage } from "@/lib/mockup/shrink";

import "./mockup.css";

interface Props {
  spec: MockupSpec;
  /** The design skill the spec recommends — lane 1. In edit mode, the site's own look. */
  recommended?: string | null;
  /** The direction already settled on, when there is one. */
  chosen?: LookChoice | null;
  /**
   * Pick (or re-pick) a lane. Omit to make the bake-off read-only. In edit
   * mode `pick` says which reading of the change was picked, with its tweaks;
   * `image` is the lane's Flux picture, for the build to be held to.
   */
  onChoose?: (skill: string, pick?: EditPick, image?: string) => void;
  /** Shown on the button. "Build this look" for the owner, "Approve" for a client. */
  chooseLabel?: string;
  /** Who is looking. A client is never shown the skill's internal name. */
  as?: "owner" | "client";
  /** A short line above the lanes, in the host app's voice. */
  caption?: string;
  /**
   * Paint each lane with Flux 2 on the owner's PC when its drawer is up.
   * On by default. The drawer only answers on the owner's own machine, so a
   * client's screen simply shows the layouts.
   */
  pictures?: boolean;
  /**
   * EDIT MODE: the change being asked for, in the asker's words. When set,
   * the three lanes are three readings of this change painted onto the live
   * page, instead of three design directions.
   */
  edit?: string;
  /** The page as it is now: its address (photographed on the PC) and/or a picture already taken. */
  reference?: { url?: string; image?: string } | null;
  /** What is known about the site beyond the screenshot (colours, fonts, features). */
  facts?: SiteFacts;
  /** Lane readings written by someone who read the code (Claude in chat), by position. */
  customLanes?: CustomLane[];
  /**
   * Paintings saved earlier (Client Review keeps the owner's), shown wherever
   * Flux can't paint — a client's phone has no drawer.
   */
  shared?: { lane: string; image: string }[] | null;
  /** Called once all three edit lanes are painted, so the host can save them for others to see. */
  onPainted?: (lanes: { lane: EditLaneId; image: string; label: string; instruction: string }[]) => void;
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
  instruction?: string;
  html: string;
  error: string;
  prompt: string;
  plainPrompt?: string;
  refs?: MockupRef[];
  seed?: number;
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
  pictures: wantPictures = true,
  edit,
  reference,
  facts,
  customLanes,
  shared,
  onPainted,
}: Props) {
  const [device, setDevice] = useState<Device>("desktop");
  /** Show the Flux picture, or the coded layout, in each lane. */
  const [view, setView] = useState<"picture" | "layout">("picture");
  /** Which lane is open full-width. null = all three side by side. */
  const [solo, setSolo] = useState<string | null>(null);
  /** Tweaks per lane, in order. */
  const [tweaks, setTweaks] = useState<Record<string, string[]>>({});
  const headingId = useId();
  const editing = Boolean(edit?.trim());

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
    if (!refUrl || !wantPictures) {
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
  }, [editing, refUrl, refImage, device, wantPictures]);

  const directions = useMemo(() => directionsFor(recommended), [recommended]);
  const baseSkill = directions[0]?.skill ?? "interactive-web-studio";
  const shot = editing && before?.device === device && before.state === "done" ? before.image : "";

  // ----- the three readings (edit mode) -------------------------------------
  // Written by Claude in chat when the board came from there (customLanes);
  // otherwise the hub's vision model writes them from the screenshot, because
  // generic readings paint three near-identical pictures. Remembered per
  // request, so reopening the board asks Flux for the same pictures.
  const given = customLanes?.some((l) => l?.instruction?.trim()) ? customLanes : null;
  const [auto, setAuto] = useState<{ key: string; lanes: CustomLane[] | null } | null>(null);
  const readingsKey = `mk-readings:${(edit ?? "").trim()}|${refUrl}`;
  const wantsReadings = editing && !given && wantPictures && as === "owner";
  const deskShot = before?.device === "desktop" && before.state === "done" ? before.image : "";
  useEffect(() => {
    if (!wantsReadings || auto?.key === readingsKey) return;
    try {
      const kept = localStorage.getItem(readingsKey);
      if (kept) {
        setAuto({ key: readingsKey, lanes: JSON.parse(kept) as CustomLane[] });
        return;
      }
    } catch {
      /* no storage: ask again */
    }
    // Read from the desktop screenshot once it exists; with no picture at all
    // (the page couldn't be photographed) the built-in readings are used.
    if (before?.state === "taking") return;
    let alive = true;
    void (async () => {
      let lanes: CustomLane[] | null = null;
      try {
        const image = deskShot ? await shrinkImage(deskShot, 1280, 0.8) : "";
        const res = await fetch("/api/mockup/readings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ edit, siteName: spec.name, url: refUrl || undefined, image: image || undefined }),
          signal: AbortSignal.timeout(60_000),
        });
        const data = (await res.json().catch(() => ({}))) as { lanes?: CustomLane[] | null };
        lanes = res.ok && Array.isArray(data.lanes) && data.lanes.length === 3 ? data.lanes : null;
      } catch {
        lanes = null;
      }
      if (!alive) return;
      if (lanes) {
        try {
          localStorage.setItem(readingsKey, JSON.stringify(lanes));
        } catch {
          /* fine: they just aren't remembered */
        }
      }
      setAuto({ key: readingsKey, lanes });
    })();
    return () => {
      alive = false;
    };
  }, [wantsReadings, readingsKey, auto?.key, before?.state, deskShot, edit, spec.name, refUrl]);
  const reading = wantsReadings && auto?.key !== readingsKey;
  const lanesText = given ?? (auto?.key === readingsKey ? (auto.lanes ?? undefined) : undefined);

  // Drawing is pure string work and takes under a millisecond a lane, so it
  // happens in a memo rather than an effect.
  const lanes = useMemo<Lane[]>(() => {
    if (editing) {
      const site = { siteName: spec.name, facts, device };
      // The page's address rides along with the picture: it is what the
      // drawer's cache keys on, so the chat command and this board share
      // pictures instead of painting the same thing twice.
      const refs: MockupRef[] | undefined = shot ? [{ image: shot, ...(refUrl ? { url: refUrl } : {}) }] : undefined;
      return editLanes(edit ?? "", site, lanesText ?? []).map((l, i) => ({
        id: l.id,
        editId: l.id,
        skill: baseSkill,
        title: l.label,
        note: l.note,
        role: i === 0 ? ("recommended" as const) : ("contrast" as const),
        instruction: l.instruction,
        html: "",
        error: "",
        // No screenshot, no picture: painting "edit image 1" without an image
        // 1 is how a mockup ends up being a stranger's website.
        // Nothing is painted until the readings are settled: painting the
        // built-in ones first would spend three GPU minutes on pictures that
        // are about to be replaced.
        prompt: refs && !reading ? l.prompt : "",
        refs,
        seed: laneSeed(l.id),
      }));
    }
    return directions.map((d) => {
      try {
        const html = renderMockup(spec, d, { device });
        return {
          ...d,
          id: d.skill,
          title: d.skill,
          html,
          error: "",
          // The coded drawing is image 1: Flux keeps its structure and words
          // and does what a picture model is good at — finish.
          prompt: fluxPrompt(spec, d, device, { layoutRef: true }),
          plainPrompt: fluxPrompt(spec, d, device),
          refs: [
            {
              html,
              base: typeof window === "undefined" ? undefined : window.location.origin,
              width: FRAME_WIDTH[device],
              height: FRAME_HEIGHT[device],
            },
          ],
        };
      } catch {
        // A lane that fails keeps its place. "Why did this direction not
        // draw" is itself a result; a lane that vanishes destroys the
        // comparison the panel exists to make (checklist R1).
        return {
          ...d,
          id: d.skill,
          title: d.skill,
          html: "",
          prompt: "",
          error: "This direction didn't draw. The other two still work, and picking one of them is safe.",
        };
      }
    });
  }, [editing, edit, directions, spec, device, facts, lanesText, reading, shot, refUrl, baseSkill]);

  // ----- the jobs: each lane, then each tweak on top of the step before -----
  // A tweak is drawn from the picture it changes, so step n is listed once
  // step n-1 has landed. `seen` mirrors the finished pictures so the list can
  // grow as they arrive; every step keeps its own id, so stepping back is
  // instant.
  const [seen, setSeen] = useState<Record<string, string>>({});
  const jobs = useMemo<PictureJob[]>(() => {
    const out: PictureJob[] = [];
    // Lane order IS draw order: the recommendation is painted first.
    for (const l of lanes) {
      if (l.prompt) out.push({ id: l.id, prompt: l.prompt, refs: l.refs, plainPrompt: l.plainPrompt, seed: l.seed });
    }
    for (const l of lanes) {
      let prev = seen[`${device}:${l.id}`];
      const list = tweaks[l.id] ?? [];
      for (let n = 0; n < list.length && prev; n += 1) {
        const id = `${l.id}#${n + 1}`;
        out.push({ id, prompt: refineFluxPrompt(list[n], { siteName: spec.name, facts, device }), refs: [{ image: prev }] });
        prev = seen[`${device}:${id}`];
      }
    }
    return out;
  }, [lanes, tweaks, seen, device, spec.name, facts]);

  const { pc, pictures, redraw } = useMockupPictures(jobs, device, wantPictures);

  useEffect(() => {
    setSeen((had) => {
      let changed = false;
      const next = { ...had };
      for (const [id, p] of Object.entries(pictures)) {
        const key = `${device}:${id}`;
        if (p.status === "done" && p.image && next[key] !== p.image) {
          next[key] = p.image;
          changed = true;
        }
      }
      return changed ? next : had;
    });
  }, [pictures, device]);

  // Saved paintings stand in for a lane Flux hasn't painted on THIS screen.
  // Desktop only: they were painted at desktop width.
  const sharedPics = useMemo(() => {
    const out: Record<string, PictureState> = {};
    if (!editing || device !== "desktop") return out;
    for (const l of shared ?? []) if (l.image) out[l.lane] = { status: "done", image: l.image, ms: 0 };
    return out;
  }, [shared, editing, device]);

  const anyPicture = Object.values(pictures).some((p) => p.status === "done") || Object.keys(sharedPics).length > 0;

  /** The newest finished picture for a lane: its last tweak, else its first painting. */
  const current = useCallback(
    (laneId: string): { id: string; pic?: PictureState; step: number } => {
      for (let k = (tweaks[laneId] ?? []).length; k >= 1; k -= 1) {
        const pic = pictures[`${laneId}#${k}`];
        if (pic?.status === "done") return { id: `${laneId}#${k}`, pic, step: k };
      }
      const own = pictures[laneId];
      if (own?.status !== "done" && sharedPics[laneId]) return { id: laneId, pic: sharedPics[laneId], step: 0 };
      return { id: laneId, pic: own, step: 0 };
    },
    [pictures, tweaks, sharedPics],
  );

  // All three painted here → hand them to the host once, so it can keep them
  // where others can see them (Client Review shows them to the client).
  const told = useRef("");
  useEffect(() => {
    if (!editing || !onPainted || device !== "desktop") return;
    const done = lanes.map((l) => ({ lane: l.editId!, pic: pictures[l.id], label: l.title, instruction: l.instruction ?? "" }));
    if (done.length !== 3 || done.some((d) => d.pic?.status !== "done" || !d.pic.image)) return;
    const sig = `${edit}|${done.map((d) => `${d.lane}:${d.pic!.image!.length}`).join(",")}`;
    if (told.current === sig) return;
    told.current = sig;
    onPainted(done.map((d) => ({ lane: d.lane, image: d.pic!.image!, label: d.label, instruction: d.instruction })));
  }, [editing, onPainted, device, lanes, pictures, edit]);

  const shown = solo ? lanes.filter((l) => l.id === solo) : lanes;
  const pickedId = editing ? chosen?.edit?.lane : chosen?.skill;

  const choose = useCallback(
    (lane: Lane) => {
      if (!onChoose) return;
      const image = current(lane.id).pic?.image;
      if (editing && lane.editId) {
        const pick: EditPick = {
          lane: lane.editId,
          label: lane.title,
          edit: edit ?? "",
          instruction: lane.instruction ?? edit ?? "",
          tweaks: tweaks[lane.id] ?? [],
        };
        // Same lane with the same tweaks is already saved (checklist D5).
        const same = chosen?.edit?.lane === pick.lane && (chosen.edit.tweaks ?? []).join("\n") === pick.tweaks.join("\n");
        if (!same) onChoose(lane.skill, pick, image);
        return;
      }
      // Picking the direction that is already picked is a no-op rather than a
      // second write (checklist D5) — double-tapping a card on a phone is the
      // normal way to hit this.
      if (chosen?.skill !== lane.skill) onChoose(lane.skill, undefined, image);
    },
    [onChoose, chosen, editing, edit, tweaks, current],
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
                  ? "Your change, painted onto your site three ways. Pick the one you want and we build that."
                  : "Painted onto a screenshot of the live page with Flux 2. Pick one and the build is held to it."
                : as === "client"
                  ? "How your site could look. Pick the one you want and we build that."
                  : "Drawn from the features you accepted. Pick one and the build is held to it.")}
          </p>
        </div>
        <div className="mk-controls">
          {wantPictures && !editing && (
            <div className="mk-seg" role="group" aria-label="What each lane shows">
              {(["picture", "layout"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`mk-seg-b${view === v ? " on" : ""}`}
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                >
                  {v === "picture" ? "Flux render" : "Live layout"}
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

      {wantPictures && (
        <PcLine
          pc={pc}
          any={anyPicture}
          pictures={pictures}
          editing={editing}
          noShot={editing && before?.device === device && before.state === "none"}
          taking={editing && before?.state === "taking"}
          reading={reading && before?.state !== "taking"}
        />
      )}

      <div className={`mk-lanes${solo ? " mk-solo" : ""}`} data-count={shown.length}>
        {shown.map((lane) => {
          const picked = pickedId === (editing ? lane.editId : lane.skill);
          const now = current(lane.id);
          const steps = tweaks[lane.id] ?? [];
          const pending = steps.length > now.step ? pictures[`${lane.id}#${now.step + 1}`] : undefined;
          const tweakFailed = pending?.status === "failed";
          const name = editing ? lane.title : as === "client" ? directionLabel(lane) : lane.skill;
          const showPicture = (wantPictures || editing) && (editing || view === "picture") && now.pic?.status === "done";
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
              ) : showPicture ? (
                <div className="mk-frame-wrap">
                  <Picture
                    pic={now.pic!}
                    device={device}
                    title={`${spec.name}: ${name}, drawn with Flux 2`}
                    onOpen={() => setSolo(solo ? null : lane.id)}
                    // Only where Flux can actually paint: never on a client's screen.
                    onRedraw={wantPictures && (pc === "direct" || pc === "server") ? () => redraw(now.id) : undefined}
                    expanded={Boolean(solo)}
                  />
                  {pending && <PaintingBadge pic={pending} tweak />}
                </div>
              ) : editing ? (
                <div className="mk-frame-wrap">
                  <EditPlaceholder shot={shot} device={device} instruction={lane.instruction ?? ""} />
                  {wantPictures && <PaintingBadge pic={pictures[lane.id]} />}
                </div>
              ) : (
                <div className="mk-frame-wrap">
                  <Frame
                    html={lane.html}
                    device={device}
                    title={`${spec.name} in the ${directionLabel(lane)} direction`}
                    onOpen={() => setSolo(solo ? null : lane.id)}
                    expanded={Boolean(solo)}
                  />
                  {wantPictures && view === "picture" && <PaintingBadge pic={pictures[lane.id]} />}
                </div>
              )}

              <p className="mk-note">{lane.note}</p>

              {steps.length > 0 && (
                <ol className="mk-steps" aria-label="Tweaks to this one">
                  {steps.map((t, i) => (
                    <li key={`${i}-${t}`} data-done={i < now.step ? "yes" : "no"}>
                      {t}
                    </li>
                  ))}
                </ol>
              )}

              {wantPictures && as === "owner" && pc !== "off" && pc !== "checking" && !lane.error && now.pic?.status === "done" && (
                <TweakBox
                  busy={Boolean(pending) && !tweakFailed}
                  canUndo={steps.length > 0}
                  onTweak={(t) => addTweak(lane.id, t)}
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
          ? "A painting of the change, not the built page — the builder matches it, then checks its work against it."
          : "A drawing, not the finished app — the numbers in it are illustrative. Everything else is your own spec."}
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

/** An edit lane before Flux has painted it: the page as it is, dimmed, with the reading on top. */
function EditPlaceholder({ shot, device, instruction }: { shot: string; device: Device; instruction: string }) {
  return (
    <div className={`mk-pic mk-pic-wait is-${device}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- the before picture, dimmed behind the words */}
      {shot && <img src={shot} alt="" aria-hidden />}
      <p className="mk-pic-wait-t">{instruction}</p>
    </div>
  );
}

/** "Change this one": a tweak, drawn from this lane's current picture. */
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
        placeholder={busy ? "Painting your tweak…" : "Change this one, e.g. make the button green"}
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

/** One line saying whether Flux is painting, and how to switch it on when it isn't. */
function PcLine({
  pc,
  any,
  pictures,
  editing,
  noShot,
  taking,
  reading,
}: {
  pc: PcState;
  any: boolean;
  pictures: Record<string, PictureState>;
  editing: boolean;
  noShot: boolean;
  taking: boolean;
  reading: boolean;
}) {
  const left = Object.values(pictures).filter((p) => p.status === "drawing" || p.status === "waiting").length;
  let text: string;
  if (pc === "checking") text = "Looking for Flux 2 on your PC…";
  else if (pc === "off")
    text = any
      ? "Showing Flux 2 renders saved earlier. Your PC's drawer is off, so new ones wait until it's back."
      : editing
        ? "Flux 2 paints your change onto the live page when your PC's picture drawer is running (Pinokio + node tools/wangp-image/server.mjs)."
        : "Flux 2 renders appear here when your PC's picture drawer is running (Pinokio + node tools/wangp-image/server.mjs). Until then each lane is the live layout.";
  else if (taking) text = "Photographing the live page on your PC, so Flux paints onto the real thing…";
  else if (reading) text = "Reading the page to write three concrete versions of your change…";
  else if (noShot && !any)
    text = "Couldn't photograph the live page, so there's nothing to paint onto yet. Check the address opens, then switch Desktop/Phone to try again.";
  else if (left)
    text = `Painting with Flux 2 on your PC, one at a time, each one appearing as it lands — 1–3 minutes each on this laptop (faster with other apps closed). ${left} to go.`;
  else
    text = editing
      ? "Painted onto your live page with Flux 2 — free. Tweak any one, or pick it."
      : "Painted with Flux 2 on your PC — free. Switch to Live layout to see the exact page structure.";
  return (
    <p className={`mk-pc is-${pc}${left || taking || reading ? " is-busy" : ""}`} role="status">
      <span className="mk-pc-dot" aria-hidden />
      {text}
    </p>
  );
}

function PaintingBadge({ pic, tweak = false }: { pic?: PictureState; tweak?: boolean }) {
  if (!pic || pic.status === "done") return null;
  if (pic.status === "failed") {
    if (pic.error === "off") return null;
    return (
      <span className="mk-paint is-failed" title={pic.error}>
        {tweak ? "That tweak didn't draw — Undo, or try other words" : "Flux didn't draw this one"}
      </span>
    );
  }
  return (
    <span className="mk-paint" aria-live="polite">
      <span className="mk-paint-dot" aria-hidden />
      {pic.status === "drawing"
        ? tweak
          ? "Painting your tweak…"
          : "Painting with Flux 2…"
        : "Waiting its turn for Flux 2"}
    </span>
  );
}

/** A lane's Flux picture, at the lane's width. */
function Picture({
  pic,
  device,
  title,
  onOpen,
  onRedraw,
  expanded,
}: {
  pic: PictureState;
  device: Device;
  title: string;
  onOpen: () => void;
  onRedraw?: () => void;
  expanded: boolean;
}) {
  return (
    <div className={`mk-pic is-${device}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL from the owner's PC; next/image adds nothing */}
      <img src={pic.image} alt={title} />
      <button type="button" className="mk-open" onClick={onOpen}>
        <span>{expanded ? "Close" : "Open full width"}</span>
      </button>
      {onRedraw && (
        <button type="button" className="mk-redraw" onClick={onRedraw} title="Paint this one again with Flux 2">
          Redraw
        </button>
      )}
    </div>
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
 * One drawn mockup, scaled to fit.
 *
 * The scale is measured from the column rather than guessed with a media
 * query, because this component is dropped into a full-width panel in one app
 * and a narrow side column in another, and the frame has to be right in both
 * without either host knowing about it.
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
  const w = FRAME_WIDTH[device];
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
        className="mk-iframe"
        title={title}
        srcDoc={html}
        sandbox="allow-same-origin"
        loading="lazy"
        tabIndex={-1}
        style={{
          width: `${w}px`,
          height: `${h}px`,
          transform: `scale(${scale})`,
        }}
      />
      {/*
        The overlay is what makes the lane tappable at all: a scaled iframe
        swallows pointer events and would trap a finger mid-swipe on a phone
        (checklist U1). It sits over the frame, so the page keeps scrolling and
        a tap opens the lane full width.
      */}
      <button type="button" className="mk-open" onClick={onOpen}>
        <span>{expanded ? "Close" : "Open full width"}</span>
      </button>
    </div>
  );
}
