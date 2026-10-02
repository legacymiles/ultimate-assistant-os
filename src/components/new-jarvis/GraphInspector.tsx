"use client";

// ---------------------------------------------------------------------------
// What you are looking at.
//
// Three states, and the middle one is the reason this surface exists:
//
//   nothing selected   the notes the owner OWES themselves, ranked by how
//                      often they have reached for them
//   a note selected    its frontmatter, its excerpt, what links to it, and a
//                      door into Obsidian
//   a ghost selected   the invitation — write it now, from here
//
// The owed list is not a filler empty state. It is the most useful thing the
// graph produces, and putting it where the eye lands when nothing is selected
// means the owner sees it without asking.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import { Icon } from "../icons";
import { excerpt, parseFrontmatter } from "@/lib/jarvis/vault/parse";
import { backlinks, GHOST_PREFIX, owedNotes } from "@/lib/jarvis/vault/resolve";
import { GHOST_COLOR, SOURCE_COLOR } from "@/lib/jarvis/graph/palette";
import type { VaultGraph, VaultNode } from "@/lib/jarvis/graph/types";

interface Props {
  graph: VaultGraph;
  /** The raw markdown of the selected note, when the index has it. */
  body?: string;
  selected: VaultNode | null;
  onSelect: (key: string | null) => void;
  onWriteGhost: (node: VaultNode) => void;
  /** The vault's folder on disk, for an obsidian:// link. */
  root: string;
}

/** `obsidian://open?vault=…&file=…` — opens the real note in the real app. */
function obsidianHref(root: string, path: string): string | null {
  const vault = root.split(/[/\\]/).filter(Boolean).pop();
  if (!vault) return null;
  return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(path.replace(/\.md$/i, ""))}`;
}

export function GraphInspector({ graph, body, selected, onSelect, onWriteGhost, root }: Props) {
  const owed = useMemo(() => owedNotes(graph, 2).slice(0, 8), [graph]);
  const links = useMemo(() => (selected ? backlinks(graph, selected.key) : []), [graph, selected]);
  const byKey = useMemo(() => new Map(graph.nodes.map((n) => [n.key, n])), [graph.nodes]);

  const parsed = useMemo(() => (body ? parseFrontmatter(body) : null), [body]);

  // --- nothing selected: what the brain is waiting for --------------------
  if (!selected) {
    return (
      <div className="space-y-3 p-3">
        <header>
          <h3 className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">Notes you owe yourself</h3>
          <p className="mt-1 text-[10.5px] leading-relaxed text-ink-muted">
            Names you keep linking to and have never written. Click one on the graph to write it.
          </p>
        </header>

        {owed.length === 0 ? (
          <p className="text-[11px] leading-relaxed text-ink-faint">
            Nothing outstanding — every link in your vault lands on a note that exists.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {owed.map((g) => {
              const node = byKey.get(g.key);
              return (
                <li key={g.key}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(g.key);
                      if (node) onWriteGhost(node);
                    }}
                    className="group flex w-full items-baseline gap-2 rounded px-1 py-1 text-left transition hover:bg-panel-2"
                  >
                    <span
                      className="mt-1 size-1.5 shrink-0 rounded-full border"
                      style={{ borderColor: GHOST_COLOR }}
                      aria-hidden
                    />
                    <span className="flex-1 truncate text-[11.5px] text-ink">{g.title}</span>
                    <span
                      className="shrink-0 font-mono text-[10px] text-ink-faint"
                      data-num
                      title={`Linked to from ${g.referrers} notes`}
                    >
                      ×{g.referrers}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {graph.ambiguous.length > 0 && (
          <div className="border-t border-line-soft pt-2.5">
            <h3 className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">Links that were guessed</h3>
            <p className="mt-1 text-[10.5px] leading-relaxed text-ink-muted">
              These matched more than one note, so one was picked by a rule rather than by you.
            </p>
            <ul className="mt-1.5 space-y-1">
              {graph.ambiguous.slice(0, 4).map((a, i) => (
                <li key={`${a.from}-${a.target}-${i}`} className="font-mono text-[10px] leading-relaxed text-ink-faint">
                  <span className="text-ink-muted">[[{a.target}]]</span> → {a.chose}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  // --- a ghost: the invitation -------------------------------------------
  if (selected.kind === "ghost") {
    const referrers = links.length;
    return (
      <div className="space-y-3 p-3">
        <Head onClear={() => onSelect(null)} />
        <div>
          <span
            className="inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.12em]"
            style={{ borderColor: GHOST_COLOR, color: GHOST_COLOR }}
          >
            Not written yet
          </span>
          <h2 className="mt-2 text-[15px] font-semibold leading-tight text-ink">{selected.title}</h2>
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-muted">
            {referrers === 0
              ? "Linked to from somewhere in your vault, but the note does not exist."
              : `${referrers} ${referrers === 1 ? "note links" : "notes link"} to this and there is nothing behind it.`}
          </p>
        </div>

        <button
          type="button"
          onClick={() => onWriteGhost(selected)}
          className="w-full rounded-md border border-line bg-panel-2 px-2.5 py-2 text-left text-[11.5px] text-ink transition hover:border-ink-faint hover:bg-elevated"
        >
          <span className="flex items-center gap-1.5 font-medium">
            <Icon.Edit width={11} height={11} aria-hidden />
            Write it now
          </span>
          <span className="mt-0.5 block text-[10.5px] text-ink-muted">
            Every link pointing here starts working the moment it exists.
          </span>
        </button>

        {referrers > 0 && <Backlinks keys={links} byKey={byKey} onSelect={onSelect} />}
      </div>
    );
  }

  // --- a real note --------------------------------------------------------
  const path = selected.path ?? selected.key;
  const href = obsidianHref(root, path);
  const front = parsed?.frontmatter ?? {};
  const frontRows = Object.entries(front)
    .filter(([k]) => !["title"].includes(k))
    .slice(0, 8);

  return (
    <div className="space-y-3 p-3">
      <Head onClear={() => onSelect(null)} />

      <div>
        <div className="flex items-center gap-1.5">
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{ background: selected.kind === "tag" ? "#b8c75e" : SOURCE_COLOR[selected.source] }}
            aria-hidden
          />
          <span className="truncate font-mono text-[10px] text-ink-faint" title={path}>
            {path}
          </span>
        </div>
        <h2 className="mt-1.5 text-[15px] font-semibold leading-tight text-ink">{selected.title}</h2>
      </div>

      {parsed && excerpt(parsed.body) && (
        <p className="text-[11.5px] leading-relaxed text-ink-muted">{excerpt(parsed.body, 320)}</p>
      )}

      {frontRows.length > 0 && (
        <dl className="space-y-0.5 border-t border-line-soft pt-2.5">
          {frontRows.map(([key, value]) => (
            <div key={key} className="flex gap-2 text-[10.5px]">
              <dt className="w-24 shrink-0 truncate font-mono text-ink-faint">{key}</dt>
              <dd className="min-w-0 flex-1 break-words text-ink-muted">
                {Array.isArray(value) ? value.join(", ") : value || "—"}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {selected.tags.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {selected.tags.slice(0, 12).map((tag) => (
            <li
              key={tag}
              className="rounded border border-line-soft px-1.5 py-0.5 font-mono text-[9.5px] text-ink-faint"
            >
              #{tag}
            </li>
          ))}
        </ul>
      )}

      <Outgoing keys={selected.links} byKey={byKey} onSelect={onSelect} />
      <Backlinks keys={links} byKey={byKey} onSelect={onSelect} />

      {href && (
        <a
          href={href}
          className="inline-flex items-center gap-1.5 rounded border border-line px-2 py-1 text-[10.5px] text-ink-muted transition hover:bg-panel-2 hover:text-ink"
        >
          <Icon.Launch width={10} height={10} aria-hidden />
          Open in Obsidian
        </a>
      )}
    </div>
  );
}

function Head({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">Selected</h3>
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear the selection"
        className="rounded p-0.5 text-ink-faint transition hover:text-ink"
      >
        <Icon.Close width={10} height={10} />
      </button>
    </div>
  );
}

/** A list of node keys as clickable rows, used for both directions of a link. */
function LinkList({
  title,
  keys,
  byKey,
  onSelect,
  empty,
}: {
  title: string;
  keys: string[];
  byKey: Map<string, VaultNode>;
  onSelect: (key: string) => void;
  empty: string;
}) {
  return (
    <div className="border-t border-line-soft pt-2.5">
      <h3 className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">
        {title} <span className="font-mono text-ink-faint" data-num>{keys.length}</span>
      </h3>
      {keys.length === 0 ? (
        <p className="mt-1 text-[10.5px] text-ink-faint">{empty}</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {keys.slice(0, 12).map((key) => {
            const node = byKey.get(key);
            const ghost = key.startsWith(GHOST_PREFIX);
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => onSelect(key)}
                  className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left transition hover:bg-panel-2"
                >
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${ghost ? "border" : ""}`}
                    style={ghost ? { borderColor: GHOST_COLOR } : { background: SOURCE_COLOR[node?.source ?? "vault"] }}
                    aria-hidden
                  />
                  <span className="flex-1 truncate text-[11px] text-ink-muted">{node?.title ?? key}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Outgoing(props: { keys: string[]; byKey: Map<string, VaultNode>; onSelect: (key: string) => void }) {
  return <LinkList title="Links out" empty="This note points at nothing." {...props} />;
}

function Backlinks(props: { keys: string[]; byKey: Map<string, VaultNode>; onSelect: (key: string) => void }) {
  return (
    <LinkList
      title="Linked from"
      empty="Nothing points here — you can only find this note by remembering the words in it."
      {...props}
    />
  );
}
