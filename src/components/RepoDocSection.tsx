"use client";

// What the repo's own doc says about this app (docs/apps/<slug>.md): every
// feature with the file that holds it, how it looks, where the code is, and
// the owner's rules. It is the same file any AI tool reads before changing the
// app, so what shows here is exactly what a build will be held to.
// Read-only — the doc changes through commits (see AGENTS.md).

import { useEffect, useMemo, useState } from "react";
import { loadAppDoc, plain, type AppDoc, type DocFeature } from "@/lib/timeline/appDocs";
import { cn } from "@/lib/utils";
import { Icon } from "./icons";

export function useAppDoc(slug: string | undefined): AppDoc | null {
  const [doc, setDoc] = useState<AppDoc | null>(null);
  useEffect(() => {
    let live = true;
    setDoc(null);
    loadAppDoc(slug)
      .then((d) => live && setDoc(d))
      .catch(() => live && setDoc(null));
    return () => {
      live = false;
    };
  }, [slug]);
  return doc;
}

const docPath = (slug: string) => `docs/apps/${slug}.md`;

function Header({ title, sub, count }: { title: string; sub: string; count?: number }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
      <div className="min-w-0">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{title}</h2>
        <p className="truncate text-[11px] text-ink-faint">{sub}</p>
      </div>
      {count !== undefined && (
        <span className="rounded-full bg-canvas px-2 py-0.5 text-[11px] font-semibold tabular-nums text-ink-muted">{count}</span>
      )}
    </div>
  );
}

function FeatureRow({ f }: { f: DocFeature }) {
  return (
    <li className="border-b border-line/50 px-4 py-2 last:border-0">
      <span className="block text-sm text-ink">{plain(f.title)}</span>
      {f.text && <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">{plain(f.text)}</span>}
      {f.files.length > 0 && (
        <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-ink-faint">
          {f.files.map((p) => (
            <span key={p} className="break-all">{p}</span>
          ))}
        </span>
      )}
    </li>
  );
}

/** Features tab: the features the code has today — the contract for any change. */
export function RepoFeatures({ doc }: { doc: AppDoc }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return doc.features;
    return doc.features.filter((f) => `${f.group} ${f.title} ${f.text} ${f.files.join(" ")}`.toLowerCase().includes(s));
  }, [doc, q]);

  let lastGroup: string | null = null;

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-panel">
      <Header
        title="In the code"
        sub={`Every feature this app has today · from ${docPath(doc.slug)}, the list any AI tool must keep`}
        count={doc.features.length}
      />
      {doc.features.length > 8 && (
        <label className="flex items-center gap-2 border-b border-line px-4 py-2">
          <Icon.Search width={14} height={14} className="shrink-0 text-ink-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter features or files"
            aria-label="Filter features"
            className="w-full bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          />
          {q && <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">{shown.length}</span>}
        </label>
      )}
      {doc.missing.length > 0 && !q && (
        <div className="border-b border-amber-500/25 bg-amber-500/[0.06] px-4 py-2.5">
          <p className="text-xs font-semibold text-amber-300">Described but not in the code ({doc.missing.length})</p>
          <ul className="mt-1 space-y-0.5">
            {doc.missing.map((m) => (
              <li key={m} className="text-xs leading-relaxed text-amber-200/80">{plain(m)}</li>
            ))}
          </ul>
        </div>
      )}
      <ul>
        {shown.map((f, i) => {
          const header = f.group !== lastGroup && f.group !== "";
          lastGroup = f.group;
          return (
            <FeatureGroupRow key={`${f.group}:${f.title}:${i}`} header={header ? f.group : null} f={f} />
          );
        })}
        {shown.length === 0 && (
          <li className="px-4 py-5 text-center text-sm text-ink-faint">No feature matches “{q}”.</li>
        )}
      </ul>
    </section>
  );
}

function FeatureGroupRow({ header, f }: { header: string | null; f: DocFeature }) {
  return (
    <>
      {header && (
        <li className="bg-canvas/60 px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{header}</li>
      )}
      <FeatureRow f={f} />
    </>
  );
}

/** Overview tab: how it looks, where the code is, and the owner's rules. */
export function RepoDocDetails({ doc }: { doc: AppDoc }) {
  const [shot, setShot] = useState(true);
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-panel">
      <Header title="From the repo" sub={`${docPath(doc.slug)}${doc.meta ? ` · ${plain(doc.meta)}` : ""}`} />

      {doc.screenshot && shot && (
        // eslint-disable-next-line @next/next/no-img-element -- a committed screenshot; it may be missing, and onError hides it
        <img
          src={doc.screenshot}
          alt={`${doc.title} as it looks today`}
          onError={() => setShot(false)}
          className="block w-full border-b border-line bg-canvas object-cover object-top"
          style={{ aspectRatio: "16 / 10" }}
        />
      )}

      {doc.overview && (
        <p className="border-b border-line px-4 py-3 text-sm leading-relaxed text-ink-muted">{plain(doc.overview)}</p>
      )}

      {doc.look.length > 0 && (
        <Block title="How it looks">
          <ul className="space-y-1">
            {doc.look.map((l) => (
              <li key={l} className="text-xs leading-relaxed text-ink-muted">{plain(l)}</li>
            ))}
          </ul>
        </Block>
      )}

      {doc.code.length > 0 && (
        <Block title="Where the code is">
          <dl className="grid grid-cols-[minmax(5rem,auto)_1fr] gap-x-4 gap-y-1">
            {doc.code.map((c) => (
              <div key={c.part} className="contents">
                <dt className="text-xs text-ink-faint">{plain(c.part)}</dt>
                <dd className="break-all font-mono text-[11px] leading-5 text-ink-muted">{plain(c.path)}</dd>
              </div>
            ))}
          </dl>
        </Block>
      )}

      {doc.rules.length > 0 && (
        <Block title="Owner's rules">
          <ul className="space-y-1">
            {doc.rules.map((r) => (
              <li key={r} className="text-xs leading-relaxed text-ink-muted">{plain(r)}</li>
            ))}
          </ul>
        </Block>
      )}
    </section>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={cn("border-b border-line px-4 py-3 last:border-0")}>
      <h3 className="mb-1.5 text-[11px] font-semibold text-ink">{title}</h3>
      {children}
    </div>
  );
}
