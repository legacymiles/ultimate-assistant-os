"use client";

// /review — a client's home: every website they have opened with their
// Jarvis account, newest first, with where each one stands.

import { useEffect, useState } from "react";
import { ApiError, portal, type MySite } from "@/lib/client-review/client";
import { SignInGate } from "./SignInGate";
import "./client-review.css";

export function MyWebsites() {
  const [sites, setSites] = useState<MySite[] | null>(null);
  const [signIn, setSignIn] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    portal
      .mine()
      .then((r) => setSites(r.sites))
      .catch((e: Error) => (e instanceof ApiError && e.flags.signIn ? setSignIn(true) : setError(e.message)));
  }, []);

  if (signIn) {
    return <SignInGate title="My websites" body="Sign in with your Jarvis account to see your websites." next="/review" />;
  }
  return (
    <div className="cr-root cr-center">
      <div className="cr-empty">
        <span className="cr-orb" aria-hidden>
          <span className="cr-orb-core" />
          <span className="cr-orb-ring" />
        </span>
        <p className="cr-kicker">Jarvis</p>
        <h1>My websites</h1>
        {error && <p className="cr-error">{error}</p>}
        {sites && !sites.length && <p>Open the link you were sent and your website will show up here.</p>}
        {sites && sites.length > 0 && (
          <ul className="cr-sites">
            {sites.map((s) => (
              <li key={s.token}>
                <a href={`/review/${s.token}`}>
                  <span>
                    <b>{s.name}</b>
                    <small>
                      {s.building
                        ? `Jarvis is building ${s.building}`
                        : s.pending
                          ? "Your requests are with Jarvis"
                          : s.version
                            ? `${s.version} ready to review`
                            : "On its way"}
                    </small>
                  </span>
                  <span aria-hidden>→</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
