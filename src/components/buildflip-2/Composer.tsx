"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Camera,
  Link2,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import { useApp, write } from "./AppState";
import { useToast } from "./Providers";
import { Button, ErrorNote, Label, fieldClass } from "./ui";
import { resizeImage, type ResizedImage } from "@/lib/buildflip-2/resize-image";
import { cn, ease } from "@/lib/buildflip-2/ui";

/**
 * Feature 1 — paste a link, get a plan.
 *
 * A social post link, a plain-English prompt, and reference photos resized on
 * the phone before upload. The whole input survives a reload (R6): everything
 * typed is mirrored into sessionStorage, so a dropped connection or an
 * accidental back-swipe never costs the user their idea.
 */

export interface ComposerSubmit {
  prompt: string;
  sourceUrl: string;
  images: string[];
  requestId: string;
}

const DRAFT_KEY = "bf-draft-v1";

const EXAMPLES = [
  "A 4ft custom oak picture frame for a gallery print",
  "Cedar hot tub boat with a wood-fired stove",
  "DIY electric fireplace wall with a floating oak mantel",
  "Live-edge walnut dining table, 8 seats",
  "Raised cedar planter boxes for a patio",
];

export default function Composer({
  onSubmit,
  busy,
  autoFocus,
  compact,
}: {
  onSubmit: (input: ComposerSubmit) => void;
  busy?: boolean;
  autoFocus?: boolean;
  compact?: boolean;
}) {
  const { capabilities } = useApp();
  const { toast } = useToast();
  const promptId = useId();
  const linkId = useId();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [prompt, setPrompt] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [images, setImages] = useState<(ResizedImage & { path?: string; uploading?: boolean })[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [placeholder] = useState(
    () => EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)]!,
  );

  /* ------------------------------------------- never lose what was typed */

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as { prompt?: string; sourceUrl?: string };
      if (draft.prompt) setPrompt(draft.prompt);
      if (draft.sourceUrl) setSourceUrl(draft.sourceUrl);
    } catch {
      /* a corrupt draft is not worth a crash */
    }
  }, []);

  useEffect(() => {
    try {
      if (prompt || sourceUrl) {
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ prompt, sourceUrl }));
      } else {
        sessionStorage.removeItem(DRAFT_KEY);
      }
    } catch {
      /* private mode */
    }
  }, [prompt, sourceUrl]);

  /* -------------------------------------------------------------- photos */

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (!list.length) return;

      if (!capabilities?.storage) {
        setError(
          "Photo upload isn't connected on this deployment yet. Your description and a pasted link still produce a full plan.",
        );
        return;
      }

      const room = 4 - images.length;
      if (room <= 0) {
        setError("Four reference photos is the limit — that's plenty for the model to read.");
        return;
      }

      setError(null);
      // A few at a time, never all at once (P5).
      for (const file of list.slice(0, room)) {
        const result = await resizeImage(file);
        if (!result.ok) {
          setError(result.error);
          continue;
        }
        const image = { ...result.image, uploading: true };
        setImages((prev) => [...prev, image]);

        const res = await write<{ path: string }>("/api/buildflip-2/upload", {
          method: "POST",
          body: JSON.stringify({ dataUrl: image.dataUrl }),
          timeoutMs: 45_000,
        });

        setImages((prev) =>
          prev.map((p) =>
            p.dataUrl === image.dataUrl
              ? { ...p, uploading: false, path: res.data?.path }
              : p,
          ),
        );
        if (!res.ok) {
          setImages((prev) => prev.filter((p) => p.dataUrl !== image.dataUrl));
          setError(res.error ?? "That photo didn't upload. The rest of the plan still works.");
        }
      }
    },
    [capabilities?.storage, images.length],
  );

  /* -------------------------------------------------------------- submit */

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = prompt.trim();
    if (trimmed.length < 3) {
      setError("Tell us what you want to build — even a few words is enough.");
      return;
    }
    if (sourceUrl.trim() && !/^https?:\/\/\S+\.\S+/.test(sourceUrl.trim())) {
      setError("That link doesn't look complete. It should start with https:// — or leave it blank.");
      return;
    }
    if (images.some((i) => i.uploading)) {
      toast({ tone: "info", message: "Hang on — a photo is still uploading." });
      return;
    }
    setError(null);
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
    onSubmit({
      prompt: trimmed,
      sourceUrl: sourceUrl.trim(),
      images: images.map((i) => i.path).filter(Boolean) as string[],
      // Idempotency: a double-tap on a slow phone must not make two plans (D5).
      requestId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {/* ---------------------------------------------------------- prompt */}
      <div>
        <Label htmlFor={promptId}>What do you want to build?</Label>
        <div className="relative">
          <textarea
            id={promptId}
            value={prompt}
            autoFocus={autoFocus}
            onChange={(e) => setPrompt(e.target.value.slice(0, 2000))}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit(e);
            }}
            rows={compact ? 2 : 3}
            maxLength={2000}
            placeholder={placeholder}
            aria-describedby={`${promptId}-hint`}
            className={cn(fieldClass, "resize-none pr-16 leading-relaxed")}
          />
          <span
            aria-hidden
            className="num pointer-events-none absolute bottom-2.5 right-3 text-[11px] text-[var(--ink-4)]"
          >
            {prompt.length}/2000
          </span>
        </div>
        <p id={`${promptId}-hint`} className="mt-1.5 text-[11.5px] text-[var(--ink-4)]">
          Say the size if you know it. If you don&apos;t, we&apos;ll pick a sensible one and
          tell you what we assumed.
        </p>
      </div>

      {/* ------------------------------------------------------------ link */}
      <div>
        <Label htmlFor={linkId} hint="optional">
          Link to a post you saw
        </Label>
        <div className="relative">
          <Link2
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-4)]"
          />
          <input
            id={linkId}
            type="url"
            inputMode="url"
            autoComplete="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value.slice(0, 2048))}
            placeholder="instagram.com/p/… · tiktok.com/… · pinterest.com/pin/…"
            className={cn(fieldClass, "pl-9")}
          />
        </div>
      </div>

      {/* ---------------------------------------------------------- photos */}
      <div>
        <div className="flex items-center justify-between">
          <Label htmlFor="bf-photos" hint="optional, up to 4">
            Reference photos
          </Label>
          <span className="mb-1.5 text-[11px] text-[var(--ink-4)]">
            resized on your phone before upload
          </span>
        </div>
        <input
          ref={fileRef}
          id="bf-photos"
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <AnimatePresence mode="popLayout">
            {images.map((img) => (
              <motion.div
                key={img.dataUrl.slice(-40)}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.25, ease }}
                className="relative h-16 w-16 overflow-hidden rounded-[10px] border border-[var(--line)]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.previewUrl}
                  alt={`Reference photo: ${img.name}`}
                  width={img.width}
                  height={img.height}
                  className="h-full w-full object-cover"
                />
                {img.uploading && (
                  <span className="absolute inset-0 grid place-items-center bg-[#05070a]/60">
                    <Loader2 aria-hidden className="h-4 w-4 spin text-white" />
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setImages((prev) => prev.filter((p) => p !== img))}
                  aria-label={`Remove ${img.name}`}
                  className="absolute right-0.5 top-0.5 grid h-6 w-6 place-items-center rounded-full bg-[#05070a]/80 text-white transition hover:bg-[var(--loss)]"
                >
                  <X aria-hidden className="h-3 w-3" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>

          {images.length < 4 && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="grid h-16 w-16 place-items-center gap-0.5 rounded-[10px] border border-dashed border-[var(--line)] text-[var(--ink-3)] transition hover:border-[var(--accent-line)] hover:text-[var(--ink)]"
            >
              <Camera aria-hidden className="h-4 w-4" />
              <span className="text-[10px] font-medium">Add</span>
            </button>
          )}
        </div>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        loading={busy}
        icon={<Sparkles aria-hidden className="h-4 w-4" />}
        className="w-full"
      >
        {busy ? "Building your plan…" : "Build the plan"}
      </Button>
      <p className="text-center text-[11.5px] text-[var(--ink-4)]">
        Usually 30–50 seconds. You can watch it work.
      </p>
    </form>
  );
}
