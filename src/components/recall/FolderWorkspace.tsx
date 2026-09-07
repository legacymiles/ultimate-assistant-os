"use client";

import { useMemo, useState } from "react";
import { Icon } from "../icons";
import {
  addFolderSection,
  childFolders,
  descendantFolderIds,
  removeFolderSection,
} from "@/lib/recall/store";
import { SECTION_OF, SECTION_ORDER } from "@/lib/recall/types";
import type { Folder, Item, RecallData, SectionId } from "@/lib/recall/types";
import { Section } from "./Section";
import { SubfolderGrid } from "./SubfolderGrid";
import { NotesBody, TodosBody } from "./SimpleSections";
import { LinksBody } from "./LinksSection";
import { LoginsBody } from "./LoginsSection";
import { WebsitesBody } from "./WebsitesSection";
import { AddSectionMenu, type SectionChoice } from "./AddSectionMenu";

// ---------------------------------------------------------------------------
// A folder is a page, not a filter.
//
// A new folder starts with NO sections. You add the ones you want from a single
// + menu, so a folder that only ever holds logins is three lines tall, and a
// section you never asked for is never in your way.
//
// Two rules stop that from losing anything:
//   · a section holding items is always rendered, listed or not
//   · a section can only be removed while it is empty
// ---------------------------------------------------------------------------

interface SectionMeta {
  label: string;
  icon: typeof Icon.File;
  blurb: string;
  emptyHint: string;
  addLabel: string;
}

const SECTION_META: Record<SectionId, SectionMeta> = {
  subfolders: {
    label: "Sub-Folders",
    icon: Icon.Grid,
    blurb: "Nest folders inside this one",
    emptyHint: "No sub-folders yet. Click + to add one.",
    addLabel: "New sub-folder",
  },
  notes: {
    label: "Notes & Ideas",
    icon: Icon.File,
    blurb: "Write things down",
    emptyHint: "No notes yet. Click + to add one.",
    addLabel: "New note",
  },
  todos: {
    label: "To-Do List",
    icon: Icon.Check2,
    blurb: "Tasks with checkboxes",
    emptyHint: "No tasks yet. Click + to add one.",
    addLabel: "New task",
  },
  links: {
    label: "Links & Resources",
    icon: Icon.Link,
    blurb: "URLs and files — PDFs, docs, images, video",
    emptyHint: "No links yet. Click + to add one.",
    addLabel: "New link or file",
  },
  logins: {
    label: "Logins & Passwords",
    icon: Icon.Key,
    blurb: "Usernames and encrypted passwords",
    emptyHint: "No logins yet. Click + to add one.",
    addLabel: "New login",
  },
  websites: {
    label: "Websites",
    icon: Icon.Globe,
    blurb: "Sites and services, with their details",
    emptyHint: "No websites yet. Click + to add one.",
    addLabel: "New website",
  },
};

interface Props {
  data: RecallData;
  /** The folder being viewed; null together with `isUnfiled` = loose items. */
  folderId: string | null;
  /** Loose-items view: no sub-folders, everything that sits outside a folder. */
  isUnfiled?: boolean;
  onNavigate: (folderId: string | null) => void;
  onData: (d: RecallData) => void;
  onToast: (m: string) => void;
  onOpenItem: (item: Item) => void;
  onNewFolder: (parentId: string | null) => void;
  onDeleteFolder: (folder: Folder) => void;
  onRenameFolder: (folder: Folder) => void;
}

export function FolderWorkspace({
  data,
  folderId,
  isUnfiled = false,
  onNavigate,
  onData,
  onToast,
  onOpenItem,
  onNewFolder,
  onDeleteFolder,
  onRenameFolder,
}: Props) {
  const [addingNote, setAddingNote] = useState(false);
  const [addingTodo, setAddingTodo] = useState(false);
  const [addingLink, setAddingLink] = useState(false);
  const [addingLogin, setAddingLogin] = useState(false);
  const [addingWebsite, setAddingWebsite] = useState(false);

  const here = folderId ? data.folders.find((f) => f.id === folderId) : null;
  const subfolders = useMemo(() => childFolders(data.folders, folderId), [data.folders, folderId]);

  /** Items sitting directly in this folder — children live in their own tiles. */
  const own = useMemo(
    () => data.items.filter((i) => (i.folderId ?? null) === folderId),
    [data.items, folderId],
  );

  const buckets = useMemo(() => {
    const b: Record<SectionId, Item[]> = {
      subfolders: [],
      notes: [],
      todos: [],
      links: [],
      logins: [],
      websites: [],
    };
    for (const it of own) b[SECTION_OF[it.kind] ?? "notes"].push(it);
    return b;
  }, [own]);

  /** How full a section is — sub-folders count tiles, the rest count items. */
  const countOf = (id: SectionId) => (id === "subfolders" ? subfolders.length : buckets[id].length);

  /**
   * The sections the user turned on, plus any section that holds something.
   * That second half is the safety net: no setting can hide your data.
   */
  const visible = useMemo(() => {
    const chosen = new Set<SectionId>(here?.sections ?? []);
    return SECTION_ORDER.filter((id) => {
      if (isUnfiled && id === "subfolders") return false;
      const n = id === "subfolders" ? subfolders.length : buckets[id].length;
      return chosen.has(id) || n > 0;
    });
  }, [here?.sections, subfolders.length, buckets, isUnfiled]);

  /**
   * Every section is always in the menu. One a folder already shows offers
   * "one more of these" instead of vanishing — the + is how you add a second
   * login, not just the first.
   */
  const choices: SectionChoice[] = SECTION_ORDER.filter(
    (id) => !(isUnfiled && id === "subfolders"),
  ).map((id) => ({ id, ...SECTION_META[id], present: visible.includes(id) }));

  function addSection(id: SectionId) {
    if (!folderId) return;
    onData(addFolderSection(folderId, id));
    onToast(`label added`);
  }

  /** Open the inline "new item" form of a section the folder already shows. */
  function startAdd(id: SectionId) {
    switch (id) {
      case "subfolders":
        return onNewFolder(folderId);
      case "notes":
        return setAddingNote(true);
      case "todos":
        return setAddingTodo(true);
      case "links":
        return setAddingLink(true);
      case "logins":
        return setAddingLogin(true);
      case "websites":
        return setAddingWebsite(true);
    }
  }

  function pick(id: SectionId, present: boolean) {
    if (present) startAdd(id);
    else addSection(id);
  }

  function dropSection(id: SectionId) {
    if (!folderId) return;
    onData(removeFolderSection(folderId, id));
  }

  const trail = useMemo(() => {
    const byId = new Map(data.folders.map((f) => [f.id, f]));
    const out: Folder[] = [];
    let cur = folderId ? byId.get(folderId) : undefined;
    const guard = new Set<string>();
    while (cur && !guard.has(cur.id)) {
      guard.add(cur.id);
      out.unshift(cur);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return out;
  }, [data.folders, folderId]);

  function renderSection(id: SectionId) {
    const meta = SECTION_META[id];
    const MetaIcon = meta.icon;
    const common = {
      id,
      label: meta.label,
      icon: <MetaIcon width={13} height={13} />,
      emptyHint: meta.emptyHint,
      addLabel: meta.addLabel,
      count: countOf(id),
      onRemove: folderId ? () => dropSection(id) : undefined,
    };

    switch (id) {
      case "subfolders":
        return (
          <Section key={id} {...common} onAdd={() => onNewFolder(folderId)}>
            <SubfolderGrid
              folders={subfolders}
              countFor={(fid) => {
                const ids = descendantFolderIds(data.folders, fid);
                return data.items.filter((i) => i.folderId && ids.has(i.folderId)).length;
              }}
              onOpen={onNavigate}
              onDelete={onDeleteFolder}
              onRename={onRenameFolder}
              onAdd={() => onNewFolder(folderId)}
            />
          </Section>
        );

      case "notes":
        return (
          <Section key={id} {...common} bodyOverride={addingNote} onAdd={() => setAddingNote(true)}>
            <NotesBody
              items={buckets.notes}
              folderId={folderId}
              adding={addingNote}
              onAddingChange={setAddingNote}
              onOpen={onOpenItem}
              onData={onData}
              onToast={onToast}
            />
          </Section>
        );

      case "todos":
        return (
          <Section
            key={id}
            {...common}
            bodyOverride={addingTodo}
            onAdd={() => setAddingTodo(true)}
            badge={
              buckets.todos.length > 0 ? (
                <span className="shrink-0 text-[10px] tabular-nums text-ink-faint">
                  {buckets.todos.filter((t) => t.done).length}/{buckets.todos.length} done
                </span>
              ) : undefined
            }
          >
            <TodosBody
              items={buckets.todos}
              folderId={folderId}
              adding={addingTodo}
              onAddingChange={setAddingTodo}
              onData={onData}
              onToast={onToast}
            />
          </Section>
        );

      case "links":
        return (
          <Section key={id} {...common} bodyOverride={addingLink} onAdd={() => setAddingLink(true)}>
            <LinksBody
              items={buckets.links}
              folderId={folderId}
              adding={addingLink}
              onAddingChange={setAddingLink}
              onOpen={onOpenItem}
              onData={onData}
              onToast={onToast}
            />
          </Section>
        );

      case "logins":
        return (
          <Section key={id} {...common} bodyOverride={addingLogin} onAdd={() => setAddingLogin(true)}>
            <LoginsBody
              items={buckets.logins}
              folderId={folderId}
              adding={addingLogin}
              onAddingChange={setAddingLogin}
              onData={onData}
              onToast={onToast}
            />
          </Section>
        );

      case "websites":
        return (
          <Section
            key={id}
            {...common}
            bodyOverride={addingWebsite}
            onAdd={() => setAddingWebsite(true)}
          >
            <WebsitesBody
              items={buckets.websites}
              folderId={folderId}
              adding={addingWebsite}
              onAddingChange={setAddingWebsite}
              onData={onData}
              onToast={onToast}
            />
          </Section>
        );
    }
  }

  return (
    <div>
      {/* Breadcrumb — the only navigation chrome, and it costs one line */}
      <nav className="mb-1 flex flex-wrap items-center gap-1 text-[11px] text-ink-faint">
        <button
          onClick={() => onNavigate(null)}
          className="rounded px-1 py-0.5 transition hover:bg-panel-2 hover:text-ink"
        >
          All
        </button>
        {isUnfiled && (
          <span className="flex items-center gap-1">
            <Icon.Chevron width={10} height={10} className="opacity-50" />
            <span className="px-1 py-0.5 text-ink">Unfiled</span>
          </span>
        )}
        {trail.map((f, i) => (
          <span key={f.id} className="flex items-center gap-1">
            <Icon.Chevron width={10} height={10} className="opacity-50" />
            <button
              onClick={() => onNavigate(f.id)}
              className={
                "rounded px-1 py-0.5 transition hover:bg-panel-2 hover:text-ink " +
                (i === trail.length - 1 ? "text-ink" : "")
              }
            >
              {f.name}
            </button>
          </span>
        ))}
      </nav>

      <div className="mb-4 flex items-center gap-2">
        <h1 className="text-xl font-bold tracking-tight text-ink">
          {isUnfiled ? "Unfiled" : (here?.name ?? "All")}
        </h1>
        {here && (
          <button
            onClick={() => onRenameFolder(here)}
            aria-label="Edit folder"
            title="Edit folder"
            className="rounded-md p-1 text-ink-faint transition hover:bg-panel-2 hover:text-ink"
          >
            <Icon.Edit width={13} height={13} />
          </button>
        )}
        <span className="ml-auto text-[11px] tabular-nums text-ink-faint">
          {own.length} here
          {!isUnfiled &&
            ` · ${subfolders.length} sub-${subfolders.length === 1 ? "folder" : "folders"}`}
        </span>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-panel/40 px-6 py-14 text-center">
          <p className="text-sm font-semibold text-ink">
            {here?.name ? `${here.name} is empty` : "Nothing here yet"}
          </p>
          <p className="mx-auto mb-5 mt-1.5 max-w-sm text-xs leading-relaxed text-ink-muted">
            Add only the sections this folder actually needs — sub-folders, notes, to-dos, links
            &amp; files, logins, websites. You can add more later, or drop the ones you stop using.
          </p>
          <div className="flex justify-center">
            <AddSectionMenu choices={choices} onPick={addSection} variant="block" />
          </div>
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-line bg-panel/40 px-4">
            {visible.map(renderSection)}
          </div>
          {choices.length > 0 && folderId && (
            <div className="mt-2 flex">
              <AddSectionMenu choices={choices} onPick={addSection} variant="inline" />
            </div>
          )}
        </>
      )}
    </div>
  );
}
