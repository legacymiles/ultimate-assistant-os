"use client";

// ---------------------------------------------------------------------------
// Connect setup — the one time a platform's developer app gets made.
//
// TikTok and Meta only let apps log people in through a developer app the
// site owner registers; nobody can skip that. This screen makes it as short as
// it can be: one platform at a time, three steps, every value the portal asks
// for one tap to copy, and the two keys pasted HERE (saved on the server,
// working at once — no hosting dashboard, no redeploy). After it, everyone's
// Connect button is a single login.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { Icon } from "../icons";
import { PLATFORM_NAME, type ConnectablePlatform } from "@/lib/social-personas/types";
import { Btn, PlatformDot, inputCls } from "./bits";

interface PlatformSetup {
  platform: ConnectablePlatform;
  ready: boolean;
  source: "env" | "saved" | null;
  idHint: string | null;
  setupUrl: string;
  redirectUri: string;
  scopes: string;
}
interface SetupInfo {
  platforms: PlatformSetup[];
  urls: { site: string; privacy: string; terms: string; dataDeletion: string };
}

interface Step {
  title: string;
  open?: { label: string; href: string };
  todo: string[];
  copy: ("site" | "privacy" | "terms" | "dataDeletion" | "redirect" | "scopes")[];
}

const GUIDE: Record<ConnectablePlatform, { idLabel: string; secretLabel: string; where: string; steps: Step[] }> = {
  tiktok: {
    idLabel: "Client key",
    secretLabel: "Client secret",
    where: "Your app › App details — the two keys at the top.",
    steps: [
      {
        title: "Make the app",
        open: { label: "Open TikTok for Developers", href: "https://developers.tiktok.com/apps" },
        todo: ["Sign in, press Connect an app, give it a name and icon.", "Under Platforms tick Web and paste the site address.", "Paste the Terms and Privacy links below into their boxes."],
        copy: ["site", "terms", "privacy"],
      },
      {
        title: "Add Login Kit and Content Posting",
        todo: ["Products › Add products: Login Kit and Content Posting API (Upload).", "In Login Kit, paste the redirect URL below.", "Under Scopes, tick the ones listed below."],
        copy: ["redirect", "scopes"],
      },
    ],
  },
  instagram: {
    idLabel: "Instagram app ID",
    secretLabel: "Instagram app secret",
    where: "Instagram › API setup with Instagram login — the Instagram app ID and secret (not the Meta App ID at the top of the page; they're different).",
    steps: [
      {
        title: "Make the app",
        open: { label: "Open Meta for Developers", href: "https://developers.facebook.com/apps/creation/" },
        todo: ["Create app › use case Manage messaging & content on Instagram.", "App settings › Basic: paste the Privacy, Terms and Data deletion links below."],
        copy: ["privacy", "terms", "dataDeletion"],
      },
      {
        title: "Turn on Instagram login",
        todo: [
          "Instagram › API setup with Instagram login › Set up Instagram business login.",
          "Paste the redirect URL below as the OAuth redirect URI.",
          "Add your Instagram account under App roles › Instagram testers, then accept it in Instagram (Settings › Apps and websites).",
        ],
        copy: ["redirect"],
      },
    ],
  },
  facebook: {
    idLabel: "App ID",
    secretLabel: "App secret",
    where: "App settings › Basic — App ID and App secret (press Show).",
    steps: [
      {
        title: "Make the app",
        open: { label: "Open Meta for Developers", href: "https://developers.facebook.com/apps/creation/" },
        todo: ["Create app › use case Manage everything on your Page.", "App settings › Basic: paste the Privacy, Terms and Data deletion links below."],
        copy: ["privacy", "terms", "dataDeletion"],
      },
      {
        title: "Turn on Facebook Login",
        todo: ["Facebook Login for Business › Settings: paste the redirect URL below into Valid OAuth Redirect URIs.", "Permissions: add pages_show_list, pages_read_engagement, pages_read_user_content and pages_manage_posts."],
        copy: ["redirect"],
      },
    ],
  },
};

const COPY_LABEL: Record<Step["copy"][number], string> = {
  site: "Site address",
  privacy: "Privacy policy",
  terms: "Terms of service",
  dataDeletion: "Data deletion",
  redirect: "Redirect URL",
  scopes: "Scopes",
};

export function ConnectSetup({
  initial,
  onClose,
  onReady,
  onConnect,
}: {
  initial?: ConnectablePlatform;
  onClose: () => void;
  /** Keys saved — refresh whatever shows "connectable". */
  onReady: () => void;
  /** Start the login for this platform (shown once it's ready). */
  onConnect?: (p: ConnectablePlatform) => void;
}) {
  const [info, setInfo] = useState<SetupInfo | null>(null);
  const [error, setError] = useState("");
  const [platform, setPlatform] = useState<ConnectablePlatform>(initial ?? "tiktok");
  const [id, setId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/social-personas/setup", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Couldn't load the setup.");
      setInfo(j);
      setError("");
    } catch (e) {
      setError((e as Error).message === "This endpoint is private." ? "Only the site owner can set up platform connections." : (e as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  useEffect(() => {
    setId("");
    setSecret("");
    setMsg(null);
  }, [platform]);

  const p = info?.platforms.find((x) => x.platform === platform);
  const guide = GUIDE[platform];
  const value = (k: Step["copy"][number]) =>
    !info || !p ? "" : k === "redirect" ? p.redirectUri : k === "scopes" ? p.scopes : info.urls[k];

  const copy = async (k: string, v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      setCopied(k);
      window.setTimeout(() => setCopied(""), 1500);
    } catch {
      setMsg({ text: "Couldn't reach the clipboard — select the text and copy it.", bad: true });
    }
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/social-personas/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform, id, secret }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (!r || !r.ok) return setMsg({ text: j.error || "Couldn't save — check your connection and try again.", bad: true });
    setId("");
    setSecret("");
    setMsg({ text: `${PLATFORM_NAME[platform]} is ready. Anyone can now press Connect and sign in.` });
    await load();
    onReady();
  };

  const forget = async () => {
    await fetch(`/api/social-personas/setup?platform=${platform}`, { method: "DELETE" }).catch(() => null);
    await load();
    onReady();
  };

  return (
    <div className="fixed inset-0 z-[999] flex items-end justify-center sm:items-center sm:p-3" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/70" />
      <div
        role="dialog"
        aria-label="Connect setup"
        className="ps-sheet relative flex max-h-[94dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-line bg-panel shadow-2xl sm:rounded-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <span className="ps-mark" aria-hidden />
          <h2 className="text-base font-semibold text-ink">Connect setup</h2>
          <span className="hidden text-xs text-ink-faint sm:inline">— once per platform, then Connect is one tap for everyone</span>
          <button onClick={onClose} className="ml-auto rounded-lg p-1 text-ink-muted hover:bg-panel-2 hover:text-ink" aria-label="Close">
            <Icon.Close width={16} height={16} />
          </button>
        </div>

        <div className="flex gap-1 border-b border-line px-3 pt-2" role="tablist">
          {(["tiktok", "instagram", "facebook"] as ConnectablePlatform[]).map((x) => {
            const ready = info?.platforms.find((y) => y.platform === x)?.ready;
            return (
              <button
                key={x}
                role="tab"
                aria-selected={platform === x}
                onClick={() => setPlatform(x)}
                className={"-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium " + (platform === x ? "border-brand text-ink" : "border-transparent text-ink-muted hover:text-ink")}
              >
                <PlatformDot platform={x} /> {PLATFORM_NAME[x]}
                {ready ? <Icon.Check width={12} height={12} className="text-emerald-400" aria-label="ready" /> : <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-label="not set up" />}
              </button>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-3">
          {error && <p className="rounded-lg border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-sm text-rose-300">{error}</p>}
          {!info && !error && <p className="text-sm text-ink-muted">Loading…</p>}

          {p && p.ready && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5 text-sm">
              <Icon.Check width={16} height={16} className="text-emerald-400" />
              <span className="text-ink">
                {PLATFORM_NAME[platform]} is ready <span className="text-ink-faint">(key {p.idHint}, {p.source === "env" ? "from the site's environment" : "saved here"})</span>
              </span>
              <span className="ml-auto flex gap-1.5">
                {onConnect && (
                  <Btn primary onClick={() => onConnect(platform)}>
                    Connect {PLATFORM_NAME[platform]} now
                  </Btn>
                )}
                {p.source === "saved" && <Btn onClick={() => void forget()}>Replace keys</Btn>}
              </span>
            </div>
          )}

          {p && !p.ready && (
            <ol className="space-y-3">
              {guide.steps.map((s, i) => (
                <li key={s.title} className="rounded-xl border border-line bg-canvas/40 p-3">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand/20 text-[11px] font-bold text-brand">{i + 1}</span>
                    <span className="text-sm font-semibold text-ink">{s.title}</span>
                    {s.open && (
                      <a href={s.open.href} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] text-ink-muted hover:text-ink">
                        <Icon.Launch width={11} height={11} /> {s.open.label}
                      </a>
                    )}
                  </div>
                  <ul className="mb-2 space-y-0.5 pl-7 text-xs text-ink-muted [&>li]:list-disc">
                    {s.todo.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                  <div className="space-y-1 pl-7">
                    {s.copy.map((k) => (
                      <div key={k} className="flex items-center gap-2 text-[11px]">
                        <span className="w-28 shrink-0 text-ink-faint">{COPY_LABEL[k]}</span>
                        <code className="min-w-0 flex-1 truncate rounded bg-panel-2 px-1.5 py-1 text-ink" title={value(k)}>
                          {value(k)}
                        </code>
                        <button onClick={() => void copy(k, value(k))} className="shrink-0 rounded-md border border-line px-2 py-1 text-ink-muted hover:text-ink" aria-label={`Copy ${COPY_LABEL[k]}`}>
                          {copied === k ? <Icon.Check width={11} height={11} className="text-emerald-400" /> : <Icon.Copy width={11} height={11} />}
                        </button>
                      </div>
                    ))}
                  </div>
                </li>
              ))}
              <li className="rounded-xl border border-brand/40 bg-brand/5 p-3">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-white">{guide.steps.length + 1}</span>
                  <span className="text-sm font-semibold text-ink">Paste the two keys</span>
                </div>
                <p className="mb-2 pl-7 text-[11px] text-ink-faint">{guide.where}</p>
                <div className="grid gap-2 pl-7 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-ink-faint">{guide.idLabel}</span>
                    <input className={inputCls + " font-mono text-xs"} value={id} onChange={(e) => setId(e.target.value)} autoComplete="off" spellCheck={false} />
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-ink-faint">{guide.secretLabel}</span>
                    <input className={inputCls + " font-mono text-xs"} type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" spellCheck={false} />
                  </label>
                </div>
                <div className="mt-2 flex items-center gap-2 pl-7">
                  <Btn primary disabled={busy || !id.trim() || !secret.trim()} onClick={() => void save()}>
                    <Icon.Check width={12} height={12} /> {busy ? "Saving…" : `Save — ${PLATFORM_NAME[platform]} is ready`}
                  </Btn>
                  <span className="text-[10px] text-ink-faint">Kept on the server only. Works right away — no redeploy.</span>
                </div>
              </li>
            </ol>
          )}

          {msg && <p className={"rounded-lg px-3 py-2 text-sm " + (msg.bad ? "border border-rose-500/40 text-rose-300" : "border border-emerald-500/30 text-emerald-300")}>{msg.text}</p>}

          <p className="text-[11px] leading-relaxed text-ink-faint">
            While the developer app is new (Development mode), you and anyone you add as a tester can connect — that covers your own accounts. To let any user connect, submit the app for {platform === "tiktok" ? "TikTok's review" : "Meta's App Review"} from the same portal; the privacy, terms and data-deletion pages above are what they check.
          </p>
        </div>
      </div>
    </div>
  );
}
