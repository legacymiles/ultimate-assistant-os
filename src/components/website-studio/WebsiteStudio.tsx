"use client";

// ---------------------------------------------------------------------------
// Website Studio — one place to build a website, redesign one, and edit one
// that is already live.
//
// It is the consolidation of three apps: App Builder (start from an idea),
// Website Redesigner (start from an address) and Client Review (edit what is
// live, with the client). They were three front doors, three site lists, four
// build viewers and six lists of design skills, for one job.
//
// Nothing was migrated to make this. Every client website is read and written
// as the Client Review document it already was, with the same id and the same
// link secret; every unbuilt site is the App Builder project it already was.
// The address bar carries which one is open (?site= · ?app= · ?p=), and this
// component is only the question of which screen that means.
//
//   client mode  the same workspace, mounted at the client's own unchanged
//                address (/apps/client-review?site=…), with the owner's tabs
//                removed. Their link, their push notifications and their home
//                screen app all keep working, because none of them moved.
// ---------------------------------------------------------------------------

import { useCallback, useState } from "react";
import type { PreparedMedia } from "@/lib/app-builder/media";
import { readStore, writeStore } from "@/lib/app-builder/useAppBuilder";
import { newProject } from "@/lib/app-builder/engine";
import { combine } from "@/lib/website-studio/skills";
import type { SiteCard } from "@/lib/website-studio/library";
import { useStudio, type StudioTarget } from "@/lib/website-studio/useStudio";
import { admin } from "@/lib/client-review/client";
import { DraftWorkspace } from "./DraftWorkspace";
import { SiteWorkspace } from "./SiteWorkspace";
import { StudioHome } from "./StudioHome";
import "./website-studio.css";

interface Props {
  /**
   * Mounted on the client's own link. The library and the start are the
   * owner's, so in client mode there is only ever the workspace.
   */
  clientToken?: string;
}

export function WebsiteStudio({ clientToken }: Props) {
  const studio = useStudio();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [appTokens, setAppTokens] = useState<Record<string, string>>({});
  const [appError, setAppError] = useState("");

  const target: StudioTarget | null = clientToken ? { kind: "site", token: clientToken } : studio.target;

  /** A hub app gets its review project the first time it is opened. */
  const openApp = useCallback(
    async (slug: string) => {
      if (appTokens[slug]) return;
      setAppError("");
      try {
        const { project } = await admin.ensureApp(slug);
        setAppTokens((m) => ({ ...m, [slug]: project.token }));
      } catch (e) {
        setAppError(e instanceof Error ? e.message : String(e));
      }
    },
    [appTokens],
  );

  if (target?.kind === "app" && !appTokens[target.slug] && !appError) void openApp(target.slug);

  const onPrompt = useCallback(
    async (idea: string, media: PreparedMedia[], picks: string[]) => {
      setBusy(true);
      setNotice("");
      try {
        // The same project App Builder makes, in the same synced store, so
        // ?p=<id> opens it in either place and Jarvis's own hand-off still
        // lands on something this page can open.
        const combo = combine(picks);
        const p = {
          ...newProject(idea || "Recreate what these references show"),
          origin: "app" as const,
          pending: true,
          ...(picks.length ? { skills: combo.order } : {}),
          ...(picks.length ? { look: { skill: combo.base, at: new Date().toISOString(), by: "owner" as const } } : {}),
        };
        const s = readStore();
        writeStore({ projects: [p, ...s.projects], currentId: p.id });
        studio.reload();
        studio.go({ kind: "draft", id: p.id });
      } finally {
        setBusy(false);
      }
    },
    [studio],
  );

  const onRedesign = useCallback(
    (draftId: string, warning?: string) => {
      if (warning) setNotice(warning);
      studio.reload();
      studio.go({ kind: "draft", id: draftId });
    },
    [studio],
  );

  const onOpen = useCallback(
    (c: SiteCard) => {
      if ("site" in c.open) studio.go({ kind: "site", token: c.open.site });
      else if ("app" in c.open) studio.go({ kind: "app", slug: c.open.app });
      else studio.go({ kind: "draft", id: c.open.draft });
    },
    [studio],
  );

  const home = useCallback(() => studio.go(null), [studio]);

  // Who you are only matters for the library and for opening a website. The
  // question and the prompt box need no account and no round trip, so they are
  // on screen immediately rather than behind a spinner that waits for one.
  if (!studio.me && !target) {
    return (
      <div className="ws-root">
        <StudioHome studio={studio} busy={busy} onPrompt={onPrompt} onRedesign={onRedesign} onOpen={onOpen} notice={notice} />
      </div>
    );
  }

  if (!studio.me) {
    return (
      <div className="ws-root ws-center">
        <span className="ws-spin" aria-label="Opening Website Studio" />
      </div>
    );
  }

  if (!studio.me.signedIn) {
    const next = typeof window === "undefined" ? "/apps/website-studio" : `${window.location.pathname}${window.location.search}`;
    return (
      <div className="ws-root ws-center">
        <div className="ws-empty">
          <h2>{target ? "Your website is ready to look at" : "Website Studio"}</h2>
          <p>{target ? "Sign in to see it and ask for changes." : "Sign in to see your websites."}</p>
          <a className="ws-btn" href={`/signin?next=${encodeURIComponent(next)}`}>
            Sign in
          </a>
        </div>
      </div>
    );
  }

  if (target?.kind === "draft") {
    return (
      <div className="ws-root">
        <DraftWorkspace draftId={target.id} onBack={home} onChanged={studio.reload} />
      </div>
    );
  }

  if (target) {
    const token = target.kind === "site" ? target.token : appTokens[target.slug];
    if (appError) {
      return (
        <div className="ws-root ws-center">
          <div className="ws-empty">
            <h2>Couldn&apos;t open that app</h2>
            <p>{appError}</p>
            <button className="ws-btn" onClick={home}>
              All websites
            </button>
          </div>
        </div>
      );
    }
    if (!token) {
      return (
        <div className="ws-root ws-center">
          <span className="ws-spin" aria-label="Opening" />
        </div>
      );
    }
    return (
      <div className="ws-root">
        <SiteWorkspace key={token} token={token} owner={studio.me.owner} onBack={home} onChanged={studio.reload} />
      </div>
    );
  }

  if (!studio.me.owner) {
    // A client with no site open: their own list, nothing of the owner's.
    return (
      <div className="ws-root ws-center">
        <div className="ws-empty">
          <h2>Your websites</h2>
          <p>Open the link you were sent and your site is here, with somewhere to ask for changes beside it.</p>
          <a className="ws-btn" href="/apps/client-review">
            My websites
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="ws-root">
      <StudioHome studio={studio} busy={busy} onPrompt={onPrompt} onRedesign={onRedesign} onOpen={onOpen} notice={notice} />
    </div>
  );
}
