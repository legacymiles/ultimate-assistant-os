"use client";

import { useState } from "react";
import { Icon } from "../icons";

/**
 * Model text, rendered plainly: blank lines split paragraphs, a short line
 * ending in ":" or starting with "#" becomes a heading, and a "Style prompt:"
 * line gets its own copy button because that is the line you paste elsewhere.
 */
export function Prose({ text }: { text: string }) {
  const blocks = text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  return (
    <div className="space-y-2.5 text-[13px] leading-relaxed text-ink-muted">
      {blocks.map((block, i) =>
        block.split("\n").map((line, j) => {
          const key = `${i}-${j}`;
          const style = line.match(/^style prompt:\s*(.+)$/i);
          if (style) return <StylePrompt key={key} prompt={style[1]} />;
          if (/^#+\s/.test(line) || (line.length < 60 && /:$/.test(line)))
            return (
              <p key={key} className="pt-1 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
                {line.replace(/^#+\s*/, "").replace(/:$/, "")}
              </p>
            );
          return (
            <p key={key} className={/^[-•]\s/.test(line) ? "pl-3 -indent-3" : ""}>
              {line}
            </p>
          );
        }),
      )}
    </div>
  );
}

function StylePrompt({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-brand/30 bg-brand/5 p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-brand">Style prompt</span>
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(prompt);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="inline-flex items-center gap-1 font-mono text-[10px] text-ink-faint transition hover:text-ink"
        >
          {copied ? <Icon.Check width={10} height={10} /> : <Icon.Copy width={10} height={10} />}
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <p className="font-mono text-[12px] text-ink">{prompt}</p>
    </div>
  );
}
