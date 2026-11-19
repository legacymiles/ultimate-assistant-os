"use client";

// ---------------------------------------------------------------------------
// The four page kinds: Profiles home, a profile, its gallery, settings.
// Show the current level only; click to go deeper; Jarvis for everything else.
// ---------------------------------------------------------------------------

import { motion } from "motion/react";
import {
  ArrowUpRight, Calendar, ChevronDown, ChevronLeft, ChevronRight, Copy, Eye, EyeOff, ImagePlus, Images, Pencil, Plus, Settings2, Sparkles, Trash2, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ROOT } from "@/lib/profiles/seed";
import { childrenOf, fromNow, hueOf, linksOf, mediaUnder, nextDate, parentOf, pathTo, shortDate } from "@/lib/profiles/tree";
import type { Item, Media, ProfileNode, ProfilesData, Section } from "@/lib/profiles/types";
import type { ProfilesStore } from "@/lib/profiles/useProfiles";
import { fileToMedia, Ico, ICON_NAMES, MediaTile, Mark, offCardPointer, onCardPointer } from "./bits";
import type { HarnessStatus } from "@/lib/profiles/harnessBrain";

export type View = { t: "node" | "gallery" | "settings"; id: string };

export interface Nav {
  open: (v: View, from?: HTMLElement | null) => void;
  back: () => void;
  toCrumb: (index: number) => void;
  ask: (text: string, opts?: { send?: boolean }) => void;
  toast: (text: string, undoId?: string) => void;
}

const sty = (o: Record<string, string | number>) => o as CSSProperties;

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// --- top bar -------------------------------------------------------------------

export function TopBar({ data, stack, nav, right }: { data: ProfilesData; stack: View[]; nav: Nav; right?: ReactNode }) {
  const crumbs = stack.map((v, i) => ({
    i,
    name: v.t === "gallery" ? "Photos and videos" : v.t === "settings" ? "Settings" : v.id === ROOT ? "Profiles" : (data.nodes[v.id]?.name ?? "…"),
  }));
  // Keep the first and the last two; fold the middle on deep paths.
  const shown = crumbs.length > 4 ? [crumbs[0], { i: -1, name: "…" }, ...crumbs.slice(-2)] : crumbs;
  return (
    <header className="pf-top">
      {stack.length > 1 ? (
        <button type="button" className="pf-ib" onClick={nav.back} aria-label="Back">
          <ChevronLeft />
        </button>
      ) : (
        <span className="pf-brand">
          <span className="pf-dot" />
          Profiles
        </span>
      )}
      {stack.length > 1 ? (
        <nav className="pf-crumbs" aria-label="Where you are">
          {shown.map((c, k) => {
            const last = k === shown.length - 1;
            return (
              <span key={`${c.i}-${k}`} style={{ display: "contents" }}>
                {k > 0 ? <span className="pf-sep">/</span> : null}
                {last ? <b aria-current="page">{c.name}</b> : c.i < 0 ? <span className="pf-sep">…</span> : <button type="button" onClick={() => nav.toCrumb(c.i)}>{c.name}</button>}
              </span>
            );
          })}
        </nav>
      ) : null}
      <div className="pf-top-r">{right}</div>
    </header>
  );
}

// --- home ----------------------------------------------------------------------

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Good night." : h < 12 ? "Good morning." : h < 18 ? "Good afternoon." : "Good evening.";
}

export function HomeView({ store, nav, stack }: { store: ProfilesStore; nav: Nav; stack: View[] }) {
  const { data } = store;
  const top = childrenOf(data, ROOT);
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  return (
    <>
      <TopBar
        data={data}
        stack={stack}
        nav={nav}
        right={
          <button type="button" className="pf-ib" onClick={() => nav.open({ t: "settings", id: ROOT })} aria-label="Profiles settings">
            <Settings2 />
          </button>
        }
      />
      {data.examples ? (
        <div className="pf-banner pf-rise">
          <Sparkles size={16} aria-hidden="true" style={{ color: "hsl(198 90% 72%)", flex: "none" }} />
          <p>These are example profiles so you can see how it works. Tell Jarvis about your own people, businesses and jobs, or clear these.</p>
          <button type="button" className="pf-btn" onClick={() => { store.clearExamples(); nav.toast("Examples cleared"); }}>
            Clear examples
          </button>
        </div>
      ) : null}
      <div className="pf-hello pf-rise" style={sty({ "--i": 1 })}>
        <h1>{greeting()}</h1>
        <p>{today}</p>
      </div>
      {top.length ? (
        <div className="pf-bento">
          {top.map((n, i) => (
            <ProfileCard key={n.id} data={data} node={n} wide={i === 0 && top.length % 3 === 2} index={i} nav={nav} />
          ))}
        </div>
      ) : (
        <div className="pf-welcome pf-rise" style={{ marginTop: 30 }}>
          <h2>Who and what should Jarvis keep track of?</h2>
          <p>Tell Jarvis about a person, a business or a job in your own words. It makes the profile, files every detail where it belongs, and asks before saving.</p>
          <div className="pf-chips">
            {["My son Leo is 9 and in 4th grade", "I run a t-shirt printing business called…", "I work at…"].map((t) => (
              <button key={t} type="button" className="pf-chip" onClick={() => nav.ask(t)}>
                {t}
              </button>
            ))}
          </div>
        </div>
      )}
      {top.length ? (
        <div style={{ marginTop: 18, display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="pf-btn" onClick={() => nav.ask("Add a new profile for ")}>
            <Plus /> New profile
          </button>
        </div>
      ) : null}
    </>
  );
}

function ProfileCard({ data, node, wide, index, nav }: { data: ProfilesData; node: ProfileNode; wide: boolean; index: number; nav: Nav }) {
  const h = hueOf(data, node.id);
  const next = nextDate(data, node.id);
  const links = linksOf(data, node.id);
  const inside = childrenOf(data, node.id);
  const photos = mediaUnder(data, node.id).length;
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      type="button"
      className={`pf-card pf-rise${wide ? " wide" : ""}`}
      style={sty({ "--h": h, "--i": index + 2 })}
      onPointerMove={onCardPointer}
      onPointerLeave={offCardPointer}
      onClick={() => nav.open({ t: "node", id: node.id }, ref.current)}
      aria-label={`Open ${node.name}`}
    >
      <div className="pf-card-top">
        <motion.span layoutId={`mark-${node.id}`} style={{ display: "inline-flex" }}>
          <Mark node={node} hue={h} />
        </motion.span>
        <span className="pf-go">
          <ArrowUpRight />
        </span>
      </div>
      <div>
        <motion.h3 layoutId={`title-${node.id}`}>{node.name}</motion.h3>
        <p className="pf-d">{node.sub || inside.map((c) => c.name).slice(0, 3).join(" · ")}</p>
        <div className="pf-meta">
          {next ? (
            <span className="pf-when">
              <Calendar /> {next.item.k} · {shortDate(next.item.date!)}
            </span>
          ) : null}
          {links.length && wide ? (
            <>
              <span>Connected to</span>
              <span className="pf-linked">
                {links.slice(0, 5).map((l) => (
                  <Mark key={l.id} node={l} hue={hueOf(data, l.id)} size={26} />
                ))}
              </span>
            </>
          ) : !next ? (
            <span>{[inside.length ? `${inside.length} inside` : "", photos ? `${photos} photos` : ""].filter(Boolean).join(" · ")}</span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

// --- a profile -----------------------------------------------------------------

export function NodeView({ store, nav, stack, id, highlight, reveal, setReveal }: { store: ProfilesStore; nav: Nav; stack: View[]; id: string; highlight: string; reveal: Set<string>; setReveal: (id: string) => void }) {
  const { data } = store;
  const node = data.nodes[id];
  const h = hueOf(data, id);
  const inside = childrenOf(data, id);
  const links = linksOf(data, id).filter((l) => l.id !== id);
  const media = mediaUnder(data, id);
  const [open, setOpen] = useState<Set<string>>(() => new Set(node?.sections.slice(0, 4).map((s) => s.id) ?? []));
  useEffect(() => {
    if (!highlight) return;
    const sec = node?.sections.find((s) => s.items.some((i) => i.id === highlight));
    if (sec) setOpen((o) => new Set(o).add(sec.id));
  }, [highlight, node]);

  if (!node || node.archived)
    return (
      <>
        <TopBar data={data} stack={stack} nav={nav} />
        <div className="pf-welcome" style={{ marginTop: 40 }}>
          <h2>That profile isn&apos;t here anymore.</h2>
          <p>It may have been archived or moved. Go back, or ask Jarvis where it went.</p>
        </div>
      </>
    );

  let i = 0;
  return (
    <>
      <TopBar
        data={data}
        stack={stack}
        nav={nav}
        right={
          <>
            {media.length ? (
              <button type="button" className="pf-ib" onClick={() => nav.open({ t: "gallery", id })} aria-label="Photos and videos">
                <Images />
              </button>
            ) : null}
            <button type="button" className="pf-ib" onClick={() => nav.open({ t: "settings", id })} aria-label={`Settings for ${node.name}`}>
              <Settings2 />
            </button>
          </>
        }
      />
      <div className="pf-head">
        <motion.span layoutId={`mark-${id}`} style={{ display: "inline-flex" }}>
          <Mark node={node} hue={h} size={68} />
        </motion.span>
        <div className="pf-head-t">
          <p className="pf-eyebrow">{node.label}</p>
          <motion.h1 layoutId={`title-${id}`}>{node.name}</motion.h1>
          {node.sub ? <p className="pf-sub">{node.sub}</p> : null}
        </div>
      </div>

      {inside.length || media.length ? (
        <>
          <p className="pf-label pf-rise" style={sty({ "--i": i++ })}>Inside</p>
          <div className="pf-folders">
            {inside.map((c) => (
              <FolderCard key={c.id} data={data} node={c} nav={nav} index={i++} />
            ))}
            {media.length ? (
              <button
                type="button"
                className="pf-folder pf-rise"
                style={sty({ "--h": h, "--i": i++ })}
                onPointerMove={onCardPointer}
                onPointerLeave={offCardPointer}
                onClick={() => nav.open({ t: "gallery", id })}
              >
                <div className="pf-fh">
                  <Mark node={{ kind: "thing", icon: "images", name: "Photos" }} hue={h} size={36} soft />
                  <div style={{ minWidth: 0 }}>
                    <b>Photos and videos</b>
                    <small>{media.filter((m) => m.kind === "video").length ? `${media.length} · includes videos` : `${media.length}`}</small>
                  </div>
                </div>
                <div className="pf-mosaic">
                  {media.slice(0, 3).map((m) => (
                    <MediaTile key={m.id} m={m} />
                  ))}
                </div>
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      {node.sections.length ? (
        <>
          <p className="pf-label pf-rise" style={sty({ "--i": i++ })}>Details</p>
          <div className="pf-secs">
            {node.sections.map((s) => (
              <SectionCard
                key={s.id}
                store={store}
                node={node}
                section={s}
                hue={h}
                open={open.has(s.id)}
                toggle={() => setOpen((o) => { const n = new Set(o); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })}
                highlight={highlight}
                reveal={reveal}
                setReveal={setReveal}
                nav={nav}
                index={i++}
              />
            ))}
          </div>
        </>
      ) : null}

      {!node.sections.length && !inside.length && !media.length ? (
        <div className="pf-welcome pf-rise" style={{ marginTop: 10 }}>
          <h2>Tell Jarvis about {node.name}.</h2>
          <p>Say it however you like. Jarvis files each detail into the right section and asks before saving.</p>
          <div>
            <button type="button" className="pf-btn" onClick={() => nav.ask(`About ${node.name}: `)}>
              <Sparkles /> Tell Jarvis
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 16 }}>
          <button type="button" className="pf-link-btn" onClick={() => nav.ask(`Add to ${node.name}: `)}>
            <Plus /> Add details with Jarvis
          </button>
        </div>
      )}

      {links.length ? (
        <>
          <p className="pf-label">Connected</p>
          <div className="pf-folders">
            {links.map((c) => (
              <FolderCard key={c.id} data={data} node={c} nav={nav} index={i++} linked />
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

function FolderCard({ data, node, nav, index, linked = false }: { data: ProfilesData; node: ProfileNode; nav: Nav; index: number; linked?: boolean }) {
  const h = hueOf(data, node.id);
  const inside = childrenOf(data, node.id);
  const rows = node.sections.flatMap((s) => s.items).filter((x) => !x.secret).slice(0, 3);
  const media = mediaUnder(data, node.id);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      type="button"
      className="pf-folder pf-rise"
      style={sty({ "--h": h, "--i": index })}
      onPointerMove={onCardPointer}
      onPointerLeave={offCardPointer}
      onClick={() => nav.open({ t: "node", id: node.id }, ref.current)}
      aria-label={`Open ${node.name}`}
    >
      <div className="pf-fh">
        <motion.span layoutId={`mark-${node.id}`} style={{ display: "inline-flex" }}>
          <Mark node={node} hue={h} size={36} soft={node.kind === "thing"} />
        </motion.span>
        <div style={{ minWidth: 0 }}>
          <motion.b layoutId={`title-${node.id}`} style={{ display: "block" }}>{node.name}</motion.b>
          <small>{linked ? `Lives in ${data.nodes[parentOf(data, node.id) ?? ROOT]?.name ?? "Profiles"}` : node.sub}</small>
        </div>
        {inside.length ? <span className="pf-count">{inside.length}</span> : null}
      </div>
      {inside.length ? (
        <div className="pf-peek">
          {inside.slice(0, 3).map((c) => (
            <span key={c.id}>
              <Mark node={c} hue={h} size={18} />
              {c.name}
            </span>
          ))}
        </div>
      ) : rows.length ? (
        <div className="pf-peek">
          {rows.map((r) => (
            <span key={r.id}>
              {r.k} · {r.money !== undefined ? money(r.money) : r.v}
            </span>
          ))}
        </div>
      ) : media.length ? (
        <div className="pf-mosaic">
          {media.slice(0, 3).map((m) => (
            <MediaTile key={m.id} m={m} />
          ))}
        </div>
      ) : null}
    </button>
  );
}

function SectionCard({ store, node, section, hue, open, toggle, highlight, reveal, setReveal, nav, index }: {
  store: ProfilesStore; node: ProfileNode; section: Section; hue: number; open: boolean; toggle: () => void; highlight: string;
  reveal: Set<string>; setReveal: (id: string) => void; nav: Nav; index: number;
}) {
  const [adding, setAdding] = useState(false);
  const [k, setK] = useState("");
  const [v, setV] = useState("");
  const add = () => {
    if (!k.trim()) return;
    store.apply([{ op: "add_item", node: node.id, section: section.title, k, v }], `Added ${k.trim()} to ${node.name}`);
    setK("");
    setV("");
    setAdding(false);
  };
  return (
    <div className={`pf-sec pf-rise${open ? " open" : ""}`} style={sty({ "--h": hue, "--i": index })}>
      <button type="button" className="pf-sec-h" onClick={toggle} aria-expanded={open}>
        <Ico name={section.icon} />
        <span>{section.title}</span>
        <span className="pf-n">{section.items.length}</span>
        <ChevronDown className="pf-chev" aria-hidden="true" />
      </button>
      <div className="pf-sec-b">
        <div className="pf-sec-in">
          {section.items.map((it) => (
            <Row key={it.id} store={store} node={node} item={it} hue={hue} flash={highlight === it.id} revealed={reveal.has(it.id)} setReveal={setReveal} nav={nav} />
          ))}
          {adding ? (
            <form className="pf-addrow" onSubmit={(e) => { e.preventDefault(); add(); }}>
              <input id={`pf-add-k-${section.id}`} className="pf-input" placeholder="Label" value={k} onChange={(e) => setK(e.target.value)} autoFocus />
              <input id={`pf-add-v-${section.id}`} className="pf-input" placeholder="Value" value={v} onChange={(e) => setV(e.target.value)} />
              <button type="submit" className="pf-btn go" style={sty({ "--h": hue })}>Add</button>
            </form>
          ) : (
            <button type="button" className="pf-link-btn" onClick={() => setAdding(true)}>
              <Plus /> Add a row
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ store, node, item, hue, flash, revealed, setReveal, nav }: { store: ProfilesStore; node: ProfileNode; item: Item; hue: number; flash: boolean; revealed: boolean; setReveal: (id: string) => void; nav: Nav }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(item.v);
  const ref = useRef<HTMLDivElement>(null);
  const masked = item.secret && store.data.settings.mask && !revealed;
  useEffect(() => {
    if (flash) ref.current?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [flash]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(item.v);
      nav.toast(`Copied ${item.k}`);
    } catch {
      nav.toast("Your browser blocked copying");
    }
  };
  const save = () => {
    setEditing(false);
    if (val.trim() !== item.v) store.apply([{ op: "set_item", item: item.id, v: val }], `Changed ${item.k} in ${node.name}`);
  };
  return (
    <div ref={ref} className={`pf-row${flash ? " flash" : ""}`} style={sty({ "--h": hue })}>
      <span className="pf-k">
        {item.k}
        {item.meta && item.money !== undefined ? <small>{item.meta}</small> : null}
      </span>
      {editing ? (
        <form onSubmit={(e) => { e.preventDefault(); save(); }}>
          <input id={`pf-edit-${item.id}`} className="pf-input" value={val} onChange={(e) => setVal(e.target.value)} onBlur={save} autoFocus />
        </form>
      ) : masked ? (
        <button type="button" className="pf-v pf-mask" onClick={() => setReveal(item.id)} aria-label={`Show ${item.k}`}>
          <Eye /> ••••<em>Show</em>
        </button>
      ) : (
        <button type="button" className={`pf-v${item.money !== undefined ? " pf-money" : ""}`} onClick={() => { setVal(item.v); setEditing(true); }} aria-label={`Edit ${item.k}`}>
          {item.money !== undefined ? money(item.money) : item.v}
          {item.date ? <small>{fromNow(item.date)}</small> : item.meta && item.money === undefined ? <small>{item.meta}</small> : null}
        </button>
      )}
      <span className="pf-row-act">
        {item.secret && revealed ? (
          <button type="button" onClick={() => setReveal(item.id)} aria-label={`Hide ${item.k}`}>
            <EyeOff />
          </button>
        ) : null}
        <button type="button" onClick={copy} aria-label={`Copy ${item.k}`}>
          <Copy />
        </button>
        <button type="button" onClick={() => { setVal(item.v); setEditing(true); }} aria-label={`Edit ${item.k}`}>
          <Pencil />
        </button>
        <button
          type="button"
          onClick={() => {
            store.apply([{ op: "remove_item", item: item.id }], `Removed ${item.k} from ${node.name}`);
            nav.toast(`Removed ${item.k}`, "last");
          }}
          aria-label={`Remove ${item.k}`}
        >
          <Trash2 />
        </button>
      </span>
    </div>
  );
}

// --- gallery -------------------------------------------------------------------

const HEIGHTS = [260, 180, 220, 300, 200, 240, 190, 270];

export function GalleryView({ store, nav, stack, id, lightbox }: { store: ProfilesStore; nav: Nav; stack: View[]; id: string; lightbox: (list: Media[], i: number) => void }) {
  const { data } = store;
  const node = data.nodes[id];
  const h = hueOf(data, id);
  const all = mediaUnder(data, id);
  const groups = useMemo(() => {
    const ids = [...new Set(all.map((m) => m.from))].filter((x) => x !== id);
    return ids.map((x) => ({ id: x, name: data.nodes[x]?.name ?? x, n: all.filter((m) => m.from === x).length }));
  }, [all, data.nodes, id]);
  const [filter, setFilter] = useState("all");
  const list = all.filter((m) => (filter === "all" ? true : filter === "photo" || filter === "video" ? m.kind === filter : m.from === filter));
  const input = useRef<HTMLInputElement>(null);
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const made = (await Promise.all([...files].slice(0, 24).map(fileToMedia))).filter((m): m is Media => Boolean(m));
    if (!made.length) return nav.toast("Those files aren't photos or videos");
    store.apply([{ op: "add_media", node: id, media: made }], `Added ${made.length} to ${node?.name ?? "photos"}`);
    nav.toast(`Added ${made.length} to ${node?.name}`, "last");
  };
  if (!node) return null;
  return (
    <>
      <TopBar
        data={data}
        stack={stack}
        nav={nav}
        right={
          <>
            <input ref={input} id="pf-gallery-upload" type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
            <button type="button" className="pf-btn" onClick={() => input.current?.click()}>
              <ImagePlus /> Add photos
            </button>
          </>
        }
      />
      <div className="pf-head">
        <Mark node={node} hue={h} size={56} />
        <div className="pf-head-t">
          <p className="pf-eyebrow">{node.name}</p>
          <h1 style={{ fontSize: "clamp(26px,4vw,36px)" }}>Photos and videos</h1>
          <p className="pf-sub">{all.length} · newest first</p>
        </div>
      </div>
      <div className="pf-chips" style={{ marginBottom: 18 }}>
        {[{ id: "all", name: "All", n: all.length }, { id: "photo", name: "Photos", n: 0 }, { id: "video", name: "Videos", n: 0 }, ...groups].map((g) => (
          <button key={g.id} type="button" className={`pf-chip${filter === g.id ? " on" : ""}`} onClick={() => setFilter(g.id)} aria-pressed={filter === g.id}>
            {g.name}
            {g.n && g.id !== "all" ? ` · ${g.n}` : ""}
          </button>
        ))}
      </div>
      {list.length ? (
        <div className="pf-masonry">
          {list.map((m, i) => (
            <MediaTile key={m.id} m={m} caption className="pf-rise" style={sty({ height: HEIGHTS[i % HEIGHTS.length], "--i": i })} onClick={() => lightbox(list, i)} />
          ))}
        </div>
      ) : (
        <p className="pf-empty">Nothing here with that filter.</p>
      )}
    </>
  );
}

export function Lightbox({ list, index, close }: { list: Media[]; index: number; close: () => void }) {
  const [i, setI] = useState(index);
  const m = list[i];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") setI((x) => Math.min(list.length - 1, x + 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, list.length]);
  if (!m) return null;
  return (
    <motion.div className="pf-lb" role="dialog" aria-modal="true" aria-label="Photo viewer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={close}>
      <button type="button" className="pf-ib pf-lb-x" onClick={close} aria-label="Close">
        <X />
      </button>
      <button type="button" className="pf-ib" onClick={(e) => { e.stopPropagation(); setI((x) => Math.max(0, x - 1)); }} aria-label="Previous" disabled={i === 0}>
        <ChevronLeft />
      </button>
      <figure onClick={(e) => e.stopPropagation()}>
        <motion.div key={m.id} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}>
          <MediaTile m={m} />
        </motion.div>
        <figcaption>
          {m.caption}
          {m.date ? ` · ${m.date}` : ""} · {i + 1} of {list.length}
        </figcaption>
      </figure>
      <button type="button" className="pf-ib" onClick={(e) => { e.stopPropagation(); setI((x) => Math.min(list.length - 1, x + 1)); }} aria-label="Next" disabled={i === list.length - 1}>
        <ChevronRight />
      </button>
    </motion.div>
  );
}

// --- settings ------------------------------------------------------------------

const HUES = [34, 158, 345, 208, 268, 12, 188, 92];

function Switch({ on, set, label, hue }: { on: boolean; set: (v: boolean) => void; label: string; hue?: number }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="pf-switch" style={sty({ "--h": hue ?? 158 })} onClick={() => set(!on)} />;
}

export interface Extra {
  id: string;
  title: string;
  blurb?: string;
  render: () => ReactNode;
}

export function SettingsView({ store, nav, stack, id, harness, recheck, resetChat, extras = [], openExtra, embedded = false }: { store: ProfilesStore; nav: Nav; stack: View[]; id: string; harness: HarnessStatus | null; recheck: () => void; resetChat: () => void; extras?: Extra[]; openExtra?: string; embedded?: boolean }) {
  const { data } = store;
  if (id === ROOT) return <AppSettings store={store} nav={nav} stack={stack} harness={harness} recheck={recheck} resetChat={resetChat} extras={extras} openExtra={openExtra} embedded={embedded} />;
  const node = data.nodes[id];
  if (!node) return null;
  return <NodeSettings key={id} store={store} nav={nav} stack={stack} node={node} />;
}

function NodeSettings({ store, nav, stack, node }: { store: ProfilesStore; nav: Nav; stack: View[]; node: ProfileNode }) {
  const { data } = store;
  const h = hueOf(data, node.id);
  const [name, setName] = useState(node.name);
  const [sub, setSub] = useState(node.sub);
  const [confirm, setConfirm] = useState(false);
  const home = parentOf(data, node.id);
  const linkedFrom = Object.values(data.nodes).filter((n) => n.links.includes(node.id) && !n.archived);
  const commitText = () => {
    if (name.trim() && (name.trim() !== node.name || sub.trim() !== node.sub)) store.apply([{ op: "rename_node", node: node.id, name, sub }], `Renamed ${node.name}`);
  };
  const inWorld = pathTo(data, node.id)[1];
  return (
    <>
      <TopBar data={data} stack={stack} nav={nav} />
      <div className="pf-head">
        <Mark node={node} hue={h} size={56} />
        <div className="pf-head-t">
          <p className="pf-eyebrow">Settings</p>
          <h1 style={{ fontSize: "clamp(26px,4vw,36px)" }}>{node.name}</h1>
        </div>
      </div>
      <div className="pf-set">
        <section className="pf-group pf-rise" style={sty({ "--i": 0 })}>
          <h3>Identity</h3>
          <label className="pf-field">
            <span>Name</span>
            <input id="pf-set-name" className="pf-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={commitText} />
          </label>
          <label className="pf-field">
            <span>Description</span>
            <input id="pf-set-sub" className="pf-input" value={sub} onChange={(e) => setSub(e.target.value)} onBlur={commitText} />
          </label>
          <div className="pf-field">
            <span>
              Colour
              <small>{inWorld === node.id ? "Lights this whole world" : `Inherits from ${data.nodes[inWorld]?.name ?? "its world"} unless you pick one`}</small>
            </span>
            <div className="pf-swatches">
              {HUES.map((x) => (
                <button key={x} type="button" className="pf-swatch" style={sty({ "--h": x })} aria-pressed={node.hue === x} aria-label={`Colour ${x}`} onClick={() => store.apply([{ op: "patch_node", node: node.id, patch: { hue: x } }], `Recoloured ${node.name}`)} />
              ))}
            </div>
          </div>
          {node.kind === "person" ? (
            <label className="pf-field">
              <span>Initials</span>
              <input id="pf-set-initials" className="pf-input" style={{ maxWidth: 80 }} defaultValue={node.initials ?? ""} maxLength={2} onBlur={(e) => e.target.value !== (node.initials ?? "") && store.apply([{ op: "patch_node", node: node.id, patch: { initials: e.target.value.toUpperCase() } }])} />
            </label>
          ) : (
            <div className="pf-field" style={{ alignItems: "flex-start" }}>
              <span>Icon</span>
              <div className="pf-swatches" style={{ maxWidth: 280, justifyContent: "flex-end" }}>
                {ICON_NAMES.slice(0, 24).map((x) => (
                  <button key={x} type="button" className="pf-ib" style={{ width: 32, height: 32, ...(node.icon === x ? { borderColor: `hsl(${h} 70% 70%)`, color: "#fff" } : {}) }} aria-label={`Icon ${x}`} aria-pressed={node.icon === x} onClick={() => store.apply([{ op: "patch_node", node: node.id, patch: { icon: x } }])}>
                    <Ico name={x} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
        <section className="pf-group pf-rise" style={sty({ "--i": 1 })}>
          <h3>Jarvis and privacy</h3>
          <div className="pf-field">
            <span>
              Jarvis can search this profile
              <small>Off keeps it out of every answer, including what is inside it.</small>
            </span>
            <Switch hue={h} on={!node.hidden} label="Jarvis can search this profile" set={(v) => store.apply([{ op: "patch_node", node: node.id, patch: { hidden: !v } }], v ? `Jarvis can see ${node.name}` : `Hid ${node.name} from Jarvis`)} />
          </div>
          <div className="pf-field">
            <span>
              Hide codes and numbers until tapped
              <small>Applies to every profile.</small>
            </span>
            <Switch hue={h} on={data.settings.mask} label="Hide codes and numbers" set={(v) => store.setSettings({ mask: v })} />
          </div>
        </section>
        <section className="pf-group pf-rise" style={sty({ "--i": 2 })}>
          <h3>Appears in</h3>
          <div className="pf-field">
            <span>Lives in</span>
            <button type="button" className="pf-btn" onClick={() => home && nav.open({ t: "node", id: home })}>
              {home === ROOT ? "Profiles home" : (data.nodes[home ?? ROOT]?.name ?? "Profiles")}
            </button>
          </div>
          {linkedFrom.length ? (
            <div className="pf-field">
              <span>Also shown in</span>
              <div className="pf-chips">
                {linkedFrom.map((l) => (
                  <button key={l.id} type="button" className="pf-chip" onClick={() => nav.open({ t: "node", id: l.id })}>
                    {l.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="pf-field">
            <span>
              Move or link it
              <small>Tell Jarvis where it should live.</small>
            </span>
            <button type="button" className="pf-btn" onClick={() => nav.ask(`Move ${node.name} into `)}>
              Ask Jarvis
            </button>
          </div>
        </section>
        <section className="pf-group pf-rise" style={sty({ "--i": 3, borderColor: "rgba(240,120,120,.18)" })}>
          <h3>Archive</h3>
          <div className="pf-field">
            <span>
              {confirm ? `Archive ${node.name} and everything inside it?` : "Hide it from home and from Jarvis."}
              <small>You can undo it from the toast or Changed today.</small>
            </span>
            {confirm ? (
              <span style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  className="pf-btn danger"
                  onClick={() => {
                    store.apply([{ op: "archive_node", node: node.id }], `Archived ${node.name}`);
                    nav.toast(`Archived ${node.name}`, "last");
                    nav.toCrumb(Math.max(0, stack.length - 3));
                  }}
                >
                  Archive
                </button>
                <button type="button" className="pf-btn" onClick={() => setConfirm(false)}>
                  Keep
                </button>
              </span>
            ) : (
              <button type="button" className="pf-btn danger" onClick={() => setConfirm(true)}>
                Archive {node.name}
              </button>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function AppSettings({ store, nav, stack, harness, recheck, resetChat, extras, openExtra, embedded }: { store: ProfilesStore; nav: Nav; stack: View[]; harness: HarnessStatus | null; recheck: () => void; resetChat: () => void; extras: Extra[]; openExtra?: string; embedded: boolean }) {
  const { data } = store;
  // "connections@youtube" — the part before @ is the group; the rest only makes a repeat link count.
  const wanted = openExtra?.split("@")[0] ?? "";
  const [open, setOpen] = useState<string>(wanted);
  useEffect(() => {
    if (wanted) setOpen(wanted);
  }, [openExtra, wanted]);
  const brains: { id: ProfilesData["settings"]["brain"]; name: string }[] = [
    { id: "auto", name: "Automatic" },
    { id: "harness", name: "My PC harness" },
    { id: "cloud", name: "Cloud" },
    { id: "offline", name: "Offline" },
  ];
  const archived = Object.values(data.nodes).filter((n) => n.archived);
  return (
    <>
      <TopBar data={data} stack={stack} nav={nav} />
      <div className="pf-head">
        <div className="pf-head-t">
          <p className="pf-eyebrow">Settings</p>
          <h1 style={{ fontSize: "clamp(26px,4vw,36px)" }}>Profiles</h1>
        </div>
      </div>
      <div className="pf-set">
        <section className="pf-group pf-rise">
          <h3>Who answers</h3>
          <div className="pf-field" style={{ flexWrap: "wrap" }}>
            <span>
              Jarvis brain
              <small>Automatic uses your PC harness when it&apos;s on, then the cloud, then the offline reader.</small>
            </span>
            <div className="pf-seg">
              {brains.map((b) => (
                <button key={b.id} type="button" aria-pressed={data.settings.brain === b.id} onClick={() => store.setSettings({ brain: b.id })}>
                  {b.name}
                </button>
              ))}
            </div>
          </div>
          <div className="pf-field">
            <span className={`pf-status${harness?.ok ? " ok" : ""}`}>
              <i />
              {harness == null ? "Checking your PC…" : harness.ok ? `${harness.label} on your PC is ready` : harness.why}
            </span>
            <button type="button" className="pf-btn" onClick={recheck}>
              Check again
            </button>
          </div>
          <div className="pf-field">
            <span>
              Start a fresh conversation
              <small>Clears this chat and the Profiles thread on your PC.</small>
            </span>
            <button type="button" className="pf-btn" onClick={resetChat}>
              Start fresh
            </button>
          </div>
        </section>
        <section className="pf-group pf-rise" style={sty({ "--i": 1 })}>
          <h3>Privacy</h3>
          <div className="pf-field">
            <span>
              Hide codes and numbers until tapped
              <small>Gas codes, serials, account numbers.</small>
            </span>
            <Switch on={data.settings.mask} label="Hide codes and numbers" set={(v) => store.setSettings({ mask: v })} />
          </div>
        </section>
        <section className="pf-group pf-rise" style={sty({ "--i": 2 })}>
          <h3>Examples</h3>
          <div className="pf-field">
            <span>
              {data.examples ? "Example profiles are showing" : "Example profiles are cleared"}
              <small>Clearing keeps anything you added yourself.</small>
            </span>
            {data.examples ? (
              <button type="button" className="pf-btn" onClick={() => { store.clearExamples(); nav.toast("Examples cleared"); }}>
                Clear examples
              </button>
            ) : (
              <button type="button" className="pf-btn" onClick={() => { store.restoreExamples(); nav.toast("Examples are back"); }}>
                Bring them back
              </button>
            )}
          </div>
        </section>
        {!embedded ? (
          <section className="pf-group pf-rise" style={sty({ "--i": 3 })}>
            <h3>Connections and Backend checklist</h3>
            <div className="pf-field">
              <span>
                Your API keys and the build checklist
                <small>They live in Profiles › Settings inside Jarvis, where your PC helper can save keys.</small>
              </span>
              <a className="pf-btn" href="/apps/jarvis#connections">Open in Jarvis</a>
            </div>
          </section>
        ) : null}
        {archived.length ? (
          <section className="pf-group pf-rise" style={sty({ "--i": 3 })}>
            <h3>Archived</h3>
            {archived.map((n) => (
              <div key={n.id} className="pf-field">
                <span>{n.name}</span>
                <button type="button" className="pf-btn" onClick={() => store.apply([{ op: "restore_node", node: n.id }], `Restored ${n.name}`)}>
                  Restore
                </button>
              </div>
            ))}
          </section>
        ) : null}
      </div>
      {extras.length ? (
        <div className="pf-extras">
          {extras.map((x) => (
            <section key={x.id} className={`pf-sec pf-extra${open === x.id ? " open" : ""}`}>
              <button type="button" className="pf-sec-h" onClick={() => setOpen((o) => (o === x.id ? "" : x.id))} aria-expanded={open === x.id}>
                <span>
                  {x.title}
                  {x.blurb ? <small className="pf-extra-blurb">{x.blurb}</small> : null}
                </span>
                <ChevronDown className="pf-chev" aria-hidden="true" style={{ marginLeft: "auto" }} />
              </button>
              {open === x.id ? <div className="pf-extra-body">{x.render()}</div> : null}
            </section>
          ))}
        </div>
      ) : null}
    </>
  );
}
