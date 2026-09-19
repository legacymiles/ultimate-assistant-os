"use client";

import { useState } from "react";
import { Icon } from "../icons";
import { handleFrom, profileUrl, uid } from "@/lib/social-personas/logic";
import { PLATFORM_NAME, SOCIAL_PLATFORMS, type Persona, type SocialPlatform } from "@/lib/social-personas/types";
import { api, type Status } from "./api";
import { Btn, PlatformDot, inputCls } from "./bits";
import { compact } from "./PersonaGrid";
import type { Mutate } from "./SocialPersonas";

const NOTE: Record<SocialPlatform, string> = {
  tiktok: "Reads your videos, captions and view/like counts (TikTok Display API).",
  instagram: "Needs a Business or Creator account. Reads posts, reels, likes and comments.",
  facebook: "Reads a Facebook Page you manage (personal profiles can't be read by apps).",
};

export function Accounts({
  persona,
  status,
  mutate,
  flash,
  syncAccount,
}: {
  persona: Persona;
  status: Status | null;
  mutate: Mutate;
  flash: (t: string, bad?: boolean) => void;
  syncAccount: (personaId: string, accountId: string) => Promise<void>;
}) {
  const [adding, setAdding] = useState<SocialPlatform | null>(null);
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [help, setHelp] = useState<SocialPlatform | null>(null);

  const addHandle = (platform: SocialPlatform) => {
    const h = handleFrom(handle);
    if (!h) return;
    mutate(persona.id, (p) => ({ ...p, accounts: [...p.accounts, { id: uid("a_"), platform, handle: h, url: profileUrl(platform, h) }] }));
    setHandle("");
    setAdding(null);
  };

  const connect = (platform: SocialPlatform) => {
    if (!status?.platforms[platform].configured) {
      setHelp(platform);
      return;
    }
    window.location.href = `/api/social-personas/oauth/${platform}/start?persona=${encodeURIComponent(persona.id)}`;
  };

  return (
    <section>
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-ink-faint">Accounts</h3>
      <div className="space-y-1.5">
        {SOCIAL_PLATFORMS.map((platform) => {
          const accs = persona.accounts.filter((a) => a.platform === platform);
          return (
            <div key={platform} className="rounded-lg border border-line bg-canvas/40 p-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                <PlatformDot platform={platform} /> {PLATFORM_NAME[platform]}
                <span className="ml-auto flex gap-1">
                  <button onClick={() => connect(platform)} className="rounded px-1.5 py-0.5 text-[11px] font-medium text-brand hover:bg-brand/10" title={NOTE[platform]}>
                    Connect
                  </button>
                  <button
                    onClick={() => {
                      setAdding(adding === platform ? null : platform);
                      setHandle("");
                    }}
                    className="rounded px-1.5 py-0.5 text-[11px] font-medium text-ink-muted hover:bg-panel-2 hover:text-ink"
                  >
                    + handle
                  </button>
                </span>
              </div>
              {accs.map((a) => (
                <div key={a.id} className="mt-1.5 flex items-center gap-1.5 text-xs">
                  <a href={a.url || undefined} target="_blank" rel="noreferrer" className="min-w-0 truncate text-ink-muted hover:text-ink">
                    @{a.handle || "syncing…"}
                  </a>
                  {a.followers != null && <span className="text-ink-faint">{compact(a.followers)} followers</span>}
                  <span className="ml-auto flex items-center gap-1">
                    {a.connectionId ? (
                      <>
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400" title={a.lastSyncAt ? `Last sync ${new Date(a.lastSyncAt).toLocaleString()}` : ""}>
                          connected
                        </span>
                        <button
                          title="Sync posts now"
                          disabled={busy === a.id}
                          onClick={async () => {
                            setBusy(a.id);
                            await syncAccount(persona.id, a.id);
                            setBusy(null);
                          }}
                          className="rounded p-1 text-ink-muted hover:bg-panel-2 hover:text-ink disabled:animate-spin"
                        >
                          <Icon.Refresh width={12} height={12} />
                        </button>
                      </>
                    ) : (
                      <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] text-ink-faint" title="Handle only — import posts by link in Content, or Connect to sync automatically">
                        handle only
                      </span>
                    )}
                    <button
                      title="Remove account"
                      onClick={() => {
                        if (a.connectionId) void api.disconnect(a.connectionId);
                        mutate(persona.id, (p) => ({ ...p, accounts: p.accounts.filter((x) => x.id !== a.id) }));
                      }}
                      className="rounded p-1 text-ink-faint hover:bg-panel-2 hover:text-rose-400"
                    >
                      <Icon.Trash width={12} height={12} />
                    </button>
                  </span>
                </div>
              ))}
              {adding === platform && (
                <div className="mt-1.5 flex gap-1">
                  <input
                    autoFocus
                    className={inputCls + " py-1 text-xs"}
                    placeholder="@handle or profile link"
                    value={handle}
                    onChange={(e) => setHandle(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addHandle(platform)}
                  />
                  <Btn onClick={() => addHandle(platform)} disabled={!handleFrom(handle)}>
                    Add
                  </Btn>
                </div>
              )}
              {help === platform && status && (
                <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] leading-relaxed text-ink-muted">
                  Login-connect for {PLATFORM_NAME[platform]} needs a developer app. Create one at{" "}
                  <a className="text-brand underline" href={status.platforms[platform].setupUrl} target="_blank" rel="noreferrer">
                    {new URL(status.platforms[platform].setupUrl).hostname}
                  </a>
                  , add the redirect URL{" "}
                  <code className="break-all rounded bg-panel-2 px-1 text-ink">{`${location.origin}/api/social-personas/oauth/${platform}/callback`}</code>, then fill these in{" "}
                  <code className="text-ink">.env.local</code>:
                  <pre className="mt-1 rounded bg-panel-2 p-1.5 text-ink">{status.platforms[platform].env.map((e) => `${e}=`).join("\n")}</pre>
                  <span className="mt-1 block">{NOTE[platform]} Until then, add the handle and import posts by link.</span>
                  <button className="mt-1 text-ink-faint underline" onClick={() => setHelp(null)}>
                    close
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {persona.accounts.some((a) => a.connectionId) && (
        <Btn
          className="mt-2 w-full justify-center"
          disabled={busy === "all"}
          onClick={async () => {
            setBusy("all");
            for (const a of persona.accounts) if (a.connectionId) await syncAccount(persona.id, a.id);
            setBusy(null);
            flash("All connected accounts synced.");
          }}
        >
          <Icon.Refresh width={12} height={12} /> {busy === "all" ? "Syncing…" : "Sync all"}
        </Btn>
      )}
    </section>
  );
}
