"use client";

// The chip library: 16 drawers plus All, Saved and Suggested, one search across
// every drawer, and a form for an ingredient of your own. Clicking a chip adds
// it to the build; clicking it again takes it out.

import { useMemo, useState } from "react";
import { ChevronDown, Library, Plus, Search, Star } from "lucide-react";
import { searchLibrary, CHIP_LIBRARY } from "@/lib/image-studio/inspire/chipLibrary";
import type { Recommendation } from "@/lib/image-studio/inspire/discover";
import { CHIP_CATEGORIES, categoryOf, groupOf, type ChipCategoryId } from "@/lib/image-studio/inspire/taxonomy";
import type { Chip, LibraryChip } from "@/lib/image-studio/inspire/types";
import { useInspire } from "../store";
import { chipStyle, DnaChip } from "../ui";
import { chipKey, seq, useBuild } from "./shared";

type Tab = "all" | "saved" | "suggested" | ChipCategoryId;

const LIB_KEYS = new Set(CHIP_LIBRARY.map((c) => chipKey(c)));

export function ChipLibrary({ recs }: { recs: Recommendation[] }) {
  const { me, lib, patchItem, saveChip, requireSignIn, go, toast } = useInspire();
  const { has, toggle, add } = useBuild();
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [cat, setCat] = useState<ChipCategoryId>("subject");
  const [keep, setKeep] = useState(true);

  const saved = useMemo(
    () =>
      lib.items
        .filter((i): i is LibraryChip => i.kind === "chip")
        .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt.localeCompare(a.updatedAt)),
    [lib.items],
  );
  /** The person's own chips that the built-in library does not have. */
  const ownExtras = useMemo(() => saved.filter((s) => !LIB_KEYS.has(chipKey(s.chip))).map((s) => s.chip), [saved]);

  const query = q.trim();
  const results = useMemo<Chip[]>(() => {
    if (!query) return [];
    const words = query.toLowerCase().split(/\s+/);
    const mine = ownExtras.filter((c) => words.every((w) => c.text.toLowerCase().includes(w)));
    return [...mine, ...searchLibrary(query)];
  }, [query, ownExtras]);

  const addCustom = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.replace(/\s+/g, " ").trim();
    if (!t) return;
    const chip: Chip = { text: t.slice(0, 60), category: cat };
    add([chip]);
    setText("");
    if (keep && me?.signedIn) void saveChip(chip, { custom: true });
    else toast(`Added "${chip.text}" to your build`);
  };

  const chipList = (chips: Chip[]) => (
    <div className="insp-chips insp-seq">
      {chips.map((c, i) => (
        <DnaChip key={`${c.category}:${c.text}`} chip={c} small pressed={has(c)} onClick={() => toggle(c)} style={seq(i)} />
      ))}
    </div>
  );

  let body: React.ReactNode;
  if (query) {
    body = (
      <div style={{ display: "grid", gap: 10 }}>
        <div className="insp-faint" style={{ fontSize: 12 }} role="status">
          {results.length ? `${results.length} match${results.length === 1 ? "" : "es"} across every drawer` : `Nothing matches "${query}". Add it as your own chip below.`}
        </div>
        {results.length > 0 && chipList(results)}
      </div>
    );
  } else if (tab === "all") {
    body = (
      <div style={{ display: "grid", gap: 16 }}>
        {CHIP_CATEGORIES.map((c) => (
          <div key={c.id}>
            <button type="button" className="b-drawer-head" onClick={() => setTab(c.id)} style={chipStyle({ category: c.id })}>
              <span className="b-dot" aria-hidden />
              {c.label}
              <span className="insp-count">{searchLibrary("", c.id).length}</span>
            </button>
            {chipList([...ownExtras.filter((x) => x.category === c.id), ...searchLibrary("", c.id)])}
          </div>
        ))}
      </div>
    );
  } else if (tab === "saved") {
    body = !me?.signedIn ? (
      <div className="insp-note" style={{ display: "grid", gap: 8 }}>
        Sign in to keep chips you like and find them here in every build.
        <button type="button" className="insp-btn insp-btn-sm" style={{ justifySelf: "start" }} onClick={() => requireSignIn("save prompt chips", () => setTab("saved"))}>
          Sign in
        </button>
      </div>
    ) : !saved.length ? (
      <div className="insp-note" style={{ display: "grid", gap: 8 }}>
        No saved chips yet. Save ingredients from any image&apos;s Prompt DNA in Explore, or add your own below.
        <button type="button" className="insp-btn insp-btn-sm" style={{ justifySelf: "start" }} onClick={() => go("explore")}>
          Open Explore
        </button>
      </div>
    ) : (
      <div className="insp-chips insp-seq">
        {saved.map((s, i) => (
          <span key={s.id} className="b-saved" style={seq(i)}>
            <DnaChip chip={s.chip} small pressed={has(s.chip)} onClick={() => toggle(s.chip)} />
            <button
              type="button"
              className="b-star"
              aria-pressed={s.favorite}
              aria-label={s.favorite ? `Unfavourite ${s.chip.text}` : `Favourite ${s.chip.text}`}
              onClick={() => void patchItem(s.id, { favorite: !s.favorite })}
            >
              <Star size={13} fill={s.favorite ? "currentColor" : "none"} />
            </button>
          </span>
        ))}
      </div>
    );
  } else if (tab === "suggested") {
    body = recs.length ? (
      <ul className="b-recs insp-seq">
        {recs.map((r, i) => (
          <li key={r.text} style={seq(i)}>
            <DnaChip chip={r} small pressed={has(r)} onClick={() => toggle(r)} />
            <span className="insp-faint">{r.reason}</span>
          </li>
        ))}
      </ul>
    ) : (
      <p className="insp-faint" style={{ margin: 0, fontSize: 12.5 }}>
        Your build already covers every kind of ingredient. Nice.
      </p>
    );
  } else {
    const c = categoryOf(tab);
    body = (
      <div style={{ display: "grid", gap: 10 }}>
        <p className="insp-faint" style={{ margin: 0, fontSize: 12.5 }}>
          {c.label} feed the <span style={{ color: "var(--ink-2)" }}>{groupOf(tab).label}</span> of a picture — {groupOf(tab).role.toLowerCase()}
        </p>
        {chipList([...ownExtras.filter((x) => x.category === tab), ...searchLibrary("", tab)])}
      </div>
    );
  }

  const pill = (id: Tab, label: string, extra?: React.ReactNode) => (
    <button key={id} type="button" className="insp-pill b-pill" aria-pressed={!query && tab === id} onClick={() => { setTab(id); setQ(""); }}>
      {extra}
      {label}
    </button>
  );

  return (
    <aside className="b-lib" aria-label="Chip library">
      <button type="button" className="insp-btn b-lib-toggle" aria-expanded={open} aria-controls="b-lib-body" onClick={() => setOpen((o) => !o)}>
        <Library size={15} /> Chip library
        <span className="insp-count">{CHIP_LIBRARY.length + ownExtras.length} chips</span>
        <ChevronDown size={15} style={{ marginLeft: "auto", transform: open ? "rotate(180deg)" : undefined, transition: "transform .2s" }} />
      </button>
      <div id="b-lib-body" className="b-lib-body" data-open={open}>
        <div className="b-lib-head">
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <h2 className="insp-kicker" style={{ margin: 0 }}>
              Chip library
            </h2>
            <span className="insp-count">{CHIP_LIBRARY.length + ownExtras.length} ingredients</span>
          </div>
          <label className="insp-search">
            <Search size={15} />
            <input className="insp-input" style={{ height: 38, fontSize: 13 }} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search every drawer" aria-label="Search chips" />
          </label>
          <div className="b-pills" aria-label="Drawers">
            {pill("all", "All")}
            {pill("saved", `Saved${saved.length ? ` ${saved.length}` : ""}`, <Star size={11} />)}
            {pill("suggested", "Suggested")}
            {CHIP_CATEGORIES.map((c) => pill(c.id, c.label, <span className="b-dot" style={chipStyle({ category: c.id })} aria-hidden />))}
          </div>
        </div>
        <div className="b-lib-list">{body}</div>
        <form className="b-custom" onSubmit={addCustom}>
          <span className="insp-kicker">Add custom chip</span>
          <input className="insp-input" style={{ height: 36 }} value={text} onChange={(e) => setText(e.target.value)} maxLength={60} placeholder="chrome dragon scales" aria-label="Custom chip words" />
          <div style={{ display: "flex", gap: 6 }}>
            <select className="insp-select" style={{ height: 36 }} value={cat} onChange={(e) => setCat(e.target.value as ChipCategoryId)} aria-label="Custom chip drawer">
              {CHIP_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <button type="submit" className="insp-btn" style={{ height: 36 }} disabled={!text.trim()}>
              <Plus size={14} /> Add
            </button>
          </div>
          <label className="insp-faint" style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={keep && Boolean(me?.signedIn)}
              onChange={(e) => (e.target.checked && !me?.signedIn ? requireSignIn("save prompt chips", () => setKeep(true)) : setKeep(e.target.checked))}
            />
            {me?.signedIn ? "Also save to my chips" : "Also save to my chips (sign in)"}
          </label>
        </form>
      </div>
    </aside>
  );
}
