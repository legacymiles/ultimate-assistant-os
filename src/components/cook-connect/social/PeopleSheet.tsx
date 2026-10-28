"use client";

// A list of people in a sheet — someone's followers, or who they follow — with
// a Follow button on every row. Rises from the bottom on a phone, centred on a laptop.

import { useEffect, useState } from "react";
import { useCook } from "../CookConnect";
import { loadFollowGraph, toggleFollow } from "@/lib/cook-connect/social";
import type { Profile } from "@/lib/cook-connect/types";
import { Avatar, Button, SearchField, TabStrip, cx } from "../ui";
import { CloseIcon, SearchIcon } from "../icons";

export type PeopleTab = "followers" | "following";

export function PeopleSheet({
  name, followers, following, initial, onClose,
}: { name: string; followers: Profile[]; following: Profile[]; initial: PeopleTab; onClose: () => void }) {
  const { sb, userId, navigate, onlineIds } = useCook();
  const [tab, setTab] = useState<PeopleTab>(initial);
  const [term, setTerm] = useState("");
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { void loadFollowGraph(sb, userId).then((g) => setMine(g.following)); }, [sb, userId]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const list = (tab === "followers" ? followers : following)
    .filter((p) => !term.trim() || `${p.display_name} ${p.handle}`.toLowerCase().includes(term.trim().toLowerCase()));

  const follow = async (p: Profile) => {
    if (!userId) return;
    const already = mine.has(p.id);
    setBusy(p.id);
    await toggleFollow(sb, userId, p.id, already);
    setMine((prev) => { const n = new Set(prev); if (already) n.delete(p.id); else n.add(p.id); return n; });
    setBusy(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-label={`${name}'s people`}>
      <button type="button" aria-label="Close" onClick={onClose} className="cc-sheet-backdrop absolute inset-0 bg-black/60 backdrop-blur-[2px]" />
      <div className="cc-sheet relative flex max-h-[82vh] w-full flex-col rounded-t-2xl border border-[var(--cc-line)]
                      bg-[var(--cc-panel)] shadow-[var(--cc-shadow)] md:max-w-[440px] md:rounded-2xl">
        <div className="flex items-center gap-2 border-b border-[var(--cc-line)] px-3 py-2.5">
          <TabStrip
            tabs={[
              { id: "followers" as const, label: "Followers", count: followers.length },
              { id: "following" as const, label: "Following", count: following.length },
            ]}
            active={tab}
            onChange={setTab}
          />
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto rounded-md p-1.5 text-[var(--cc-ink-faint)] hover:text-[var(--cc-ink)]">
            <CloseIcon size={16} />
          </button>
        </div>
        <div className="p-2.5">
          <SearchField value={term} onChange={setTerm} placeholder="Search people" icon={<SearchIcon size={14} />} />
        </div>
        <ul className="min-h-[120px] flex-1 overflow-y-auto pb-3">
          {list.length === 0 ? (
            <li className="px-4 py-8 text-center text-[13px] text-[var(--cc-ink-muted)]">
              {term ? "Nobody by that name." : tab === "followers" ? `Nobody follows ${name} yet.` : `${name} isn't following anyone yet.`}
            </li>
          ) : list.map((p, i) => (
            <li key={p.id} className={cx("flex items-center gap-2.5 px-3 py-2", i > 0 && "border-t border-[var(--cc-line-soft)]")}>
              <button
                type="button"
                onClick={() => { onClose(); navigate({ page: "profile", userId: p.id }); }}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
              >
                <Avatar id={p.id} name={p.display_name} url={p.avatar_url} size={36} online={onlineIds.has(p.id)} />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold">{p.display_name}</span>
                  <span className="block truncate text-[11px] text-[var(--cc-ink-faint)]">@{p.handle}{p.city ? ` · ${p.city}` : ""}</span>
                </span>
              </button>
              {p.id !== userId && (
                <Button variant={mine.has(p.id) ? "secondary" : "primary"} disabled={busy === p.id} onClick={() => void follow(p)}>
                  {mine.has(p.id) ? "Following" : "Follow"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
