"use client";

// One cookbook: its recipes, who wrote it, and how many people keep it.

import { useCallback, useEffect, useState } from "react";
import { useCook } from "../CookConnect";
import { Columns } from "../Columns";
import { loadRecipes, loadSaves, mySaves, toggleSave } from "@/lib/cook-connect/social";
import type { Cookbook, Profile, Recipe } from "@/lib/cook-connect/types";
import { createShare, loadSharesFor, revokeShare, shareUrl } from "@/lib/cook-connect/shares";
import type { CookbookShare } from "@/lib/cook-connect/types";
import {
  Avatar, Button, EmptyState, Field, Input, Loading, Panel, SectionHead, Select, Tag, cx, relativeTime,
} from "../ui";
import { BookmarkIcon, ClockIcon, CloseIcon, PlusIcon, SendIcon, SparkIcon } from "../icons";

export function CookbookView({ cookbookId }: { cookbookId: string }) {
  const { sb, userId, navigate, notify } = useCook();
  const [book, setBook] = useState<Cookbook | null>(null);
  const [owner, setOwner] = useState<Profile | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [saves, setSaves] = useState(0);
  const [isSaved, setIsSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shares, setShares] = useState<CookbookShare[]>([]);
  const [shareEmail, setShareEmail] = useState("");
  const [shareAccess, setShareAccess] = useState<"view" | "copy">("view");

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await sb.from("cookbooks").select("*").eq("id", cookbookId).maybeSingle();
    const found = (data as Cookbook) ?? null;
    setBook(found);
    if (found) {
      const [{ data: ownerRow }, rows, all, mine] = await Promise.all([
        sb.from("profiles").select("*").eq("id", found.owner_id).maybeSingle(),
        loadRecipes(sb, cookbookId),
        loadSaves(sb),
        userId ? mySaves(sb, userId) : Promise.resolve(new Set<string>()),
      ]);
      setOwner((ownerRow as Profile) ?? null);
      setRecipes(rows);
      setSaves(all.byCookbook[cookbookId] ?? 0);
      setIsSaved(mine.has(cookbookId));
      if (found.owner_id === userId) setShares(await loadSharesFor(sb, cookbookId));
    }
    setLoading(false);
  }, [sb, cookbookId, userId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <Columns><Loading label="Opening cookbook" /></Columns>;
  if (!book) {
    return (
      <Columns>
        <Panel>
          <EmptyState
            title="That cookbook is not here"
            body="It may have been deleted, or set to private by its author."
            action={<Button onClick={() => navigate({ page: "cookbooks" })}>Back to cookbooks</Button>}
          />
        </Panel>
      </Columns>
    );
  }

  const isMine = book.owner_id === userId;

  const save = async () => {
    if (!userId) return;
    setBusy(true);
    await toggleSave(sb, userId, book, isSaved);
    setIsSaved(!isSaved);
    setSaves((n) => n + (isSaved ? -1 : 1));
    setBusy(false);
    notify(isSaved ? `Removed ${book.title} from your saves.` : `Saved ${book.title}.`);
  };

  const makeShare = async () => {
    if (!userId || !book) return;
    setBusy(true);
    const { share, error } = await createShare(sb, userId, {
      cookbook: book,
      email: shareEmail || undefined,
      accessLevel: shareAccess,
    });
    setBusy(false);
    if (error || !share) { notify(`Could not make a link: ${error?.message ?? "unknown error"}`); return; }
    setShares(await loadSharesFor(sb, cookbookId));
    setShareEmail("");
    void navigator.clipboard?.writeText(shareUrl(share.share_link_token));
    notify("Share link made, and copied to your clipboard.");
  };

  return (
    <Columns>
      <Panel className="mb-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-[240px] flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-[20px] font-bold leading-tight tracking-tight">{book.title}</h1>
              {book.privacy === "private" && <Tag>Private</Tag>}
            </div>
            {book.description && (
              <p className="mt-1.5 max-w-[62ch] text-[13px] leading-relaxed text-[var(--cc-ink-muted)]">
                {book.description}
              </p>
            )}
            <button
              type="button"
              onClick={() => navigate({ page: "profile", userId: book.owner_id })}
              className="mt-3 flex items-center gap-2 text-left"
            >
              <Avatar id={book.owner_id} name={owner?.display_name ?? "Member"} url={owner?.avatar_url} size={26} />
              <span className="text-[12px]">
                <span className="font-semibold transition-colors hover:text-[var(--cc-ember)]">
                  {isMine ? "You" : owner?.display_name ?? "Member"}
                </span>
                <span className="text-[var(--cc-ink-faint)]">
                  {" · "}{recipes.length} recipe{recipes.length === 1 ? "" : "s"}
                  {" · "}<span className="cc-num">{saves}</span> save{saves === 1 ? "" : "s"}
                </span>
              </span>
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {isMine ? (
              <>
                <Button onClick={() => setSharing((s) => !s)}>
                  <SendIcon size={14} />
                  Share
                </Button>
                <Button variant="primary" onClick={() => navigate({ page: "new-recipe", cookbookId })}>
                  <PlusIcon size={14} />
                  Add a recipe
                </Button>
              </>
            ) : (
              <Button variant={isSaved ? "secondary" : "primary"} disabled={busy} onClick={() => void save()}>
                <BookmarkIcon size={14} filled={isSaved} />
                {isSaved ? "Saved" : "Save cookbook"}
              </Button>
            )}
          </div>
        </div>
      </Panel>

      {isMine && sharing && (
        <Panel className="mb-4 border-[var(--cc-ember)]">
          <SectionHead
            title="Share this cookbook"
            count={shares.length}
            action={
              <button
                type="button"
                onClick={() => setSharing(false)}
                aria-label="Close sharing"
                className="text-[var(--cc-ink-faint)] transition-colors hover:text-[var(--cc-ink)]"
              >
                <CloseIcon size={14} />
              </button>
            }
          />
          <div className="p-3">
            <p className="mb-3 text-[12px] leading-relaxed text-[var(--cc-ink-muted)]">
              A share link lets one person in, even when the cookbook is private. The first person to
              open a link claims it, and it stops working for anyone else.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[180px] flex-1">
                <Field label="Who is it for" hint="Optional — just so you remember who you sent it to.">
                  <Input
                    value={shareEmail}
                    onChange={(e) => setShareEmail(e.target.value)}
                    placeholder="them@example.com"
                    type="email"
                  />
                </Field>
              </div>
              <div className="w-[130px]">
                <Field label="They can">
                  <Select
                    value={shareAccess}
                    onChange={(e) => setShareAccess(e.target.value as "view" | "copy")}
                  >
                    <option value="view">Read it</option>
                    <option value="copy">Read and copy</option>
                  </Select>
                </Field>
              </div>
              <Button variant="primary" disabled={busy} onClick={() => void makeShare()}>
                Make a link
              </Button>
            </div>

            {shares.length > 0 && (
              <ul className="mt-3 border-t border-[var(--cc-line-soft)] pt-2">
                {shares.map((sh) => (
                  <li key={sh.id} className="flex items-center gap-2 py-1.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px]">
                        {sh.shared_with_email || (sh.shared_with_user_id ? "Claimed" : "Not opened yet")}
                      </span>
                      <span className="block truncate text-[11px] text-[var(--cc-ink-faint)]">
                        {sh.access_level === "copy" ? "Read and copy" : "Read"} · {relativeTime(sh.created_at)}
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        void navigator.clipboard?.writeText(shareUrl(sh.share_link_token));
                        notify("Link copied.");
                      }}
                    >
                      Copy link
                    </Button>
                    <button
                      type="button"
                      onClick={async () => {
                        await revokeShare(sb, sh.id);
                        setShares(await loadSharesFor(sb, cookbookId));
                        notify("That link no longer works.");
                      }}
                      aria-label="Revoke this link"
                      className="shrink-0 rounded-md p-1 text-[var(--cc-ink-faint)] transition-colors hover:text-[var(--cc-loss)]"
                    >
                      <CloseIcon size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>
      )}

      <Panel>
        <SectionHead title="Recipes" count={recipes.length} />
        {recipes.length === 0 ? (
          <EmptyState
            icon={<SparkIcon size={26} />}
            title={isMine ? "Nothing in here yet" : "No recipes yet"}
            body={
              isMine
                ? "Describe a dish in a sentence and the kitchen assistant will draft the ingredients and method for you to edit."
                : "The author has not added anything yet. Save the cookbook and you will see it when they do."
            }
            action={isMine ? (
              <Button variant="primary" onClick={() => navigate({ page: "new-recipe", cookbookId })}>
                Add the first recipe
              </Button>
            ) : undefined}
          />
        ) : (
          <ul>
            {recipes.map((r, i) => (
              <li
                key={r.id}
                className={cx("cc-row", i > 0 && "border-t border-[var(--cc-line-soft)]")}
              >
                <button
                  type="button"
                  onClick={() => navigate({ page: "recipe", id: r.id, cookbookId })}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                >
                  {r.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.image_url}
                      alt=""
                      loading="lazy"
                      className="h-11 w-11 shrink-0 rounded-md border border-[var(--cc-line)] object-cover"
                    />
                  ) : (
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md
                                     border border-[var(--cc-line)] bg-[var(--cc-panel-2)] text-[var(--cc-ink-faint)]">
                      <SparkIcon size={16} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold transition-colors hover:text-[var(--cc-ember)]">
                      {r.title}
                    </span>
                    {r.description && (
                      <span className="mt-0.5 block truncate text-[12px] text-[var(--cc-ink-muted)]">
                        {r.description}
                      </span>
                    )}
                    {r.tags.length > 0 && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {r.tags.slice(0, 4).map((t) => <Tag key={t}>{t}</Tag>)}
                      </span>
                    )}
                  </span>
                  {(r.prep_time || r.cook_time) && (
                    <span className="hidden w-[84px] shrink-0 items-center justify-end gap-1 text-[12px]
                                     text-[var(--cc-ink-muted)] sm:flex">
                      <ClockIcon size={13} />
                      <span className="cc-num">{(r.prep_time ?? 0) + (r.cook_time ?? 0)}m</span>
                    </span>
                  )}
                  <span className="cc-num hidden w-[62px] shrink-0 text-right text-[12px]
                                   text-[var(--cc-ink-muted)] sm:block">
                    {r.servings} serves
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </Columns>
  );
}
