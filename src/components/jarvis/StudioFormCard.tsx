"use client";

// ---------------------------------------------------------------------------
// A form a Studio skill asked for, inside the chat. Text, a single choice
// (radio cards — options are often whole performance descriptions), several
// choices (checkboxes), and image uploads for references.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Icon } from "../icons";
import { toAttachment, type Attachment } from "@/lib/jarvis/chatImages";
import { missing, type FormValues, type StudioForm } from "@/lib/studio/forms";

export interface FormSubmission {
  values: FormValues;
  images: Record<string, Attachment[]>;
}

export function StudioFormCard({
  form,
  done,
  busy,
  onSubmit,
}: {
  form: StudioForm;
  done: boolean;
  busy: boolean;
  onSubmit: (s: FormSubmission) => void;
}) {
  const [values, setValues] = useState<FormValues>(() =>
    Object.fromEntries(
      form.fields.map((f) => [
        f.id,
        f.type === "multi" ? (f.default ? f.default.split(" | ").filter((d) => f.options?.includes(d)) : []) : f.default ?? "",
      ]),
    ),
  );
  const [images, setImages] = useState<Record<string, Attachment[]>>({});
  const [problem, setProblem] = useState("");

  const set = (id: string, v: string | string[]) => setValues((all) => ({ ...all, [id]: v }));
  const counts = Object.fromEntries(Object.entries(images).map(([k, v]) => [k, v.length]));

  const addImages = async (id: string, files: FileList | null) => {
    const list = Array.from(files ?? []).slice(0, 6);
    const added: Attachment[] = [];
    for (const f of list) {
      try {
        added.push(await toAttachment(f, `${id}-${Date.now()}-${added.length}`));
      } catch (e) {
        setProblem(e instanceof Error ? e.message : "Couldn't read that image.");
      }
    }
    setImages((all) => ({ ...all, [id]: [...(all[id] ?? []), ...added].slice(0, 6) }));
  };

  const submit = () => {
    const gaps = missing(form, values, counts);
    if (gaps.length) {
      setProblem(`Still needed: ${gaps.join(", ")}.`);
      return;
    }
    setProblem("");
    onSubmit({ values, images });
  };

  const field = "w-full rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none disabled:opacity-60";

  return (
    <fieldset
      disabled={done || busy}
      className={`mt-2 rounded-xl border border-line bg-panel p-3 ${done ? "opacity-70" : ""}`}
      aria-label={form.title}
    >
      <legend className="sr-only">{form.title}</legend>
      <p className="flex items-center gap-1.5 text-xs font-semibold text-ink">
        <Icon.ListChecks width={13} height={13} /> {form.title}
        {done && <span className="ml-auto text-[10px] font-normal text-ink-faint">Sent</span>}
      </p>
      {form.intro && <p className="mt-1 text-[11px] text-ink-muted">{form.intro}</p>}

      <div className="mt-3 space-y-3">
        {form.fields.map((f) => (
          <div key={f.id}>
            <label htmlFor={`sf-${f.id}`} className="mb-1 block text-[11px] font-medium text-ink-muted">
              {f.label}
              {f.required && <span className="text-ink-faint"> *</span>}
            </label>

            {f.type === "text" && (
              <input
                id={`sf-${f.id}`}
                value={String(values[f.id] ?? "")}
                onChange={(e) => set(f.id, e.target.value)}
                placeholder={f.placeholder}
                className={field}
              />
            )}

            {f.type === "textarea" && (
              <textarea
                id={`sf-${f.id}`}
                value={String(values[f.id] ?? "")}
                onChange={(e) => set(f.id, e.target.value)}
                placeholder={f.placeholder}
                rows={3}
                className={`${field} resize-y`}
              />
            )}

            {(f.type === "choice" || f.type === "multi") && (
              <div role={f.type === "choice" ? "radiogroup" : "group"} className="space-y-1.5">
                {f.options!.map((o) => {
                  const on =
                    f.type === "choice" ? values[f.id] === o : ((values[f.id] as string[]) ?? []).includes(o);
                  return (
                    <label
                      key={o}
                      className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-xs transition ${
                        on ? "border-ink-muted bg-panel-2 text-ink" : "border-line text-ink-muted hover:border-ink-faint hover:text-ink"
                      }`}
                    >
                      <input
                        type={f.type === "choice" ? "radio" : "checkbox"}
                        name={`sf-${f.id}`}
                        checked={on}
                        onChange={() => {
                          if (f.type === "choice") set(f.id, o);
                          else {
                            const cur = (values[f.id] as string[]) ?? [];
                            set(f.id, cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o]);
                          }
                        }}
                        className="mt-0.5 accent-current"
                      />
                      <span className="leading-relaxed">{o}</span>
                    </label>
                  );
                })}
              </div>
            )}

            {f.type === "image" && (
              <div className="flex flex-wrap items-center gap-2">
                {(images[f.id] ?? []).map((a) => (
                  <span key={a.id} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.thumb} alt={a.name} className="h-16 w-16 rounded-lg border border-line object-cover" />
                    {!done && (
                      <button
                        type="button"
                        onClick={() => setImages((all) => ({ ...all, [f.id]: (all[f.id] ?? []).filter((x) => x.id !== a.id) }))}
                        aria-label={`Remove ${a.name}`}
                        className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full border border-line bg-panel text-ink-muted hover:text-ink"
                      >
                        <Icon.Close width={10} height={10} />
                      </button>
                    )}
                  </span>
                ))}
                {!done && (
                  <label className="grid h-16 w-16 cursor-pointer place-items-center rounded-lg border border-dashed border-line text-ink-faint transition hover:border-ink-faint hover:text-ink">
                    <Icon.Upload width={16} height={16} />
                    <span className="sr-only">Add images for {f.label}</span>
                    <input
                      id={`sf-${f.id}`}
                      type="file"
                      accept="image/*"
                      multiple
                      hidden
                      onChange={(e) => {
                        void addImages(f.id, e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {problem && <p className="mt-2 text-[11px] text-amber-400">{problem}</p>}
      {!done && (
        <button
          type="button"
          onClick={submit}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-line bg-ink px-3 py-1.5 text-xs font-medium text-canvas transition hover:opacity-90 disabled:opacity-50"
        >
          <Icon.Send width={12} height={12} /> {busy ? "Working…" : form.submitLabel || "Send"}
        </button>
      )}
    </fieldset>
  );
}
