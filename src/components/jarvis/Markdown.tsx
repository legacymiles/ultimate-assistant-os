"use client";

// ---------------------------------------------------------------------------
// The little markdown Jarvis writes: headings, bold, inline code, lists,
// tables and fenced code blocks (the paste-ready prompts, with a Copy button).
// Built from React elements — model text never becomes raw HTML.
// ---------------------------------------------------------------------------

import { useState, type ReactNode } from "react";

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const tok = m[0];
    out.push(
      tok.startsWith("**") ? (
        <strong key={`${key}-${i}`} className="font-semibold text-ink">
          {tok.slice(2, -2)}
        </strong>
      ) : (
        <code key={`${key}-${i}`} className="rounded bg-panel-2 px-1 font-mono text-[0.92em] text-ink">
          {tok.slice(1, -1)}
        </code>
      ),
    );
    last = at + tok.length;
    i += 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative my-2 rounded-lg border border-line bg-canvas">
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="absolute right-1.5 top-1.5 rounded-md border border-line bg-panel px-1.5 py-0.5 text-[10px] text-ink-muted transition hover:text-ink"
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap p-3 pr-14 font-mono text-[11px] leading-relaxed text-ink">
        {code}
      </pre>
    </div>
  );
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  const key = () => `b${k++}`;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith("```")) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) body.push(lines[i++]);
      i += 1;
      blocks.push(<CodeBlock key={key()} code={body.join("\n")} />);
      continue;
    }

    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const size = h[1].length <= 2 ? "text-[13px]" : "text-xs";
      const id = key();
      blocks.push(
        <p key={id} className={`mt-3 mb-1 font-semibold text-ink first:mt-0 ${size}`}>
          {inline(h[2], id)}
        </p>,
      );
      i += 1;
      continue;
    }

    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i].trim().slice(1, -1).split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i += 1;
      }
      const id = key();
      blocks.push(
        <div key={id} className="my-2 overflow-x-auto">
          <table className="w-full border-collapse text-[11px]">
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-b border-line-soft align-top">
                  {r.map((c, ci) => {
                    const Cell = ri === 0 ? "th" : "td";
                    return (
                      <Cell key={ci} className={`px-2 py-1 text-left ${ri === 0 ? "font-semibold text-ink" : "text-ink-muted"}`}>
                        {inline(c, `${id}-${ri}-${ci}`)}
                      </Cell>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
        i += 1;
      }
      const id = key();
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={id} className={`my-1 space-y-0.5 pl-4 ${ordered ? "list-decimal" : "list-disc"} marker:text-ink-faint`}>
          {items.map((it, n) => (
            <li key={n}>{inline(it, `${id}-${n}`)}</li>
          ))}
        </List>,
      );
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith("```") &&
      !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]) &&
      !/^\s*\|.*\|\s*$/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    const id = key();
    blocks.push(
      <p key={id} className="my-1 whitespace-pre-wrap">
        {inline(para.join("\n"), id)}
      </p>,
    );
  }

  return <div className="text-xs leading-relaxed text-ink">{blocks}</div>;
}
