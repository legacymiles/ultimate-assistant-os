"use client";

// The "Your PC" tab: set up the bridge, and see whether it is listening.
//
// yt-dlp is a program on the owner's machine, so the deployed site cannot use
// it. This is where that gets fixed — a token, a folder, one command — and
// where the answer to "why is YouTube missing?" lives.

import { useEffect, useState } from "react";
import { fetchBridgeInfo, mintRunnerToken, type BridgeInfo } from "@/lib/mp3-download/client";
import { cn, formatDate } from "@/lib/utils";
import { Icon } from "../icons";

export function YourPc({
  engineOk,
  onNote,
  onChanged,
}: {
  /** True when this hub can run yt-dlp itself, so the bridge is optional. */
  engineOk: boolean;
  onNote: (text: string) => void;
  onChanged: () => void;
}) {
  const [info, setInfo] = useState<BridgeInfo | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Polled while this tab is open so pressing start on the PC turns the dot
  // green here without a reload — the one moment the owner is watching.
  useEffect(() => {
    let alive = true;
    const read = () => {
      void fetchBridgeInfo()
        .then((next) => {
          if (!alive) return;
          setInfo(next);
          onChanged();
        })
        .catch(() => undefined);
    };
    read();
    const timer = setInterval(read, 5_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // onChanged is a stable callback from the shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mint = async () => {
    setBusy(true);
    setError(null);
    try {
      setToken(await mintRunnerToken());
      setInfo(await fetchBridgeInfo());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not make a token.");
    } finally {
      setBusy(false);
    }
  };

  const copy = (text: string, what: string) => {
    void navigator.clipboard?.writeText(text);
    onNote(`${what} copied.`);
  };

  const state = !info?.hasToken
    ? { tone: "idle", label: "Not set up" }
    : info.online
      ? { tone: "on", label: "Listening" }
      : { tone: "off", label: "Not running" };

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-3 pb-16 pt-4 sm:px-5">
      <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">
        Let your PC fetch what this site cannot
      </h2>
      <p className="mt-1 max-w-[66ch] text-[12.5px] leading-relaxed text-ink-muted">
        yt-dlp is a program on your computer, and the server this page is served from has no such
        program. So instead of pretending, the site hands the job over: it asks your PC, your PC
        downloads it and sends the file back. YouTube then works from the live site, from your
        phone, from anywhere — and the download itself still happens at home.
      </p>

      {/* Status */}
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "inline-block h-2 w-2 shrink-0 rounded-full",
              state.tone === "on" && "bg-core shadow-[0_0_0_3px_rgb(34_197_94_/_0.18)]",
              state.tone === "off" && "bg-amber-400 shadow-[0_0_0_3px_rgb(251_191_36_/_0.15)]",
              state.tone === "idle" && "bg-ink-faint",
            )}
          />
          <span className="text-[13px] font-semibold text-ink">{state.label}</span>
        </span>

        {info?.lastSeen && (
          <span className="text-[11.5px] text-ink-muted">last check-in {formatDate(info.lastSeen)}</span>
        )}
        {info && info.pending > 0 && (
          <span className="rounded-md border border-brand/30 bg-brand/10 px-2 py-0.5 text-[11.5px] text-ink">
            {info.pending} waiting
          </span>
        )}

        {engineOk && (
          <span className="ml-auto text-[11.5px] text-ink-muted">
            This hub runs yt-dlp itself, so the bridge is only needed on the live site.
          </span>
        )}
      </div>

      {/* Setup */}
      <ol className="mt-5 space-y-4">
        <Step n={1} title="Install yt-dlp on that PC, if it is not there already">
          <Command text="pip install -U yt-dlp" onCopy={copy} />
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-muted">
            ffmpeg is what turns the download into an MP3. Without it you still get the audio, just
            in whatever format the site served.
          </p>
        </Step>

        <Step n={2} title="Make a token">
          {token ? (
            <div className="rounded-lg border border-core/30 bg-core/[0.07] p-3">
              <p className="text-[11.5px] font-semibold text-core">
                Copy this now — it is not shown again.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded border border-line bg-canvas px-2 py-1.5 font-mono text-[11.5px] text-ink">
                  {token}
                </code>
                <button
                  type="button"
                  onClick={() => copy(token, "Token")}
                  className="shrink-0 rounded-md border border-line bg-panel-2 px-2.5 py-1.5 text-[11.5px] font-medium text-ink transition hover:border-brand/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
                >
                  Copy
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void mint()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-[13px] font-semibold text-white transition hover:bg-brand-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
            >
              <Icon.Key width={14} height={14} />
              {info?.hasToken ? "Replace the token" : "Create a token"}
            </button>
          )}
          {info?.hasToken && !token && (
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-muted">
              A token already exists. Making a new one stops the old runner until you paste the new
              token in.
            </p>
          )}
          {error && <p className="mt-2 text-[11.5px] text-amber-300">{error}</p>}
        </Step>

        <Step n={3} title="Point the runner at this hub">
          <p className="mb-2 text-[12px] leading-relaxed text-ink-muted">
            On that PC, in the repo, copy{" "}
            <code className="font-mono text-[11px] text-ink">tools/mp3-download-runner/.env.example</code>{" "}
            to <code className="font-mono text-[11px] text-ink">.env</code> and paste the token into{" "}
            <code className="font-mono text-[11px] text-ink">HUB_TOKEN</code>.
          </p>
          <Command text="HUB_URL=https://ultimate-assistant-os.vercel.app" onCopy={copy} />
        </Step>

        <Step n={4} title="Start it and leave it running">
          <Command text="cd tools/mp3-download-runner && npm run runner" onCopy={copy} />
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-muted">
            Or double-click <code className="font-mono text-[11px] text-ink">start-runner.cmd</code>{" "}
            in that folder. The dot above turns green within a few seconds. Nothing listens on a
            port, so there is nothing to forward on your router.
          </p>
        </Step>
      </ol>
    </main>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-xl border border-line bg-panel p-4">
      <div className="flex items-baseline gap-2.5">
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line font-mono text-[10px] tabular-nums text-ink-muted">
          {n}
        </span>
        <h3 className="text-[13.5px] font-semibold text-ink">{title}</h3>
      </div>
      <div className="mt-2.5 pl-[1.9rem]">{children}</div>
    </li>
  );
}

function Command({
  text,
  onCopy,
}: {
  text: string;
  onCopy: (text: string, what: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded border border-line bg-canvas px-2.5 py-1.5 font-mono text-[11.5px] text-ink">
        {text}
      </code>
      <button
        type="button"
        onClick={() => onCopy(text, "Command")}
        aria-label={"Copy: " + text}
        className="shrink-0 rounded p-1.5 text-ink-faint transition hover:bg-panel-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
      >
        <Icon.Copy width={13} height={13} />
      </button>
    </div>
  );
}
