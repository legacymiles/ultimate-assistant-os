"use client";

import { useEffect, useRef, useState } from "react";

import { Icon } from "../icons";
import { Markdown } from "../Markdown";
import { saveAboutMe } from "@/lib/social-personas/store";
import { Btn } from "./bits";
import type { TabProps } from "./Workspace";

/**
 * The character document.
 *
 * This is the one file in the app the agent is not allowed to paraphrase: it is
 * injected whole into every generation call, ahead of the engagement data, so
 * the numbers can change what the character talks about but never how it
 * sounds. Editing it is therefore a real change to the agent, which is why it
 * versions rather than overwrites — a post that worked can be traced back to
 * the voice that was in force when it was written.
 */
export function AboutMeTab({ persona, mutate, flash }: TabProps) {
  const draftKey = `social-personas:aboutme-draft:${persona.id}`;
  const [draft, setDraft] = useState(persona.aboutMe);
  const [preview, setPreview] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const loaded = useRef(false);

  // An unsaved edit survives a reload or a crashed tab (checklist R6). It is a
  // document someone may have spent twenty minutes on; losing it to a stray
  // refresh would be the worst bug in this screen.
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved && saved !== persona.aboutMe) setDraft(saved);
    } catch {
      /* private mode, or storage disabled — the saved version is still there */
    }
  }, [draftKey, persona.aboutMe]);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      if (draft === persona.aboutMe) localStorage.removeItem(draftKey);
      else localStorage.setItem(draftKey, draft);
    } catch {
      /* ignore */
    }
  }, [draft, draftKey, persona.aboutMe]);

  const dirty = draft.trimEnd() !== persona.aboutMe.trimEnd();

  const save = () => {
    if (!dirty) return;
    mutate(persona.id, (p) => saveAboutMe(p, draft));
    try {
      localStorage.removeItem(draftKey);
    } catch {
      /* ignore */
    }
    flash(`Character document saved as version ${persona.aboutMeVersion + 1}. The agent reads it from the next generation on.`);
  };

  const missing = REQUIRED.filter((h) => !new RegExp(`^##\\s+${h}`, "im").test(draft));

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-semibold text-ink">about-me.md</h3>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">
            Read in full before every idea, caption and reply. Version {persona.aboutMeVersion}
            {dirty && <span className="text-[var(--color-state-waiting)]"> · unsaved changes</span>}
          </p>
        </div>
        <Btn onClick={() => setPreview(!preview)}>
          <Icon.Eye width={12} height={12} /> {preview ? "Edit" : "Preview"}
        </Btn>
        {persona.aboutMeHistory.length > 1 && (
          <Btn onClick={() => setShowHistory(!showHistory)}>
            <Icon.Clock width={12} height={12} /> {persona.aboutMeHistory.length} versions
          </Btn>
        )}
        <Btn primary onClick={save} disabled={!dirty}>
          <Icon.Check width={12} height={12} /> Save
        </Btn>
      </div>

      {missing.length > 0 && (
        <p className="rounded-md border border-[var(--color-state-waiting)]/40 bg-panel px-2.5 py-1.5 text-[12px] leading-relaxed text-ink-muted">
          The agent looks for these headings and will have nothing to go on where they are missing:{" "}
          <span className="font-mono text-[11px] text-ink">{missing.join(", ")}</span>
        </p>
      )}

      {preview ? (
        <div className="prose-sm max-w-none rounded-[10px] border border-line bg-panel px-3 py-2.5 text-[13px] leading-relaxed text-ink-muted">
          <Markdown source={draft} />
        </div>
      ) : (
        <>
          <label className="sr-only" htmlFor="aboutme">
            Character document, in markdown
          </label>
          <textarea
            id="aboutme"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                e.preventDefault();
                save();
              }
            }}
            spellCheck
            rows={26}
            className="w-full resize-y rounded-[10px] border border-line bg-canvas px-3 py-2.5 font-mono text-[16px] leading-relaxed text-ink outline-none placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/30 sm:text-[11.5px]"
            placeholder="# Who this character is…"
          />
          <p className="font-mono text-[10.5px] text-ink-faint">
            markdown · {draft.trim().split(/\s+/).filter(Boolean).length} words · ⌘S / ctrl+S to save
          </p>
        </>
      )}

      {showHistory && (
        <section className="overflow-hidden rounded-[10px] border border-line bg-panel">
          <h4 className="border-b border-line-soft bg-panel-2 px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-wide text-ink-muted">
            earlier versions
          </h4>
          <ul className="divide-y divide-line-soft">
            {persona.aboutMeHistory.map((v) => (
              <li key={v.version} className="flex items-center gap-2 px-3 py-2">
                <span className="w-8 shrink-0 font-mono text-[11px] text-ink">v{v.version}</span>
                <span className="min-w-0 flex-1 font-mono text-[11px] text-ink-faint">
                  {new Date(v.at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="shrink-0 font-mono text-[10.5px] text-ink-faint">
                  {v.markdown.trim().split(/\s+/).filter(Boolean).length} words
                </span>
                {v.version === persona.aboutMeVersion ? (
                  <span className="shrink-0 font-mono text-[10.5px] text-brand">current</span>
                ) : (
                  <Btn onClick={() => setDraft(v.markdown)} title="Load this version into the editor">
                    Load
                  </Btn>
                )}
              </li>
            ))}
          </ul>
          <p className="border-t border-line-soft px-3 py-2 text-[12px] leading-relaxed text-ink-muted">
            Loading an old version puts it in the editor — it only becomes the live document when you save, which
            makes it a new version rather than erasing the ones in between.
          </p>
        </section>
      )}
    </div>
  );
}

const REQUIRED = ["Purpose", "Voice", "Never says", "Goals"];
