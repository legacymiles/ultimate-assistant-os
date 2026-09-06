"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { ContentBadge, MetaPill, TagPill, VERDICT_STYLE } from "./chips";
import { ACCESS_LABEL, CONTENT_LABEL, HOSTING_LABEL, groupHue, ratingOf } from "@/lib/ai-rankings/types";
import type {
  Access,
  ApiKey,
  BoardData,
  ContentRating,
  Feature,
  Hosting,
  Tool,
} from "@/lib/ai-rankings/types";
import type { Suggestion } from "@/lib/ai-rankings/classify";
import { featureKey } from "@/lib/ai-rankings/query";
import { formatDate } from "@/lib/utils";

interface Props {
  tool: Tool;
  data: BoardData;
  onPatch: (patch: Partial<Tool>) => void;
  onDelete: () => void;
  onClose: () => void;
  onAddFeature: (text: string, verdict: Feature["verdict"]) => void;
  onUpdateFeature: (featureId: string, patch: Partial<Omit<Feature, "id">>) => void;
  onDeleteFeature: (featureId: string) => void;
  onMove: (position: number) => void;
  onRank: () => void;
  onUnrank: () => void;
  onTag: (tag: string) => void;
  boardSize: number;
  /** Wording already used elsewhere, offered as autocomplete so it stays one word for one idea. */
  knownFeatures: string[];
}

export function DetailPanel(props: Props) {
  const { tool, data, onPatch, onClose, onDelete, onTag, boardSize, knownFeatures } = props;
  const hue = groupHue(tool.group);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [filing, setFiling] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [applied, setApplied] = useState(false);

  // A different record means the old confirmation and the old suggestion are
  // about a tool that is no longer on screen.
  useEffect(() => {
    setConfirmDelete(false);
    setSuggestion(null);
    setApplied(false);
  }, [tool.id]);

  const autoFile = async () => {
    setFiling(true);
    setSuggestion(null);
    setApplied(false);
    try {
      const res = await fetch("/api/ai-rankings/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: tool.name,
          url: tool.url,
          summary: tool.summary,
          notes: tool.notes,
          tree: data.tree,
          knownFeatures,
        }),
      });
      const json = (await res.json()) as Suggestion & { error?: string };
      if (!json.error) setSuggestion(json);
    } catch {
      /* the route never fails on purpose; a network drop just leaves it blank */
    } finally {
      setFiling(false);
    }
  };

  const applySuggestion = () => {
    if (!suggestion) return;
    onPatch({
      group: suggestion.group,
      category: suggestion.category,
      summary: suggestion.summary || tool.summary,
      tags: Array.from(new Set([...tool.tags, ...suggestion.tags])),
      access: suggestion.access,
      openSource: suggestion.openSource,
      hosting: suggestion.hosting,
      apiKey: suggestion.apiKey,
      pricingNote: suggestion.pricingNote || tool.pricingNote,
      // "unknown" from the classifier means it didn't know, not that the answer
      // is no — so it must not erase a rating you set by hand.
      contentRating:
        suggestion.contentRating === "unknown" ? tool.contentRating : suggestion.contentRating,
    });
    // The card stays open: the filing fields are applied in one go, but the
    // suggested features are accepted one at a time and would vanish with it.
    setApplied(true);
  };

  // Only offer features this record doesn't already have — the list should
  // shrink to nothing as you accept them.
  const pendingFeatures = (suggestion?.features ?? []).filter(
    (f) => !tool.features.some((x) => featureKey(x.text) === featureKey(f)),
  );

  return (
    <aside className="flex h-full flex-col bg-panel">
      {/* Header */}
      <div className="flex items-start gap-2 border-b border-line px-4 py-3">
        <span
          className="mt-1.5 h-3 w-1 shrink-0 rounded"
          style={{ background: `hsl(${hue} 70% 58%)` }}
        />
        <div className="min-w-0 flex-1">
          <InlineText
            value={tool.name}
            onCommit={(v) => v && onPatch({ name: v })}
            className="w-full bg-transparent text-base font-semibold text-ink outline-none"
            placeholder="Name"
          />
          <div className="mt-0.5 flex items-center gap-1.5">
            <ContentBadge tool={tool} />
            <InlineText
              value={tool.url}
              onCommit={(v) => onPatch({ url: v })}
              className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-ink-faint outline-none"
              placeholder="https://…"
            />
            {tool.url && (
              <a
                href={tool.url}
                target="_blank"
                rel="noreferrer noopener"
                className="shrink-0 text-ink-faint transition hover:text-ink"
                aria-label={`Open ${tool.name}`}
              >
                <Icon.Launch width={12} height={12} />
              </a>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded-lg p-1 text-ink-faint transition hover:bg-panel-2 hover:text-ink"
          aria-label="Close record"
        >
          <Icon.Close width={14} height={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* Filing */}
        <Row label="Filed under">
          <div className="flex gap-1.5">
            <Picker
              value={tool.group}
              options={Object.keys(data.tree)}
              onChange={(group) => onPatch({ group, rank: undefined })}
            />
            <Picker
              value={tool.category}
              options={data.tree[tool.group] ?? []}
              onChange={(category) => onPatch({ category, rank: undefined })}
            />
          </div>
        </Row>

        <button
          onClick={autoFile}
          disabled={filing}
          className="mb-4 inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink-muted transition hover:border-brand/50 hover:text-ink disabled:opacity-50"
        >
          <Icon.Sparkles width={13} height={13} />
          {filing ? "Reading…" : "Auto-file this"}
        </button>

        {suggestion && (
          <div className="animate-fade-in mb-4 rounded-xl border border-brand/40 bg-brand/5 p-3">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-brand">
              {suggestion.source === "ai" ? "Suggested" : "Suggested · offline guess"}
            </p>
            <p className="text-[12px] text-ink">
              {suggestion.group} › {suggestion.category} · {ACCESS_LABEL[suggestion.access]} ·{" "}
              {suggestion.openSource ? "open source" : "closed"} ·{" "}
              {HOSTING_LABEL[suggestion.hosting]}
              {suggestion.contentRating !== "unknown" &&
                ` · ${CONTENT_LABEL[suggestion.contentRating].toLowerCase()}`}
            </p>
            {suggestion.summary && (
              <p className="mt-1 text-[12px] text-ink-muted">{suggestion.summary}</p>
            )}
            {suggestion.tags.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {suggestion.tags.map((t) => (
                  <TagPill key={t} tag={t} />
                ))}
              </div>
            )}
            {pendingFeatures.length > 0 && (
              <div className="mt-2.5 border-t border-brand/20 pt-2">
                <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-brand/80">
                  Features it may have · tap to add
                </p>
                <div className="flex flex-wrap gap-1">
                  {pendingFeatures.map((f) => (
                    <button
                      key={f}
                      onClick={() => props.onAddFeature(f, "good")}
                      className="inline-flex items-center gap-1 rounded-lg border border-line bg-panel px-2 py-1 text-[11px] text-ink-muted transition hover:border-brand/50 hover:text-ink"
                    >
                      <Icon.Plus width={10} height={10} />
                      {f}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-2.5 flex gap-1.5">
              <button
                onClick={applySuggestion}
                disabled={applied}
                className="rounded-lg bg-brand px-2.5 py-1 text-[12px] font-semibold text-white transition hover:bg-brand-2 disabled:opacity-40"
              >
                {applied ? "Applied ✓" : "Apply filing"}
              </button>
              <button
                onClick={() => setSuggestion(null)}
                className="rounded-lg px-2.5 py-1 text-[12px] text-ink-muted transition hover:text-ink"
              >
                {applied ? "Done" : "Discard"}
              </button>
            </div>
            {suggestion.source === "heuristic" && (
              <p className="mt-2 text-[11px] text-ink-faint">
                No AI key set, so this came from keyword rules. Add AI_GATEWAY_API_KEY for a real
                read.
              </p>
            )}
          </div>
        )}

        <Row label="What is it">
          <InlineText
            value={tool.summary}
            onCommit={(v) => onPatch({ summary: v })}
            className="w-full rounded-lg border border-line bg-canvas px-2 py-1.5 text-[12px] text-ink outline-none focus:border-brand"
            placeholder="One line"
          />
        </Row>

        {/* Facts */}
        <Row label="Cost to you">
          <Segmented<Access>
            value={tool.access}
            options={[
              ["free", "Free"],
              ["freemium", "Free tier"],
              ["paid", "Paid"],
            ]}
            onChange={(access) => onPatch({ access })}
          />
        </Row>

        <Row label="Where it runs">
          <Segmented<Hosting>
            value={tool.hosting}
            options={[
              ["hosted", "Web"],
              ["self-host", "Local"],
              ["both", "Both"],
            ]}
            onChange={(hosting) => onPatch({ hosting })}
          />
        </Row>

        <Row label="API key">
          <Segmented<ApiKey>
            value={tool.apiKey}
            options={[
              ["none", "None"],
              ["optional", "Optional"],
              ["required", "Required"],
            ]}
            onChange={(apiKey) => onPatch({ apiKey })}
          />
        </Row>

        <div className="mb-4 flex flex-wrap gap-1.5">
          <Toggle
            label="Open source"
            on={tool.openSource}
            onChange={(openSource) => onPatch({ openSource })}
          />
          <Toggle
            label="I have the key"
            on={tool.haveKey}
            disabled={tool.apiKey === "none"}
            onChange={(haveKey) => onPatch({ haveKey })}
          />
        </div>

        <Row
          label="Content rating"
          hint="How far its filter lets you go. Safe mode hides suggestive and uncensored records; unrated ones stay visible, because unrated is not the same as safe."
        >
          <Segmented<ContentRating>
            value={ratingOf(tool)}
            options={[
              ["unknown", "Unrated"],
              ["sfw", "Filtered"],
              ["soft", "Soft"],
              ["explicit", "18+"],
            ]}
            onChange={(contentRating) => onPatch({ contentRating })}
          />
        </Row>

        <Row label="Pricing note">
          <InlineText
            value={tool.pricingNote ?? ""}
            onCommit={(v) => onPatch({ pricingNote: v || undefined })}
            className="w-full rounded-lg border border-line bg-canvas px-2 py-1.5 font-mono text-[11px] text-ink outline-none focus:border-brand"
            placeholder="$20/mo · credits · 50 free/day"
          />
        </Row>

        <RankRow {...props} boardSize={boardSize} />

        <FeatureList {...props} />

        <Row label="Notes">
          <InlineTextarea
            value={tool.notes ?? ""}
            onCommit={(v) => onPatch({ notes: v || undefined })}
            placeholder="Anything that doesn't fit a field — what you used it for, what broke, what to try next."
          />
        </Row>

        <Row label="Tags">
          <InlineText
            value={tool.tags.join(", ")}
            onCommit={(v) =>
              onPatch({
                tags: v
                  .split(",")
                  .map((t) => t.trim().toLowerCase())
                  .filter(Boolean),
              })
            }
            className="w-full rounded-lg border border-line bg-canvas px-2 py-1.5 font-mono text-[11px] text-ink outline-none focus:border-brand"
            placeholder="vision, local, open-source"
          />
          {tool.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {tool.tags.map((t) => (
                <TagPill key={t} tag={t} onClick={onTag} />
              ))}
            </div>
          )}
        </Row>

        <div className="mt-5 flex items-center justify-between border-t border-line-soft pt-3">
          <p className="font-mono text-[10px] text-ink-faint">
            added {formatDate(tool.addedAt)} · edited {formatDate(tool.updatedAt)}
          </p>
          <button
            onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
            className="rounded-lg px-2 py-1 text-[11px] font-medium text-rose-400/70 transition hover:bg-rose-500/10 hover:text-rose-300"
          >
            {confirmDelete ? "Really delete?" : "Delete record"}
          </button>
        </div>
      </div>
    </aside>
  );
}

// ----- ranking -------------------------------------------------------------

function RankRow({
  tool,
  onMove,
  onRank,
  onUnrank,
  boardSize,
}: Pick<Props, "tool" | "onMove" | "onRank" | "onUnrank" | "boardSize">) {
  return (
    <Row label={`Rank in ${tool.category}`}>
      {tool.rank === undefined ? (
        <button
          onClick={onRank}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink-muted transition hover:border-brand/50 hover:text-ink"
        >
          <Icon.Plus width={12} height={12} />
          Put it on the board
        </button>
      ) : (
        <div className="flex items-center gap-1.5">
          <span className="rounded-lg bg-elevated px-2.5 py-1.5 font-mono text-[13px] font-bold tabular-nums text-ink">
            #{tool.rank}
            <span className="ml-1 text-[11px] font-normal text-ink-faint">of {boardSize}</span>
          </span>
          <button
            onClick={() => onMove((tool.rank ?? 1) - 1)}
            disabled={tool.rank === 1}
            className="rounded-lg border border-line p-1.5 text-ink-muted transition hover:text-ink disabled:opacity-30"
            aria-label="Move up"
          >
            <Icon.Chevron width={13} height={13} className="-rotate-90" />
          </button>
          <button
            onClick={() => onMove((tool.rank ?? 1) + 1)}
            disabled={tool.rank === boardSize}
            className="rounded-lg border border-line p-1.5 text-ink-muted transition hover:text-ink disabled:opacity-30"
            aria-label="Move down"
          >
            <Icon.Chevron width={13} height={13} className="rotate-90" />
          </button>
          <button
            onClick={onUnrank}
            className="rounded-lg px-2 py-1.5 text-[11px] text-ink-faint transition hover:text-ink"
          >
            Remove
          </button>
        </div>
      )}
    </Row>
  );
}

// ----- features ------------------------------------------------------------

const VERDICTS: Feature["verdict"][] = ["love", "good", "miss", "dealbreaker"];

function FeatureList({
  tool,
  onAddFeature,
  onUpdateFeature,
  onDeleteFeature,
  knownFeatures,
}: Pick<
  Props,
  "tool" | "onAddFeature" | "onUpdateFeature" | "onDeleteFeature" | "knownFeatures"
>) {
  const [text, setText] = useState("");
  const [verdict, setVerdict] = useState<Feature["verdict"]>("love");

  const submit = () => {
    if (!text.trim()) return;
    onAddFeature(text, verdict);
    setText("");
  };

  return (
    <Row
      label="Features & verdicts"
      hint="What this tool does for you — and what it doesn't. This is the case for its rank."
    >
      {tool.features.length > 0 && (
        <ul className="mb-2 space-y-1">
          {tool.features.map((f) => {
            const style = VERDICT_STYLE[f.verdict];
            return (
              <li key={f.id} className="group/f flex items-start gap-2">
                <button
                  onClick={() =>
                    onUpdateFeature(f.id, {
                      verdict: VERDICTS[(VERDICTS.indexOf(f.verdict) + 1) % VERDICTS.length],
                    })
                  }
                  title={`${style.label} — click to change`}
                  className="mt-0.5 shrink-0"
                >
                  <MetaPill tone={style.tone}>{style.mark}</MetaPill>
                </button>
                <span className="min-w-0 flex-1 text-[12px] leading-relaxed text-ink-muted">
                  {f.text}
                </span>
                <button
                  onClick={() => onDeleteFeature(f.id)}
                  className="shrink-0 text-ink-faint opacity-0 transition group-hover/f:opacity-100 hover:text-rose-400"
                  aria-label="Remove note"
                >
                  <Icon.Close width={11} height={11} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex gap-1.5">
        <select
          value={verdict}
          onChange={(e) => setVerdict(e.target.value as Feature["verdict"])}
          className="shrink-0 rounded-lg border border-line bg-canvas px-1.5 py-1.5 text-[11px] text-ink-muted outline-none focus:border-brand"
        >
          {VERDICTS.map((v) => (
            <option key={v} value={v}>
              {VERDICT_STYLE[v].mark} {VERDICT_STYLE[v].label}
            </option>
          ))}
        </select>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="First/last frame control…"
          // Offering the board's existing wording is what keeps the feature
          // index one row per idea instead of four spellings of the same one.
          list="board-features"
          className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-2 py-1.5 text-[12px] text-ink outline-none focus:border-brand"
        />
        <datalist id="board-features">
          {knownFeatures.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <button
          onClick={submit}
          disabled={!text.trim()}
          className="shrink-0 rounded-lg border border-line px-2 text-ink-muted transition hover:text-ink disabled:opacity-30"
          aria-label="Add note"
        >
          <Icon.Plus width={13} height={13} />
        </button>
      </div>
    </Row>
  );
}

// ----- primitives ----------------------------------------------------------

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
        {label}
      </p>
      {children}
      {hint && <p className="mt-1 text-[11px] text-ink-faint">{hint}</p>}
    </div>
  );
}

/**
 * A text field that only writes on blur or Enter.
 *
 * Committing per keystroke would push a localStorage write and a full re-render
 * of the table through every character typed.
 */
function InlineText({
  value,
  onCommit,
  className,
  placeholder,
}: {
  value: string;
  onCommit: (value: string) => void;
  className: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  const last = useRef(value);
  // Re-sync when the record changes underneath — switching rows, or an applied
  // AI suggestion — but never while the user is mid-edit on the same value.
  if (value !== last.current) {
    last.current = value;
    if (draft !== value) setDraft(value);
  }

  return (
    <input
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(value);
      }}
      className={className}
    />
  );
}

function InlineTextarea({
  value,
  onCommit,
  placeholder,
}: {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  const last = useRef(value);
  if (value !== last.current) {
    last.current = value;
    if (draft !== value) setDraft(value);
  }

  return (
    <textarea
      value={draft}
      placeholder={placeholder}
      rows={4}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      className="w-full resize-y rounded-lg border border-line bg-canvas px-2 py-1.5 text-[12px] leading-relaxed text-ink outline-none placeholder:text-ink-faint focus:border-brand"
    />
  );
}

function Picker({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const list = options.includes(value) ? options : [value, ...options];
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-2 py-1.5 text-[12px] text-ink outline-none focus:border-brand"
    >
      {list.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex gap-0.5 rounded-lg border border-line bg-canvas p-0.5">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={
            "flex-1 rounded px-2 py-1 text-[11px] font-medium transition " +
            (value === v ? "bg-brand text-white" : "text-ink-muted hover:text-ink")
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  label,
  on,
  onChange,
  disabled,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!on)}
      aria-pressed={on}
      className={
        "rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 " +
        (on
          ? "border-brand bg-brand/15 text-brand"
          : "border-line text-ink-muted hover:text-ink")
      }
    >
      {on ? "✓ " : ""}
      {label}
    </button>
  );
}
