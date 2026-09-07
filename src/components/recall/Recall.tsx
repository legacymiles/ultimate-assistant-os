"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import {
  createFolder,
  deleteFolder,
  migrateRecords,
  getData,
  isLocal,
  updateFolder,
} from "@/lib/recall/store";
import * as vault from "@/lib/recall/vault";
import type { Folder, Item, RecallData } from "@/lib/recall/types";
import { ALL, FolderTree, UNFILED } from "./FolderTree";
import { CaptureModal } from "./CaptureModal";
import { ItemDetailModal } from "./ItemDetailModal";
import { AgentChat } from "./AgentChat";
import { FolderWorkspace } from "./FolderWorkspace";
import { SearchResults } from "./SearchResults";
import { useVault } from "./LoginsSection";
import { FolderDialog, type FolderDraft } from "./FolderDialog";
import { FolderHome } from "./FolderHome";
import { SecurityDialog } from "./SecurityDialog";
import { ListsBoard } from "./lists/ListsBoard";
import { PhotosBoard } from "./photos/PhotosBoard";
import { CalendarBoard } from "./calendar/CalendarBoard";
import { ensurePhotosRoot } from "@/lib/recall/store";
import { pruneOrphans } from "@/lib/recall/files";
import { KEY as RECALL_KEY } from "@/lib/recall/store";
import { useRemotePull } from "@/lib/sync/useSync";

// ---------------------------------------------------------------------------
// Recall — shell.
// One search box over everything, a breadcrumb, and the folder workspace.
// The folder tree still exists but it is a toggle, not permanent furniture:
// sub-folders live as tiles inside the folder they belong to, so the page stays
// minimal however deep the structure goes.
// ---------------------------------------------------------------------------

const HOME_TABS = [
  { id: "folders" as const, label: "Folders", icon: Icon.Folder },
  { id: "photos" as const, label: "Photos", icon: Icon.Image },
  { id: "calendar" as const, label: "Calendar", icon: Icon.Calendar },
  { id: "lists" as const, label: "Lists", icon: Icon.ListChecks },
];

type HomeTab = (typeof HOME_TABS)[number]["id"];

/** Create a new folder under `parentId`, or edit an existing one. */
type FolderDialogState =
  | { mode: "create"; parentId: string | null }
  | { mode: "edit"; folder: Folder };

export function Recall() {
  const [data, setData] = useState<RecallData>({ folders: [], items: [] });
  const [ready, setReady] = useState(false);
  /** null = the home grid; UNFILED = loose items; otherwise a folder id. */
  const [folderId, setFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<Item | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [askQuestion, setAskQuestion] = useState<string | null>(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [folderDialog, setFolderDialog] = useState<FolderDialogState | null>(null);
  /** True when Recall requires a password, so signing out is meaningful. */
  const [gated, setGated] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  /**
   * The home page has two halves. Folders hold what you keep; Lists holds what
   * the household is doing this week. Only the home view is tabbed — opening a
   * folder or searching leaves the switch behind, because neither means
   * anything on the Lists side.
   */
  const [homeTab, setHomeTab] = useState<HomeTab>("folders");
  /**
   * The calendar, the people list and the folder tree are three separate
   * stores. When the assistant writes to one of the other two, bumping its
   * nonce remounts that board so it re-reads instead of showing stale data.
   */
  const [calendarNonce, setCalendarNonce] = useState(0);
  const [photosNonce, setPhotosNonce] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const { exists: vaultExists, unlocked: vaultUnlocked } = useVault();

  useEffect(() => {
    // Fold any legacy server/site records into websites, then read.
    migrateRecords();
    // The camera roll needs somewhere to live before the first photo arrives,
    // so the Photos root is created on first load rather than on first import.
    ensurePhotosRoot();
    const fresh = getData();
    setData(fresh);
    setReady(true);
    // Sweep blobs whose item was deleted some other way (agent, folder purge).
    const referenced = new Set(
      fresh.items.map((i) => i.attachment?.fileId).filter(Boolean) as string[],
    );
    void pruneOrphans(referenced).catch(() => {
      /* IndexedDB unavailable — nothing to sweep */
    });
  }, []);

  // Folders and items captured on another device land in localStorage first,
  // then here. migrateRecords runs again so anything pulled down in an older
  // shape is folded forward before it is read.
  useRemotePull(RECALL_KEY, () => {
    migrateRecords();
    setData(getData());
  });

  useEffect(() => {
    fetch("/api/recall-unlock")
      .then((r) => r.json())
      .then((d: { gated?: boolean }) => setGated(Boolean(d.gated)))
      .catch(() => setGated(false));
  }, []);

  async function signOut() {
    // Lock the vault first so no decrypted secret survives the redirect.
    vault.lock();
    await fetch("/api/recall-unlock", { method: "DELETE" });
    window.location.href = "/recall-unlock";
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
      if (e.key === "Escape" && document.activeElement === searchRef.current) {
        setQuery("");
        searchRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const navigate = useCallback((id: string | null) => {
    setFolderId(id);
    setQuery("");
    setTreeOpen(false);
    window.scrollTo({ top: 0 });
  }, []);

  const existingTags = useMemo(() => {
    const set = new Set<string>();
    for (const it of data.items) for (const t of it.tags) set.add(t);
    return [...set];
  }, [data]);

  const toggleTag = (t: string) =>
    setActiveTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  function handleNewFolder(parentId: string | null) {
    setFolderDialog({ mode: "create", parentId });
  }

  function handleEditFolder(folder: Folder) {
    setFolderDialog({ mode: "edit", folder });
  }

  function submitFolder(draft: FolderDraft) {
    if (!folderDialog) return;
    if (folderDialog.mode === "create") {
      setData(createFolder(draft, folderDialog.parentId).data);
      setToast("Folder created");
    } else {
      setData(updateFolder(folderDialog.folder.id, draft));
      setToast("Folder updated");
    }
  }

  function handleDeleteFolder(folder: Folder) {
    const msg = `Delete “${folder.name}”? Anything inside moves up to the parent — nothing is lost.`;
    if (!window.confirm(msg)) return;
    setData(deleteFolder(folder.id));
    if (folderId === folder.id) setFolderId(folder.parentId);
    setToast("Folder deleted");
  }

  const searching = query.trim().length > 0;

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-line bg-panel/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-3 py-2.5 sm:px-5">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
            aria-label="Back to hub"
          >
            <Icon.ArrowLeft width={14} height={14} />
            <span className="hidden sm:inline">Hub</span>
          </Link>

          <button
            onClick={() => setTreeOpen((v) => !v)}
            aria-label="Toggle folder tree"
            title="Folder tree"
            className={
              "rounded-lg border p-1.5 transition " +
              (treeOpen
                ? "border-brand/50 bg-brand/10 text-brand"
                : "border-line text-ink-muted hover:text-ink")
            }
          >
            <Icon.Sidebar width={15} height={15} />
          </button>

          <span className="ml-0.5 hidden items-center gap-1.5 text-sm font-semibold text-ink sm:flex">
            <Icon.Sparkles width={16} height={16} className="text-brand" /> Recall
          </span>
          {isLocal() && (
            <span className="hidden rounded-md bg-brand/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand lg:inline">
              Local
            </span>
          )}

          {/* One search box over everything */}
          <div className="relative ml-1 min-w-0 flex-1">
            <Icon.Search
              width={15}
              height={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
            />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search everything — notes, files, logins, websites…  (⌘K)"
              className="w-full rounded-xl border border-line bg-canvas py-2 pl-9 pr-8 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/25"
            />
            {searching && (
              <button
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-faint hover:text-ink"
              >
                <Icon.Close width={13} height={13} />
              </button>
            )}
          </div>

          {vaultExists && (
            <button
              onClick={() => {
                if (vaultUnlocked) {
                  vault.lock();
                  setToast("Vault locked");
                }
              }}
              title={vaultUnlocked ? "Vault unlocked — click to lock" : "Vault locked"}
              aria-label={vaultUnlocked ? "Lock vault" : "Vault locked"}
              className={
                "shrink-0 rounded-lg border p-1.5 transition " +
                (vaultUnlocked
                  ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20"
                  : "border-line text-ink-faint")
              }
            >
              {vaultUnlocked ? <Icon.Unlock width={15} height={15} /> : <Icon.Lock width={15} height={15} />}
            </button>
          )}

          <button
            onClick={() => setSecurityOpen(true)}
            title="Security — app password and vault master password"
            aria-label="Security settings"
            className="shrink-0 rounded-lg border border-line p-1.5 text-ink-muted transition hover:text-ink"
          >
            <Icon.Shield width={15} height={15} />
          </button>

          {gated && (
            <button
              onClick={() => void signOut()}
              title="Sign out of Recall"
              aria-label="Sign out of Recall"
              className="shrink-0 rounded-lg border border-line p-1.5 text-ink-muted transition hover:border-red-500/40 hover:text-red-400"
            >
              <Icon.ArrowRight width={15} height={15} />
            </button>
          )}

          <button
            onClick={() => setCaptureOpen(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-brand px-3 py-2 text-[13px] font-semibold text-white transition hover:bg-brand-2"
            title="Capture anything — Recall files and tags it for you"
          >
            <Icon.Plus width={15} height={15} />
            <span className="hidden sm:inline">Capture</span>
          </button>
        </div>

        {/* Folder tree — a drawer, not permanent furniture */}
        {treeOpen && (
          <div className="border-t border-line bg-panel">
            <div className="mx-auto max-h-[50vh] w-full max-w-5xl overflow-y-auto px-3 py-3 sm:px-5">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                  All folders
                </span>
                <button
                  onClick={() => handleNewFolder(null)}
                  className="rounded-md p-1 text-ink-faint hover:bg-panel-2 hover:text-ink"
                  title="New top-level folder"
                >
                  <Icon.Plus width={14} height={14} />
                </button>
              </div>
              <FolderTree
                folders={data.folders}
                items={data.items}
                selected={folderId ?? ALL}
                onSelect={(id) => navigate(id === ALL ? null : id)}
                onDelete={handleDeleteFolder}
              />
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-3 py-5 sm:px-5">
        {activeTags.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-ink-faint">Filtered by</span>
            {activeTags.map((t) => (
              <button
                key={t}
                onClick={() => toggleTag(t)}
                className="inline-flex items-center gap-1 rounded-full border border-brand bg-brand/15 px-2 py-0.5 text-[11px] font-medium text-brand"
              >
                <Icon.Tag width={10} height={10} /> {t}
                <Icon.Close width={10} height={10} />
              </button>
            ))}
            <button
              onClick={() => setActiveTags([])}
              className="text-[11px] text-ink-faint hover:text-ink"
            >
              Clear
            </button>
          </div>
        )}

        {!ready ? (
          <p className="py-16 text-center text-sm text-ink-muted">Loading…</p>
        ) : searching ? (
          <SearchResults
            query={query}
            data={data}
            activeTags={activeTags}
            onToggleTag={toggleTag}
            onNavigate={navigate}
            onOpenItem={setDetailItem}
          />
        ) : folderId === null ? (
          <>
            <div
              role="tablist"
              aria-label="Recall home"
              className="mb-4 inline-flex gap-1 rounded-xl border border-line bg-panel p-1"
            >
              {HOME_TABS.map((tab) => (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={homeTab === tab.id}
                  onClick={() => setHomeTab(tab.id)}
                  className={
                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition " +
                    (homeTab === tab.id
                      ? "bg-brand text-white"
                      : "text-ink-muted hover:bg-panel-2 hover:text-ink")
                  }
                >
                  <tab.icon width={14} height={14} />
                  {tab.label}
                </button>
              ))}
            </div>

            {homeTab === "folders" && (
              <FolderHome
                data={data}
                onOpen={navigate}
                onNewFolder={() => handleNewFolder(null)}
                onEditFolder={handleEditFolder}
                onDeleteFolder={handleDeleteFolder}
                onOpenUnfiled={() => navigate(UNFILED)}
                onOpenPhotos={() => setHomeTab("photos")}
              />
            )}
            {homeTab === "photos" && (
              <PhotosBoard
                key={photosNonce}
                data={data}
                onNavigate={navigate}
                onData={setData}
                onToast={setToast}
                onOpenItem={setDetailItem}
                onCalendarChanged={() => setCalendarNonce((n) => n + 1)}
              />
            )}
            {homeTab === "calendar" && (
              <CalendarBoard
                key={calendarNonce}
                onToast={setToast}
                onOpenItem={(id) => {
                  const it = data.items.find((x) => x.id === id);
                  if (it) setDetailItem(it);
                }}
              />
            )}
            {homeTab === "lists" && <ListsBoard />}
          </>
        ) : (
          <FolderWorkspace
            data={data}
            folderId={folderId === UNFILED ? null : folderId}
            isUnfiled={folderId === UNFILED}
            onNavigate={navigate}
            onData={setData}
            onToast={setToast}
            onOpenItem={setDetailItem}
            onNewFolder={handleNewFolder}
            onDeleteFolder={handleDeleteFolder}
            onRenameFolder={handleEditFolder}
          />
        )}
      </main>

      {/* Agent */}
      <AgentChat
        open={agentOpen}
        onOpen={() => setAgentOpen(true)}
        onClose={() => setAgentOpen(false)}
        data={data}
        onData={(d) => {
          setData(d);
          setToast("Done");
        }}
        onOpenItem={(it) => {
          setAgentOpen(false);
          setDetailItem(it);
        }}
        ask={askQuestion}
        onAskConsumed={() => setAskQuestion(null)}
        onCalendarChanged={() => setCalendarNonce((n) => n + 1)}
        onPhotosChanged={() => setPhotosNonce((n) => n + 1)}
      />

      {securityOpen && (
        <SecurityDialog
          onClose={() => setSecurityOpen(false)}
          onData={setData}
          onToast={setToast}
        />
      )}

      {folderDialog && (
        <FolderDialog
          title={
            folderDialog.mode === "edit"
              ? "Edit folder"
              : folderDialog.parentId
                ? "New sub-folder"
                : "New folder"
          }
          confirmLabel={folderDialog.mode === "edit" ? "Save" : "Create"}
          initial={folderDialog.mode === "edit" ? folderDialog.folder : undefined}
          onSubmit={submitFolder}
          onClose={() => setFolderDialog(null)}
        />
      )}

      {toast && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-elevated px-4 py-2 text-xs font-medium text-ink shadow-lg">
          {toast}
        </div>
      )}

      {captureOpen && (
        <CaptureModal
          folders={data.folders}
          existingTags={existingTags}
          onClose={() => setCaptureOpen(false)}
          onSaved={(d, count) => {
            setData(d);
            setCaptureOpen(false);
            setToast(count > 1 ? `Saved ${count} items` : "Saved");
          }}
        />
      )}
      {detailItem && (
        <ItemDetailModal
          item={data.items.find((i) => i.id === detailItem.id) ?? detailItem}
          folders={data.folders}
          onClose={() => setDetailItem(null)}
          onChange={setData}
          onDeleted={(d) => {
            setData(d);
            setDetailItem(null);
            setToast("Deleted");
          }}
          onAsk={(it) => {
            setDetailItem(null);
            setAskQuestion(it.title);
          }}
        />
      )}
    </div>
  );
}
