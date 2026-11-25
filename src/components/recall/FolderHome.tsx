"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import { childFolders } from "@/lib/recall/store";
import type { Folder, RecallData } from "@/lib/recall/types";
import { HOME_ACCENTS, accentsFor } from "@/lib/recall/accents";
import { folderSummary, libraryStats, relTime, subtreeIds, type FolderSummary } from "@/lib/recall/folderStats";
import { getPhotos, getQueue } from "@/lib/recall/photos/store";
import { coverage, getAccounts } from "@/lib/dashboard/driveBackup/accounts";
import { FolderIcon } from "./FolderDialog";

// ---------------------------------------------------------------------------
// Home — "Richer cards" (picked from three mockups, Nov 25 2026).
// The same grid of folders, but each card says what is inside it: how many
// notes, files, logins and links (everything nested under it, any depth), its
// first sub-folders as chips you can jump into, and when something inside
// last changed. When a Google account is connected for backups, a folder with
// items not on Drive says so instead.
// ---------------------------------------------------------------------------

interface Props {
  data: RecallData;
  onOpen: (folderId: string | null) => void;
  onNewFolder: () => void;
  onEditFolder: (folder: Folder) => void;
  onMoveFolder: (folder: Folder) => void;
  onDeleteFolder: (folder: Folder) => void;
  /** Opens the loose-items view when something sits outside every folder. */
  onOpenUnfiled: () => void;
  /** Switches to the Photos tab — the camera roll has its own surface. */
  onOpenPhotos: () => void;
}

const MAX_CHIPS = 4;

function Stats({ s }: { s: FolderSummary }) {
  if (s.total === 0) return <p className="mt-2.5 text-[11px] text-ink-faint">Empty so far</p>;
  return (
    <p className="mt-2.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px] text-ink-muted">
      {s.kinds.slice(0, 4).map((k) => (
        <span key={k.bucket}>
          <b className="mr-0.5 font-semibold tabular-nums text-ink">{k.count}</b>
          {k.count === 1 ? k.bucket.replace(/s$/, "") : k.bucket}
        </span>
      ))}
    </p>
  );
}

export function FolderHome({
  data,
  onOpen,
  onNewFolder,
  onEditFolder,
  onMoveFolder,
  onDeleteFolder,
  onOpenUnfiled,
  onOpenPhotos,
}: Props) {
  const allRoots = useMemo(() => childFolders(data.folders, null), [data.folders]);
  /**
   * Photos is lifted out of the ordinary grid. It is the one folder that is
   * not just a container — it has a review queue, a people list and a backup —
   * so it gets its own warm tile that opens that surface rather than a folder
   * page, and it always leads.
   */
  const photosFolder = allRoots.find((f) => f.role === "photos" || f.name.toLowerCase() === "photos");
  const roots = allRoots.filter((f) => f.id !== photosFolder?.id);
  const unfiled = data.items.filter((i) => !i.folderId).length;
  const accents = useMemo(() => accentsFor(roots.map((f) => f.id), HOME_ACCENTS), [roots]);
  const summaries = useMemo(
    () => new Map(allRoots.map((f) => [f.id, folderSummary(data.folders, data.items, f.id)])),
    [allRoots, data.folders, data.items],
  );
  const lib = useMemo(() => libraryStats(data.folders, data.items), [data.folders, data.items]);

  // Photos' own numbers (people, waiting for review) and Drive coverage live in
  // their own stores; read after mount so the server render matches.
  const [photoMeta, setPhotoMeta] = useState({ people: 0, review: 0 });
  const [missingByRoot, setMissingByRoot] = useState<Map<string, number> | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    setPhotoMeta({
      people: getPhotos().people.length,
      review: getQueue().filter((p) => p.status === "ready").length,
    });
    const { accounts } = getAccounts();
    if (!accounts.length) return setMissingByRoot(null);
    const missing = coverage(data.items, accounts).missing;
    const counts = new Map<string, number>();
    for (const f of allRoots) {
      const ids = subtreeIds(data.folders, f.id);
      counts.set(f.id, missing.filter((i) => i.folderId && ids.has(i.folderId)).length);
    }
    setMissingByRoot(counts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (roots.length === 0 && unfiled === 0 && !photosFolder) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-panel/40 px-6 py-20 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/15 text-brand">
          <Icon.Folder width={22} height={22} />
        </div>
        <h2 className="text-base font-semibold text-ink">Start with a folder</h2>
        <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-ink-muted">
          Name it after something real — a project, a market, a client. Open it and it holds
          sub-folders, notes, to-dos, links &amp; files, logins and websites.
        </p>
        <button
          onClick={onNewFolder}
          className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-2"
        >
          <Icon.Plus width={16} height={16} /> Create your first folder
        </button>
      </div>
    );
  }

  const footer = (f: Folder, s: FolderSummary) => {
    const missing = missingByRoot?.get(f.id) ?? 0;
    if (missing > 0)
      return (
        <>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
          {missing} {missing === 1 ? "item" : "items"} not backed up
        </>
      );
    return (
      <>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
        <span className="truncate">
          {s.updatedAt && now ? `Updated ${relTime(s.updatedAt, now)}` : "Updated"}
          {s.latest ? ` · ${s.latest.title}` : ""}
        </span>
      </>
    );
  };

  const chips = (subs: Folder[], onPick: (id: string) => void) =>
    subs.length > 0 && (
      <div className="pointer-events-auto relative z-10 mt-2.5 flex flex-wrap gap-1.5">
        {subs.slice(0, MAX_CHIPS).map((sf) => (
          <button
            key={sf.id}
            onClick={() => onPick(sf.id)}
            className="max-w-[150px] truncate rounded-md border border-[#1a2536] bg-[#0d1320] px-2 py-0.5 text-[10.5px] text-ink-muted transition hover:border-brand/50 hover:text-ink"
            title={`Open ${sf.name}`}
          >
            {sf.name}
          </button>
        ))}
        {subs.length > MAX_CHIPS && (
          <span className="px-1 py-0.5 text-[10.5px] text-ink-faint">+{subs.length - MAX_CHIPS}</span>
        )}
      </div>
    );

  const card = "relative flex min-h-[158px] flex-col rounded-[14px] border p-4 text-left transition";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <div>
          <p className="font-mono text-[10.5px] text-ink-faint">All</p>
          <h1 className="text-xl font-bold tracking-tight text-ink">All folders</h1>
        </div>
        <p className="ml-auto text-[11px] tabular-nums text-ink-faint">
          {lib.items} {lib.items === 1 ? "item" : "items"} · {lib.folders} {lib.folders === 1 ? "folder" : "folders"}
          {lib.depth > 1 ? ` · ${lib.depth} levels deep` : ""}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {photosFolder && (
          <div
            className={
              card +
              " border-amber-400/40 bg-gradient-to-br from-amber-500/25 via-amber-500/[0.07] to-transparent hover:border-amber-300/60"
            }
          >
            <button onClick={onOpenPhotos} className="absolute inset-0 rounded-[14px]" aria-label="Open Photos" />
            <div className="pointer-events-none flex items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-amber-500/20 text-amber-200">
                <Icon.Image width={16} height={16} />
              </span>
              <p className="truncate text-[14px] font-bold tracking-tight text-ink">Photos</p>
              <span className="ml-auto shrink-0 text-[10.5px] text-ink-faint">sorted by who&apos;s in them</span>
            </div>
            <p className="pointer-events-none mt-2.5 flex flex-wrap gap-x-2.5 text-[11px] text-ink-muted">
              <span>
                <b className="mr-0.5 font-semibold tabular-nums text-ink">{summaries.get(photosFolder.id)?.total ?? 0}</b>
                photos
              </span>
              {photoMeta.people > 0 && (
                <span>
                  <b className="mr-0.5 font-semibold tabular-nums text-ink">{photoMeta.people}</b>
                  {photoMeta.people === 1 ? "person" : "people"}
                </span>
              )}
              {photoMeta.review > 0 && (
                <span>
                  <b className="mr-0.5 font-semibold tabular-nums text-ink">{photoMeta.review}</b>
                  to review
                </span>
              )}
            </p>
            {chips(summaries.get(photosFolder.id)?.subs ?? [], (id) => onOpen(id))}
            <p className="pointer-events-none mt-auto flex items-center gap-1.5 pt-3 text-[10.5px] text-ink-faint">
              {footer(photosFolder, summaries.get(photosFolder.id)!)}
            </p>
          </div>
        )}

        {roots.map((f, i) => {
          const a = accents[i];
          const s = summaries.get(f.id)!;
          return (
            <div
              key={f.id}
              className={card + " group/tile border-line bg-gradient-to-br from-panel-2 to-panel hover:border-brand/50"}
            >
              <button onClick={() => onOpen(f.id)} className="absolute inset-0 rounded-[14px]" aria-label={`Open ${f.name}`} />
              <div className="pointer-events-none flex items-center gap-2.5">
                <span className={"flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] " + (a.soft ?? "bg-panel-2")}>
                  <FolderIcon name={f.icon} width={16} height={16} className={a.ink} />
                </span>
                <p className="truncate text-[14px] font-bold tracking-tight text-ink">{f.name}</p>
                <span className="ml-auto shrink-0 text-[10.5px] text-ink-faint transition group-hover/tile:opacity-0">
                  {s.subs.length
                    ? `${s.subs.length} sub-${s.subs.length === 1 ? "folder" : "folders"}`
                    : "no sub-folders"}
                </span>
              </div>
              {f.description && (
                <p className="pointer-events-none mt-1.5 line-clamp-1 text-[11px] text-ink-muted">{f.description}</p>
              )}
              <div className="pointer-events-none">
                <Stats s={s} />
              </div>
              {chips(s.subs, (id) => onOpen(id))}
              <p className="pointer-events-none mt-auto flex min-w-0 items-center gap-1.5 pt-3 text-[10.5px] text-ink-faint">
                {footer(f, s)}
              </p>
              <div className="absolute right-2.5 top-2.5 z-10 flex gap-0.5 opacity-0 transition group-hover/tile:opacity-100 focus-within:opacity-100">
                <button
                  onClick={() => onEditFolder(f)}
                  title="Edit folder"
                  aria-label={`Edit ${f.name}`}
                  className="rounded-md bg-canvas/80 p-1.5 text-ink-faint backdrop-blur hover:text-ink"
                >
                  <Icon.Edit width={13} height={13} />
                </button>
                <button
                  onClick={() => onMoveFolder(f)}
                  title="Move folder"
                  aria-label={`Move ${f.name}`}
                  className="rounded-md bg-canvas/80 p-1.5 text-ink-faint backdrop-blur hover:text-ink"
                >
                  <Icon.Move width={13} height={13} />
                </button>
                <button
                  onClick={() => onDeleteFolder(f)}
                  title="Delete folder"
                  aria-label={`Delete ${f.name}`}
                  className="rounded-md bg-canvas/80 p-1.5 text-ink-faint backdrop-blur hover:text-red-400"
                >
                  <Icon.Trash width={13} height={13} />
                </button>
              </div>
            </div>
          );
        })}

        {/* Only appears when something is genuinely loose — never a permanent tile */}
        {unfiled > 0 && (
          <button onClick={onOpenUnfiled} className={card + " border-line bg-panel/60 hover:border-brand/40"}>
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-panel-2 text-ink-faint">
                <Icon.Inbox width={16} height={16} />
              </span>
              <p className="text-[14px] font-bold tracking-tight text-ink">Unfiled</p>
            </div>
            <p className="mt-2.5 text-[11px] text-ink-muted">
              <b className="mr-0.5 font-semibold tabular-nums text-ink">{unfiled}</b>
              {unfiled === 1 ? "item" : "items"} captured but not in a folder yet
            </p>
            <p className="mt-auto pt-3 text-[10.5px] text-ink-faint">Ask Jarvis to file them</p>
          </button>
        )}

        <button
          onClick={onNewFolder}
          className="flex min-h-[158px] flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-line text-ink-faint transition hover:border-brand/50 hover:text-brand"
        >
          <Icon.Plus width={20} height={20} />
          <span className="text-xs font-medium">New folder</span>
        </button>
      </div>
    </div>
  );
}
