import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// A small, dependency-free Markdown renderer for long-form project writeups.
//
// It covers exactly what the detailed explanations use — headings, bold, inline
// code, bullet and numbered lists, tables, horizontal rules and paragraphs —
// and nothing else. Anything unrecognised falls through as plain text, so a
// writeup can never fail to render.
//
// Deliberately not a full Markdown implementation: no raw HTML is ever
// interpreted, which keeps AI-generated writeups safe to display as-is.
// ---------------------------------------------------------------------------

/** Bold, inline code and links inside a single line of text. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Split on `code`, **bold**, *italic* and [label](href), keeping delimiters.
  // Bold must precede italic in the alternation or "**x**" matches as italic.
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*|\[[^\]]+\]\([^)]+\))/g;
  const parts = text.split(pattern);

  parts.forEach((part, i) => {
    if (!part) return;
    const key = `${keyBase}-${i}`;

    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      out.push(
        <code
          key={key}
          className="rounded bg-panel-2 px-1 py-0.5 font-mono text-[0.85em] text-ink"
        >
          {part.slice(1, -1)}
        </code>,
      );
      return;
    }

    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      out.push(
        <strong key={key} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>,
      );
      return;
    }

    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      out.push(
        <em key={key} className="italic">
          {part.slice(1, -1)}
        </em>,
      );
      return;
    }

    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      out.push(
        <a
          key={key}
          href={link[2]}
          target="_blank"
          rel="noreferrer noopener"
          className="text-brand hover:underline"
        >
          {link[1]}
        </a>,
      );
      return;
    }

    out.push(<span key={key}>{part}</span>);
  });

  return out;
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}

const isTableDivider = (line: string) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes("-");

export function Markdown({ source, className = "" }: { source: string; className?: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let i = 0;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(" ");
    blocks.push(
      <p key={`p-${blocks.length}`} className="text-sm leading-relaxed text-ink-muted">
        {inline(text, `p-${blocks.length}`)}
      </p>,
    );
    paragraph = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Blank line — end the current paragraph.
    if (!trimmed) {
      flushParagraph();
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(trimmed)) {
      flushParagraph();
      blocks.push(<hr key={`hr-${blocks.length}`} className="my-5 border-line-soft" />);
      i++;
      continue;
    }

    // Heading
    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      const content = inline(heading[2], `h-${blocks.length}`);
      const cls =
        level === 1
          ? "mt-6 mb-2 text-lg font-bold tracking-tight text-ink"
          : level === 2
            ? "mt-6 mb-2 text-base font-bold tracking-tight text-ink"
            : level === 3
              ? "mt-4 mb-1.5 text-sm font-semibold text-ink"
              : "mt-3 mb-1 text-[13px] font-semibold text-ink-muted";
      blocks.push(
        <p key={`h-${blocks.length}`} className={cls}>
          {content}
        </p>,
      );
      i++;
      continue;
    }

    // Table — a header row followed by a divider row
    if (trimmed.startsWith("|") && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      flushParagraph();
      const header = splitRow(trimmed);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(splitRow(lines[i].trim()));
        i++;
      }
      blocks.push(
        <div key={`t-${blocks.length}`} className="my-3 overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr>
                {header.map((h, hi) => (
                  <th
                    key={hi}
                    className="border-b border-line px-2.5 py-1.5 font-semibold text-ink-muted"
                  >
                    {inline(h, `th-${hi}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td
                      key={ci}
                      className="border-b border-line-soft px-2.5 py-1.5 align-top text-ink-muted"
                    >
                      {inline(c, `td-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Bullet list — "- ", "* " or the "· " the writeups sometimes use
    if (/^([-*·])\s+/.test(trimmed)) {
      flushParagraph();
      const items: string[] = [];
      while (i < lines.length && /^([-*·])\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^([-*·])\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="my-2 space-y-1 pl-1">
          {items.map((it, ii) => (
            <li key={ii} className="flex gap-2 text-sm leading-relaxed text-ink-muted">
              <span className="mt-[0.5em] h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
              <span className="min-w-0">{inline(it, `li-${ii}`)}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // Numbered list
    if (/^\d+[.)]\s+/.test(trimmed)) {
      flushParagraph();
      const items: string[] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+[.)]\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={`ol-${blocks.length}`} className="my-2 space-y-1 pl-1">
          {items.map((it, ii) => (
            <li key={ii} className="flex gap-2 text-sm leading-relaxed text-ink-muted">
              <span className="w-4 shrink-0 text-right text-xs tabular-nums text-ink-faint">
                {ii + 1}.
              </span>
              <span className="min-w-0">{inline(it, `oli-${ii}`)}</span>
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    paragraph.push(trimmed);
    i++;
  }

  flushParagraph();

  return <div className={className}>{blocks}</div>;
}
