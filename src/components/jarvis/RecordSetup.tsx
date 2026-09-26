"use client";

// ---------------------------------------------------------------------------
// Getting the browser extension in, in one press.
//
// A web page cannot install an extension — Chrome removed that in 2018, and no
// page may open chrome://extensions. Exactly two actions are permanently the
// owner's: switching Developer mode on, and pressing Load unpacked. Everything
// that used to sit around those two is gone:
//
//   · the download is BUILT for this hub — its config.js carries this origin
//     and a token minted a second ago, so nothing is ever pasted,
//   · a .cmd inside it moves the folder somewhere permanent and leaves its path
//     on the clipboard for the folder picker, and
//   · the extension answers a ping on this origin, so this page knows when it
//     lands and says so by itself rather than asking the owner whether it did.
//
// Which is why there is no "I've done it" button anywhere here.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import {
  configureExtension,
  extensionMark,
  pingExtension,
  type ExtensionState,
} from "@/lib/jarvis/record/bridge";

type Busy = "" | "download" | "connect" | "token";

export interface RecordSetup {
  /** A token exists on the account — some browser, somewhere, is connected. */
  account: boolean | null;
  /** null until the first look at this browser. */
  extension: ExtensionState | null;
  /** Installed here, holding a working token, and pointed at this hub. */
  ready: boolean;
  /** It holds a token, but for a different hub. */
  elsewhere: string | null;
  /** It holds a token this hub no longer accepts — minting one kills the rest. */
  stale: boolean;
  busy: Busy;
  error: string;
  /** Downloaded, and now watching for the extension to appear. */
  waiting: boolean;
  /** A dead token was silently replaced on this visit. Worth one line. */
  healed: boolean;
  token: string | null;
  download: () => Promise<void>;
  connect: () => Promise<void>;
  revealToken: () => Promise<void>;
  dismissToken: () => void;
}

/**
 * The connection, watched from both ends: the account's token on the server and
 * the extension in this browser.
 *
 * The ping is re-run whenever the window regains focus, because the one moment
 * the answer changes is when the owner comes back from the extensions page.
 */
export function useRecordSetup(): RecordSetup {
  const [account, setAccount] = useState<boolean | null>(null);
  const [extension, setExtension] = useState<ExtensionState | null>(null);
  const [busy, setBusy] = useState<Busy>("");
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [healed, setHealed] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  /** A freshly loaded copy is handed a token once, not on every re-render. */
  const adopted = useRef(false);

  const mintToken = useCallback(async (): Promise<string> => {
    const res = await fetch("/api/jarvis/record/token", { method: "POST" });
    const data = (await res.json()) as { token?: string; error?: string };
    if (!res.ok || !data.token) throw new Error(data.error ?? "Could not mint a token.");
    setAccount(true);
    return data.token;
  }, []);

  const look = useCallback(async (): Promise<ExtensionState> => {
    // The content script stamps the document at document_start, so its absence
    // is already conclusive and there is no ping to wait out.
    const state = extensionMark()
      ? await pingExtension()
      : { installed: false, configured: false, works: false };
    setExtension(state);
    return state;
  }, []);

  // The account side, once.
  useEffect(() => {
    let alive = true;
    void fetch("/api/jarvis/record/token")
      .then((r) => r.json())
      .then((d: { connected?: boolean }) => {
        if (alive) setAccount(Boolean(d.connected));
      })
      .catch(() => {
        if (alive) setAccount(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  // The browser side: on open, on focus, and on a beat while an install is in
  // flight — the one stretch where what changes the answer happens outside this
  // tab entirely.
  useEffect(() => {
    let alive = true;
    const check = () => {
      void look().then((state) => {
        if (alive && state.installed) setWaiting(false);
      });
    };
    check();
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const beat = waiting ? window.setInterval(check, 2000) : 0;
    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      if (beat) window.clearInterval(beat);
    };
  }, [waiting, look]);

  // An extension that is here but cannot get in is fixed rather than reported.
  //
  // Two ways it happens: a copy loaded straight out of the repo, which was never
  // given a token, and a copy whose token was replaced by a later download
  // somewhere. Both look like a dead end to the owner and both have the same
  // one-line repair, so doing it and saying so beats asking.
  //
  // Once per page load, because minting a token takes it away from every other
  // browser: two hubs open side by side each heal once and the last one wins,
  // rather than trading the connection back and forth forever. An extension
  // pointed at a DIFFERENT hub is left alone entirely — that is a decision, not
  // a fault.
  useEffect(() => {
    if (!extension?.installed || adopted.current) return;
    if (extension.configured && extension.works) return;
    if (extension.hubUrl && extension.hubUrl !== window.location.origin) return;
    const replacing = extension.configured;
    adopted.current = true;
    void (async () => {
      try {
        const fresh = await mintToken();
        const failed = await configureExtension(fresh);
        if (failed) setError(failed);
        else {
          if (replacing) setHealed(true);
          await look();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not hand the extension a token.");
      }
    })();
  }, [extension, mintToken, look]);

  const download = useCallback(async () => {
    setBusy("download");
    setError("");
    try {
      const res = await fetch("/api/jarvis/record/extension", { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Could not build the download.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "jarvis-record.zip";
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setAccount(true);
      setWaiting(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the download.");
    } finally {
      setBusy("");
    }
  }, []);

  const connect = useCallback(async () => {
    setBusy("connect");
    setError("");
    try {
      const fresh = await mintToken();
      const failed = await configureExtension(fresh);
      if (failed) throw new Error(failed);
      await look();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the extension.");
    } finally {
      setBusy("");
    }
  }, [mintToken, look]);

  const revealToken = useCallback(async () => {
    setBusy("token");
    setError("");
    try {
      setToken(await mintToken());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mint a token.");
    } finally {
      setBusy("");
    }
  }, [mintToken]);

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const elsewhere =
    extension?.installed && extension.configured && extension.hubUrl && extension.hubUrl !== origin
      ? extension.hubUrl
      : null;
  // Not auto-fixed, unlike an extension with no token at all: a second browser
  // quietly minting itself a working key would take the first one's away.
  const stale = Boolean(extension?.installed && extension.configured && !extension.works && !elsewhere);

  return {
    account,
    extension,
    ready: Boolean(extension?.installed && extension.configured && extension.works && !elsewhere),
    elsewhere,
    stale,
    busy,
    error,
    waiting,
    healed,
    token,
    download,
    connect,
    revealToken,
    dismissToken: () => setToken(null),
  };
}

const CHROME_URL = "chrome://extensions";

const quiet =
  "inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed disabled:opacity-40";
const loud =
  "inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-brand-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 disabled:cursor-not-allowed disabled:opacity-40";

/** Green when it works, brand while it is on its way, dim when it is not there. */
export function Lamp({ tone }: { tone: "on" | "pending" | "off" }) {
  return (
    <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
      {tone === "pending" && (
        <span className="absolute inset-0 animate-ping rounded-full bg-brand/70 [animation-duration:1.6s]" />
      )}
      <span
        className={`relative h-2 w-2 rounded-full ${
          tone === "on"
            ? "bg-core shadow-[0_0_8px_-1px] shadow-core/80"
            : tone === "pending"
              ? "bg-brand"
              : "bg-ink-faint/60"
        }`}
      />
    </span>
  );
}

function CopyChip({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title={`Copy ${label}`}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 2000);
        });
      }}
      className="group inline-flex max-w-full items-center gap-1.5 rounded border border-line bg-canvas px-1.5 py-0.5 align-middle font-mono text-[11px] text-ink transition hover:border-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
    >
      <span className="truncate">{text}</span>
      {done ? (
        <Icon.Check className="h-3 w-3 shrink-0 text-core" />
      ) : (
        <Icon.Copy className="h-3 w-3 shrink-0 text-ink-faint transition group-hover:text-ink-muted" />
      )}
    </button>
  );
}

/** A numbered step. The numbers are the information here — order is the point. */
function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-px w-3 shrink-0 text-right font-mono text-[10px] tabular-nums text-ink-faint">{n}</span>
      <span>{children}</span>
    </li>
  );
}

/**
 * Unzip, install, load. The first step looks skippable and is not: double-
 * clicking the installer inside the zip window makes Windows unpack that one
 * file alone, so it finds nothing to copy. The installer now refuses that, but
 * the instruction has to say it too.
 */
function Steps({ waiting }: { waiting: boolean }) {
  return (
    <ol className="space-y-2 text-[11px] leading-relaxed text-ink-muted">
      <Step n={1}>
        <span className="font-medium text-ink">Unzip it first.</span> Right-click{" "}
        <span className="text-ink">jarvis-record.zip</span> → <span className="text-ink">Extract All</span>.
        <span className="mt-0.5 block text-ink-faint">
          Running anything straight from the zip window does nothing: Windows only unpacks the one file you click.
        </span>
      </Step>
      <Step n={2}>
        From the unzipped folder, run <span className="font-medium text-ink">Install on Windows.cmd</span>. It parks the
        extension somewhere permanent, copies that path, and opens the extensions page.
        <span className="mt-0.5 block text-ink-faint">
          Rather not run it? Then move the unzipped folder out of Downloads yourself — a browser reads an unpacked
          extension off disk forever, so it has to stay put — and do step 3 with that folder.
        </span>
      </Step>
      <Step n={3}>
        In <CopyChip text={CHROME_URL} label="the extensions page address" />, turn on{" "}
        <span className="font-medium text-ink">Developer mode</span> (top right), press{" "}
        <span className="font-medium text-ink">Load unpacked</span>, and paste the folder.
      </Step>
      <li className="flex items-center gap-2 pt-0.5 text-ink-faint">
        <Lamp tone={waiting ? "pending" : "off"} />
        <span>
          {waiting
            ? "Watching for it. This page will say so itself — the token is already inside the download."
            : "Nothing to fill in afterwards: the download already carries this hub and its token."}
        </span>
      </li>
    </ol>
  );
}

/**
 * One row of truth plus whatever action that truth implies, and the steps
 * underneath while they are still owed.
 *
 * `frame` draws its own border, for where it stands alone; on the Record tab it
 * sits inside a section that has one already.
 */
export function RecordSetupPanel({ setup, frame = false }: { setup: RecordSetup; frame?: boolean }) {
  const { account, extension, ready, elsewhere, stale, busy, error, waiting, healed, token } = setup;
  const [openSteps, setOpenSteps] = useState(false);
  const missing = extension !== null && !extension.installed;
  // Instructions for a thing that has already happened are clutter, so the
  // moment the extension lands they roll themselves back up.
  const show = !ready && (openSteps || waiting || (missing && account === false));

  const headline = ready
    ? "This browser is connected"
    : elsewhere
      ? "The extension here is pointed at another hub"
      : stale
        ? "The extension here is holding a token this hub no longer accepts"
        : extension === null
          ? "Checking this browser"
          : extension.installed
            ? "The extension is here but has no token"
            : account
              ? "Connected in another browser, not this one"
              : "The extension is not in this browser yet";

  const aside = ready
    ? `${extension?.version ? `v${extension.version} · ` : ""}the applications you fill in feed your Record`
    : elsewhere
      ? elsewhere
      : stale
        ? "downloading it again anywhere replaces the old one"
        : extension?.installed
          ? "handing it one now"
          : "one download, then two clicks in the browser";

  return (
    <div className={frame ? "rounded-xl border border-line bg-panel" : ""}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
        {/* Lamp and sentence stay one unit; the clause after it drops to its own
            line on a phone rather than being cut off mid-word. */}
        <div className="flex w-full min-w-0 items-center gap-2.5 sm:w-auto sm:flex-1">
          <Lamp tone={ready ? "on" : waiting || extension === null ? "pending" : "off"} />
          <p className="min-w-0 text-[12px] text-ink">
            {headline}
            <span className="ml-1.5 text-[11px] text-ink-faint max-sm:ml-0 max-sm:block">{aside}</span>
          </p>
        </div>

        <div className="flex items-center gap-2 sm:ml-auto">
          {ready ? (
            <>
              <button
                type="button"
                className={quiet}
                title="Hands this browser a new token. Any other browser holding the old one stops working."
                disabled={busy !== ""}
                onClick={() => void setup.connect()}
              >
                <Icon.Refresh className="h-3.5 w-3.5" />
                {busy === "connect" ? "Rotating…" : "New token"}
              </button>
              <button
                type="button"
                className={quiet}
                title="For another browser or another computer. It carries a new token, so this one stops working."
                disabled={busy !== ""}
                onClick={() => void setup.download()}
              >
                <Icon.Download className="h-3.5 w-3.5" />
                {busy === "download" ? "Building…" : "Download again"}
              </button>
            </>
          ) : elsewhere ? (
            <button type="button" className={loud} disabled={busy !== ""} onClick={() => void setup.connect()}>
              <Icon.Link className="h-3.5 w-3.5" />
              {busy === "connect" ? "Pointing it here…" : "Point it at this hub"}
            </button>
          ) : stale ? (
            <button
              type="button"
              className={loud}
              title="Gives this browser a working token. Any other browser still holding one stops working."
              disabled={busy !== ""}
              onClick={() => void setup.connect()}
            >
              <Icon.Refresh className="h-3.5 w-3.5" />
              {busy === "connect" ? "Reconnecting…" : "Reconnect this browser"}
            </button>
          ) : extension?.installed ? (
            <button type="button" className={quiet} disabled={busy !== ""} onClick={() => void setup.connect()}>
              <Icon.Link className="h-3.5 w-3.5" />
              {busy === "connect" ? "Connecting…" : "Connect it"}
            </button>
          ) : (
            <>
              <button
                type="button"
                className={loud}
                disabled={busy !== "" || extension === null}
                onClick={() => {
                  setOpenSteps(true);
                  void setup.download();
                }}
              >
                <Icon.Download className="h-3.5 w-3.5" />
                {busy === "download" ? "Building it…" : waiting ? "Download again" : "Set up in one click"}
              </button>
              {!waiting && (
                <button
                  type="button"
                  className={quiet}
                  aria-expanded={openSteps}
                  onClick={() => setOpenSteps((v) => !v)}
                >
                  {openSteps ? "Hide" : "What happens"}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {error && (
        <p className="border-t border-line-soft px-3 py-2 text-[11px] leading-relaxed text-rose-300">{error}</p>
      )}

      {/* Said once, because a connection quietly replacing itself is the kind of
          thing that should be visible even when it went right. */}
      {healed && !error && (
        <p className="flex items-start gap-1.5 border-t border-line-soft px-3 py-2 text-[11px] leading-relaxed text-ink-faint">
          <Icon.Check className="mt-0.5 h-3 w-3 shrink-0 text-core" />
          <span>
            This browser was holding a key that had been replaced, so it has been given a working one. Any other
            computer you had set up will need its own <span className="text-ink-muted">Reconnect</span>.
          </span>
        </p>
      )}

      {/* One authored move: the steps unroll rather than appear. */}
      <div
        className={`grid overflow-hidden px-3 transition-[grid-template-rows,opacity,padding] duration-300 ease-out ${
          show ? "grid-rows-[1fr] border-t border-line-soft py-2.5 opacity-100" : "grid-rows-[0fr] py-0 opacity-0"
        }`}
      >
        <div className="min-h-0">
          <Steps waiting={waiting} />

          <details className="mt-2.5 border-t border-line-soft pt-2">
            <summary className="cursor-pointer text-[11px] text-ink-faint transition hover:text-ink-muted">
              Setting it up by hand instead
            </summary>
            <p className="mt-1.5 max-w-[74ch] text-[11px] leading-relaxed text-ink-faint">
              The source is in <code className="text-ink-muted">extension/jarvis-record</code> of this repo. Loaded
              that way it knows nothing, so it needs telling: mint a token here, then paste it and{" "}
              <code className="text-ink-muted">{typeof window === "undefined" ? "" : window.location.origin}</code>{" "}
              into the extension&apos;s own options. A token is shown once, and minting one stops the old one working.
            </p>
            {token ? (
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-canvas px-2.5 py-1.5 font-mono text-[11px] text-ink">
                  {token}
                </code>
                <CopyChip text={token} label="the token" />
                <button type="button" className={quiet} onClick={setup.dismissToken}>
                  Done
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={`${quiet} mt-2`}
                disabled={busy !== ""}
                onClick={() => void setup.revealToken()}
              >
                <Icon.Key className="h-3.5 w-3.5" />
                {busy === "token" ? "Minting…" : "Show me a token"}
              </button>
            )}
          </details>
        </div>
      </div>
    </div>
  );
}

/**
 * The same thing reached from the Chat tab, where Record is something you
 * remember mid-sentence rather than a tab you set out for.
 *
 * It expands above the composer instead of opening a dialog: nothing here needs
 * the rest of the tab taken away, and a half-typed message has to survive it.
 */
export function RecordSetupDock({
  setup,
  onClose,
  onOpenRecord,
}: {
  setup: RecordSetup;
  onClose: () => void;
  onOpenRecord?: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-[760px] pb-2">
      <div className="rounded-2xl border border-line bg-panel-2">
        <div className="flex items-start justify-between gap-3 px-3 pt-2.5">
          <p className="max-w-[72ch] text-[11px] leading-relaxed text-ink-faint">
            The extension saves what you type into a job or benefits application, and fills the next one from what your
            Record already knows.
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded p-0.5 text-ink-faint transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <Icon.Close className="h-3.5 w-3.5" />
          </button>
        </div>
        <RecordSetupPanel setup={setup} />
        {onOpenRecord && (
          <div className="border-t border-line-soft px-3 py-2">
            <button
              type="button"
              onClick={onOpenRecord}
              className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              Open the Record tab
              <Icon.ArrowRight className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
