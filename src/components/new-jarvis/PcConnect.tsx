"use client";

// ---------------------------------------------------------------------------
// "Connect this PC" — one button, in the chat.
//
// The owner's PC was on and Jarvis still said "the local agent is not
// reachable": the helper hadn't started since the folder moved. Nobody should
// have to know what a local agent, a token or pair.cmd is. So, on a computer:
//
//   Start      opens jarvis-agent:// — the agent registers it on Windows, so
//              one tap launches it; pairing then happens by itself
//   First time a single "double-click install.cmd" step, with the exact folder
//              when Jarvis has seen it before
//   Blocked    the browser can refuse a website talking to the PC; say how to
//              allow it, in plain words
//
// On a phone there is no PC to connect from here, so it only says Jarvis
// still works.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { START_LINK, knownFolder, type BridgeHealth } from "@/lib/new-jarvis/bridge";

const DISMISS_KEY = "new-jarvis:pc-connect-dismissed";

function onComputer(): boolean {
  if (typeof navigator === "undefined") return false;
  return !/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/** Chrome asks before a website may reach this PC; "denied" means the owner (or a click) said no. */
async function browserBlocksPc(): Promise<boolean> {
  try {
    for (const name of ["local-network-access", "loopback-network", "local-network"]) {
      const s = await navigator.permissions.query({ name } as unknown as PermissionDescriptor).catch(() => null);
      if (s) return s.state === "denied";
    }
  } catch {
    /* not supported — nothing to say */
  }
  return false;
}

export function PcConnect({
  health,
  ready,
  refresh,
  variant,
}: {
  health: BridgeHealth;
  ready: boolean;
  refresh: () => void;
  variant: "hero" | "strip";
}) {
  const [computer, setComputer] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [trying, setTrying] = useState(false);
  const [firstTime, setFirstTime] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [copied, setCopied] = useState(false);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setComputer(onComputer());
    try {
      setDismissed(window.sessionStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      /* fine */
    }
    void browserBlocksPc().then(setBlocked);
    return () => {
      if (poll.current) clearInterval(poll.current);
    };
  }, []);

  const connected = health.up && health.paired;
  useEffect(() => {
    if (connected && poll.current) {
      clearInterval(poll.current);
      poll.current = null;
      setTrying(false);
    }
  }, [connected]);

  if (!ready || connected) {
    if (health.settingUp && variant === "strip") return <SettingUp />;
    return null;
  }

  if (!computer) {
    return variant === "hero" ? (
      <p className="njc-hero__note">
        Jarvis works from here — it searches the web, builds apps and hands code changes to Claude Code. Things on your
        PC itself (its files, apps and signed-in browser) work when Jarvis is open on that PC.
      </p>
    ) : null;
  }

  if (health.settingUp) return <SettingUp />;
  if (dismissed && variant === "strip") return null;

  const start = () => {
    setTrying(true);
    setFirstTime(false);
    // Opens the agent through the link it registered. The browser asks once
    // ("Open wscript?") — ticking "Always allow" makes it one tap from then on.
    window.location.href = START_LINK;
    let n = 0;
    if (poll.current) clearInterval(poll.current);
    poll.current = setInterval(() => {
      refresh();
      if (++n >= 10) {
        if (poll.current) clearInterval(poll.current);
        poll.current = null;
        setTrying(false);
        setFirstTime(true);
      }
    }, 1500);
  };

  const folder = knownFolder();
  const installPath = folder ? `${folder}\\install.cmd` : "";

  return (
    <div className={`pcc pcc--${variant}`} role="status">
      <div className="pcc__row">
        <span className="pcc__dot" aria-hidden />
        <p className="pcc__text">
          {blocked ? (
            <>
              <b>Your browser is blocking Jarvis from your PC.</b> Click the icon left of the address bar → Site settings →{" "}
              <b>Local network access</b> → Allow, then reload.
            </>
          ) : trying ? (
            <>Starting Jarvis on this PC… if your browser asks, choose <b>Open</b> (tick “Always allow”).</>
          ) : (
            <>
              <b>Connect this PC</b> so Jarvis can use its browser, files and apps.
            </>
          )}
        </p>
        {!blocked && (
          <button type="button" className="pcc__go" onClick={start} disabled={trying}>
            {trying ? "Starting…" : "Connect"}
          </button>
        )}
        {variant === "strip" && (
          <button
            type="button"
            className="pcc__later"
            onClick={() => {
              setDismissed(true);
              try {
                window.sessionStorage.setItem(DISMISS_KEY, "1");
              } catch {
                /* fine */
              }
            }}
            aria-label="Hide for now"
          >
            Not now
          </button>
        )}
      </div>
      {firstTime && (
        <div className="pcc__first">
          <p>
            <b>First time on this PC?</b> Double-click <b>install.cmd</b> in your Jarvis folder → tools → jarvis-bridge.
            It sets everything up and starts with Windows from then on — you won&apos;t need to do it again.
          </p>
          {installPath && (
            <button
              type="button"
              className="pcc__copy"
              onClick={() => {
                void navigator.clipboard?.writeText(installPath).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                });
              }}
            >
              {copied ? "Copied" : "Copy its location"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SettingUp() {
  return (
    <div className="pcc pcc--strip" role="status">
      <div className="pcc__row">
        <span className="pcc__dot is-busy" aria-hidden />
        <p className="pcc__text">Jarvis is finishing setting itself up on this PC — a few minutes, one time only.</p>
      </div>
    </div>
  );
}
