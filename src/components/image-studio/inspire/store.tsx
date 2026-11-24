"use client";

// ---------------------------------------------------------------------------
// One context for all of Inspire, so the five screens behave as one system:
// a chip saved under an image is in the Builder's "Saved" drawer at once, a
// Remix lands in the Builder with the image's ingredients loaded, a reverse-
// engineered prompt opens in the Builder, and every save shows up in the
// Library and its collections without a reload.
// ---------------------------------------------------------------------------

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { mergeChips } from "@/lib/image-studio/inspire/assemble";
import type { DeliverableId } from "@/lib/image-studio/inspire/deliverables";
import type { Chip, Collection, InspireImage, LibraryItem, Me, PromptOrigin, ReferencePurpose } from "@/lib/image-studio/inspire/types";
import { api, copyText } from "./api";

export type View = "explore" | "builder" | "reverse" | "library" | "collections" | "moderation";
export const VIEWS: View[] = ["explore", "builder", "reverse", "library", "collections", "moderation"];

export interface BuilderRef {
  id: string;
  /** The stored private image behind this reference. */
  imageId: string;
  src: string;
  name: string;
  purpose: ReferencePurpose;
}

export interface BuilderState {
  deliverable: DeliverableId;
  chips: Chip[];
  freeText: string;
  /** A hand-edited prompt; replaces the chip sentence while set. */
  override: string | null;
  refs: BuilderRef[];
  /** Earlier prompts this build grew out of, newest first. */
  history: string[];
  /** Where it came from, for the banner ("Remixing Neon Ronin"). */
  origin: { kind: "remix" | "reverse" | "prompt" | "translate"; label: string } | null;
}

const EMPTY_BUILDER: BuilderState = { deliverable: "artwork", chips: [], freeText: "", override: null, refs: [], history: [], origin: null };
const BUILDER_KEY = "inspire:builder:v1";

interface Toast {
  id: number;
  text: string;
  tone?: "ok" | "bad";
  action?: { label: string; run: () => void };
}

interface LibraryState {
  loaded: boolean;
  items: LibraryItem[];
  collections: Collection[];
  ownImages: InspireImage[];
  images: Record<string, InspireImage>;
}

interface Ctx {
  me: Me | null;
  refreshMe: () => Promise<void>;
  view: View;
  go: (view: View) => void;
  // library
  lib: LibraryState;
  reloadLibrary: () => Promise<void>;
  savedImageIds: Set<string>;
  savedChipTexts: Set<string>;
  saveImage: (img: InspireImage, collectionIds?: string[]) => Promise<void>;
  saveChip: (chip: Chip, opts?: { favorite?: boolean; custom?: boolean; quiet?: boolean }) => Promise<void>;
  saveChips: (chips: Chip[]) => Promise<void>;
  savePrompt: (p: { text: string; chips: Chip[]; origin: PromptOrigin; title?: string; imageId?: string }) => Promise<LibraryItem | null>;
  createCollection: (name: string) => Promise<Collection | null>;
  setItemCollections: (item: LibraryItem, collectionIds: string[]) => Promise<void>;
  removeItem: (item: LibraryItem) => Promise<void>;
  patchItem: (id: string, changes: Record<string, unknown>) => Promise<LibraryItem | null>;
  upsertOwnImage: (img: InspireImage) => void;
  dropOwnImage: (id: string) => void;
  // builder
  builder: BuilderState;
  setBuilder: (fn: (b: BuilderState) => BuilderState) => void;
  sendToBuilder: (chips: Chip[], opts?: { replace?: boolean; origin?: BuilderState["origin"]; history?: string; deliverable?: DeliverableId; override?: string | null }) => void;
  // shell
  detail: InspireImage | string | null;
  openImage: (img: InspireImage | string | null) => void;
  toast: (text: string, opts?: { tone?: "ok" | "bad"; action?: Toast["action"] }) => void;
  toasts: Toast[];
  dismissToast: (id: number) => void;
  /** Runs `fn` when signed in; otherwise opens the sign-in prompt. */
  requireSignIn: (why: string, fn: () => void | Promise<void>) => void;
  signInPrompt: string | null;
  closeSignIn: () => void;
  copy: (text: string, what?: string) => Promise<void>;
}

const InspireCtx = createContext<Ctx | null>(null);

export function useInspire(): Ctx {
  const c = useContext(InspireCtx);
  if (!c) throw new Error("useInspire outside InspireProvider");
  return c;
}

/** Which deliverable fits a gallery category best, for Remix. */
export function deliverableForCategory(category: string): DeliverableId {
  const map: Record<string, DeliverableId> = {
    tshirt: "tshirt",
    streetwear: "hoodie",
    logo: "logo",
    poster: "poster",
    typography: "poster",
    character: "character",
    product: "product",
    photography: "product",
  };
  return map[category] ?? "artwork";
}

export function InspireProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = (VIEWS.includes(params.get("view") as View) ? params.get("view") : "explore") as View;

  const [me, setMe] = useState<Me | null>(null);
  const [lib, setLib] = useState<LibraryState>({ loaded: false, items: [], collections: [], ownImages: [], images: {} });
  const [builder, setBuilderState] = useState<BuilderState>(EMPTY_BUILDER);
  const [detail, setDetail] = useState<InspireImage | string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [signInPrompt, setSignInPrompt] = useState<string | null>(null);
  const toastId = useRef(0);
  const hydrated = useRef(false);

  const toast = useCallback<Ctx["toast"]>((text, opts) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, text, ...opts }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts?.action ? 6000 : 3200);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const fail = useCallback((err: unknown) => toast(err instanceof Error ? err.message : "Something went wrong.", { tone: "bad" }), [toast]);

  const refreshMe = useCallback(async () => {
    try {
      setMe(await api.get<Me>("/me"));
    } catch {
      setMe({ signedIn: false, id: null, email: null, owner: false, local: false, ai: false, plan: { id: "free", label: "Free", aiPerDay: 40, aiUsedToday: 0 } });
    }
  }, []);

  const reloadLibrary = useCallback(async () => {
    try {
      const r = await api.get<Omit<LibraryState, "loaded"> & { signedIn: boolean }>("/library");
      setLib({ loaded: true, items: r.items, collections: r.collections, ownImages: r.ownImages, images: r.images });
    } catch (err) {
      setLib((l) => ({ ...l, loaded: true }));
      fail(err);
    }
  }, [fail]);

  useEffect(() => {
    void refreshMe();
    void reloadLibrary();
  }, [refreshMe, reloadLibrary]);

  // Builder draft survives reloads and moving between screens.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(BUILDER_KEY);
      if (raw) setBuilderState({ ...EMPTY_BUILDER, ...(JSON.parse(raw) as Partial<BuilderState>) });
    } catch {
      /* a corrupt draft is just dropped */
    }
    hydrated.current = true;
  }, []);
  useEffect(() => {
    if (!hydrated.current) return;
    try {
      localStorage.setItem(BUILDER_KEY, JSON.stringify(builder));
    } catch {
      /* storage full or blocked: the draft lives for this tab only */
    }
  }, [builder]);

  const setBuilder = useCallback((fn: (b: BuilderState) => BuilderState) => setBuilderState(fn), []);

  const go = useCallback(
    (v: View) => {
      const q = new URLSearchParams(params.toString());
      // An open collection belongs to the Collections view only.
      q.delete("c");
      if (v === "explore") q.delete("view");
      else q.set("view", v);
      const s = q.toString();
      router.push(`${pathname}${s ? `?${s}` : ""}`, { scroll: false });
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    },
    [params, pathname, router],
  );

  const requireSignIn = useCallback<Ctx["requireSignIn"]>(
    (why, fn) => {
      if (me?.signedIn) void fn();
      else setSignInPrompt(why);
    },
    [me],
  );

  const savedImageIds = useMemo(() => new Set(lib.items.flatMap((i) => (i.kind === "image" ? [i.imageId] : []))), [lib.items]);
  const savedChipTexts = useMemo(() => new Set(lib.items.flatMap((i) => (i.kind === "chip" ? [i.chip.text.toLowerCase()] : []))), [lib.items]);

  const putItem = (item: LibraryItem) =>
    setLib((l) => ({ ...l, items: [item, ...l.items.filter((i) => i.id !== item.id)] }));

  const saveImage = useCallback<Ctx["saveImage"]>(
    async (img, collectionIds = []) =>
      requireSignIn("save images to your library", async () => {
        try {
          const r = await api.post<{ item: LibraryItem; existed?: boolean }>("/library", { kind: "image", imageId: img.id, collectionIds });
          putItem(r.item);
          setLib((l) => ({ ...l, images: { ...l.images, [img.id]: img } }));
          const col = collectionIds.length ? lib.collections.find((c) => c.id === collectionIds[0])?.name : null;
          toast(col ? `Saved to ${col}` : r.existed ? "Already in your library" : "Saved to your library");
        } catch (err) {
          fail(err);
        }
      }),
    [requireSignIn, toast, fail, lib.collections],
  );

  const saveChip = useCallback<Ctx["saveChip"]>(
    async (chip, opts) =>
      requireSignIn("save prompt chips", async () => {
        try {
          const r = await api.post<{ item: LibraryItem; existed?: boolean }>("/library", { kind: "chip", chip, favorite: opts?.favorite, custom: opts?.custom });
          putItem(r.item);
          if (!opts?.quiet) toast(r.existed ? `"${chip.text}" is already in your chips` : `Saved "${chip.text}" to your chips`);
        } catch (err) {
          fail(err);
        }
      }),
    [requireSignIn, toast, fail],
  );

  const saveChips = useCallback<Ctx["saveChips"]>(
    async (chips) =>
      requireSignIn("save prompt chips", async () => {
        try {
          for (const chip of chips) {
            const r = await api.post<{ item: LibraryItem }>("/library", { kind: "chip", chip });
            putItem(r.item);
          }
          toast(`Saved ${chips.length} chip${chips.length === 1 ? "" : "s"}`);
        } catch (err) {
          fail(err);
        }
      }),
    [requireSignIn, toast, fail],
  );

  const savePrompt = useCallback<Ctx["savePrompt"]>(
    async (p) => {
      if (!me?.signedIn) {
        setSignInPrompt("save prompts");
        return null;
      }
      try {
        const r = await api.post<{ item: LibraryItem }>("/library", { kind: "prompt", ...p });
        putItem(r.item);
        toast("Prompt saved to your library");
        return r.item;
      } catch (err) {
        fail(err);
        return null;
      }
    },
    [me, toast, fail],
  );

  const createCollection = useCallback<Ctx["createCollection"]>(
    async (name) => {
      if (!me?.signedIn) {
        setSignInPrompt("make collections");
        return null;
      }
      try {
        const r = await api.post<{ collection: Collection }>("/collections", { name });
        setLib((l) => ({ ...l, collections: [...l.collections, r.collection] }));
        return r.collection;
      } catch (err) {
        fail(err);
        return null;
      }
    },
    [me, fail],
  );

  const patchItem = useCallback<Ctx["patchItem"]>(
    async (id, changes) => {
      try {
        const r = await api.patch<{ item: LibraryItem }>("/library", { id, ...changes });
        setLib((l) => ({ ...l, items: l.items.map((i) => (i.id === id ? r.item : i)) }));
        return r.item;
      } catch (err) {
        fail(err);
        return null;
      }
    },
    [fail],
  );

  const setItemCollections = useCallback<Ctx["setItemCollections"]>(
    async (item, collectionIds) => {
      setLib((l) => ({ ...l, items: l.items.map((i) => (i.id === item.id ? { ...i, collectionIds } : i)) }));
      await patchItem(item.id, { collectionIds });
    },
    [patchItem],
  );

  const removeItem = useCallback<Ctx["removeItem"]>(
    async (item) => {
      setLib((l) => ({ ...l, items: l.items.filter((i) => i.id !== item.id) }));
      try {
        await api.del(`/library?id=${encodeURIComponent(item.id)}`);
        if (item.kind === "reference") setLib((l) => ({ ...l, ownImages: l.ownImages.filter((i) => i.id !== item.imageId) }));
      } catch (err) {
        fail(err);
        void reloadLibrary();
      }
    },
    [fail, reloadLibrary],
  );

  const upsertOwnImage = useCallback((img: InspireImage) => {
    setLib((l) => ({ ...l, ownImages: [img, ...l.ownImages.filter((i) => i.id !== img.id)], images: { ...l.images, [img.id]: img } }));
  }, []);
  const dropOwnImage = useCallback((id: string) => {
    setLib((l) => {
      const images = { ...l.images };
      delete images[id];
      return { ...l, ownImages: l.ownImages.filter((i) => i.id !== id), images, items: l.items.filter((i) => !("imageId" in i) || i.imageId !== id || i.kind === "prompt") };
    });
  }, []);

  const sendToBuilder = useCallback<Ctx["sendToBuilder"]>(
    (chips, opts) => {
      setBuilderState((b) => ({
        ...b,
        chips: opts?.replace ? chips : mergeChips(b.chips, chips),
        ...(opts?.replace ? { freeText: "", override: opts?.override ?? null, history: [] } : {}),
        ...(opts?.override !== undefined && !opts?.replace ? { override: opts.override } : {}),
        ...(opts?.deliverable ? { deliverable: opts.deliverable } : {}),
        ...(opts?.origin ? { origin: opts.origin } : {}),
        history: opts?.history ? [opts.history, ...(opts?.replace ? [] : b.history)].slice(0, 10) : opts?.replace ? [] : b.history,
      }));
      setDetail(null);
      go("builder");
      toast(opts?.replace ? "Loaded into the Prompt Builder" : `Added ${chips.length} chip${chips.length === 1 ? "" : "s"} to the Builder`);
    },
    [go, toast],
  );

  const copy = useCallback(
    async (text: string, what = "Copied") => {
      const ok = await copyText(text);
      toast(ok ? what : "Couldn't copy — select the text and copy it by hand.", ok ? undefined : { tone: "bad" });
    },
    [toast],
  );

  const value: Ctx = {
    me,
    refreshMe,
    view,
    go,
    lib,
    reloadLibrary,
    savedImageIds,
    savedChipTexts,
    saveImage,
    saveChip,
    saveChips,
    savePrompt,
    createCollection,
    setItemCollections,
    removeItem,
    patchItem,
    upsertOwnImage,
    dropOwnImage,
    builder,
    setBuilder,
    sendToBuilder,
    detail,
    openImage: setDetail,
    toast,
    toasts,
    dismissToast,
    requireSignIn,
    signInPrompt,
    closeSignIn: () => setSignInPrompt(null),
    copy,
  };
  return <InspireCtx.Provider value={value}>{children}</InspireCtx.Provider>;
}
