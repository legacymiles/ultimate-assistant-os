"use client";

// ---------------------------------------------------------------------------
// Ship — Client Review's Ship console, drawn inside the Studio.
//
// Everything that decides where a live website goes and who can open it, in
// the side panel of that website rather than on a second screen:
//
//   Where it lives   the live address, its GitHub repo and Vercel project —
//                    the repo is what "Approve & build" builds in.
//   Client link      copy it, make a new one (the old one stops working),
//                    release it to a different Google account.
//   Move into hub    an app App Builder built on its own (own folder, own
//                    repo) comes in as /apps/<slug> through a pull request.
//                    The standalone is retired only after, by typing its name.
//   Archive / Delete archive closes the client's link and can be undone;
//                    delete cannot, so it asks for the website's name.
//
// The owner only. The routes are the same owner-only admin actions the old
// console used (meta, rotate, release, delete), so nothing new is exposed.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { admin } from "@/lib/client-review/client";
import type { ClientProject } from "@/lib/client-review/types";
import { useAppBuilder } from "@/lib/app-builder/useAppBuilder";
import { MoveIntoHub } from "../app-builder/MoveIntoHub";
import "../app-builder/app-builder.css";

interface Props {
  project: ClientProject;
  liveUrl: string;
  onChanged: () => void;
  onDeleted: () => void;
}

export function ShipPanel({ project, liveUrl, onChanged, onDeleted }: Props) {
  const [repo, setRepo] = useState(project.repo ?? "");
  const [vercel, setVercel] = useState(project.vercelProject ?? "");
  const [busy, setBusy] = useState("");
  const [said, setSaid] = useState<{ tone: "ok" | "bad"; text: string } | null>(
    null,
  );
  const [typed, setTyped] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setRepo(project.repo ?? "");
    setVercel(project.vercelProject ?? "");
  }, [project.id, project.repo, project.vercelProject]);

  const link =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/apps/client-review?site=${project.token}`;
  const dirty =
    repo.trim() !== (project.repo ?? "") ||
    vercel.trim() !== (project.vercelProject ?? "");

  // The App Builder project that built this site on its own, when there is
  // one: that is what Move into hub moves.
  const ab = useAppBuilder();
  const built = useMemo(
    () =>
      ab.projects.find(
        (p) =>
          p.handoff?.review?.id === project.id &&
          p.handoff?.built?.path &&
          !p.edit,
      ) ?? null,
    [ab.projects, project.id],
  );
  useEffect(() => {
    if (built && ab.current?.id !== built.id) ab.open(built.id);
  }, [built, ab]);

  const run = async (
    label: string,
    body: Record<string, unknown>,
    ok: string,
  ) => {
    setBusy(label);
    setSaid(null);
    try {
      await admin.act({ id: project.id, ...body });
      setSaid({ tone: "ok", text: ok });
      onChanged();
      return true;
    } catch (e) {
      setSaid({
        tone: "bad",
        text: e instanceof Error ? e.message : "That didn't go through.",
      });
      return false;
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="cr-list ws-ship">
      <section className="ws-ship-sec" aria-labelledby="ship-where">
        <h3 id="ship-where">Where it lives</h3>
        <dl className="ws-ship-dl">
          <dt>Live</dt>
          <dd>
            {liveUrl ? (
              <a href={liveUrl} target="_blank" rel="noopener noreferrer">
                {liveUrl.replace(/^https?:\/\//, "")}
              </a>
            ) : (
              <span className="faint">Not deployed yet</span>
            )}
          </dd>
          {project.appSlug && (
            <>
              <dt>Hub app</dt>
              <dd>
                <code>/apps/{project.appSlug}</code>
              </dd>
            </>
          )}
        </dl>
        {project.appSlug ? (
          <p className="ws-hint">
            One of your hub apps — every edit is built in the hub&apos;s own
            repo and goes live with it.
          </p>
        ) : (
          <>
            <label className="ws-field">
              <span>GitHub repo</span>
              <input
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="owner/name"
                spellCheck={false}
              />
            </label>
            <label className="ws-field">
              <span>Vercel project</span>
              <input
                value={vercel}
                onChange={(e) => setVercel(e.target.value)}
                placeholder="project name"
                spellCheck={false}
              />
            </label>
            <p className="ws-hint">
              Edits are built in this repo. Without one, an approved edit waits
              in In Queue for your PC.
            </p>
            <button
              className="ws-btn small"
              disabled={!dirty || Boolean(busy)}
              onClick={() =>
                void run(
                  "meta",
                  {
                    action: "meta",
                    repo: repo.trim(),
                    vercelProject: vercel.trim(),
                  },
                  "Saved.",
                )
              }
            >
              {busy === "meta" ? "Saving…" : "Save"}
            </button>
          </>
        )}
      </section>

      <section className="ws-ship-sec" aria-labelledby="ship-link">
        <h3 id="ship-link">Client link</h3>
        {project.archived ? (
          <p className="ws-hint">
            Archived — the link is closed until you unarchive it.
          </p>
        ) : (
          <div className="ws-ship-link">
            <code title={link}>{link.replace(/^https?:\/\//, "")}</code>
            <button
              className="ws-btn ghost small"
              onClick={() => {
                void navigator.clipboard?.writeText(link).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1600);
                });
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}
        <p className="ws-hint">
          {project.clientUserEmail
            ? `Claimed by ${project.clientUserEmail}. Only that Google account can open it.`
            : "Nobody has opened it yet — the first Google account that does, claims it."}
        </p>
        <div className="ws-ship-row">
          <button
            className="ws-btn ghost small"
            disabled={Boolean(busy)}
            onClick={() => {
              if (
                !window.confirm(
                  "Make a new link? The one you sent stops working at once.",
                )
              )
                return;
              void run(
                "rotate",
                { action: "rotate" },
                "New link made. Send it to your client — the old one is closed.",
              );
            }}
          >
            {busy === "rotate" ? "Making…" : "New link"}
          </button>
          {project.clientUserEmail && (
            <button
              className="ws-btn ghost small"
              disabled={Boolean(busy)}
              onClick={() =>
                void run(
                  "release",
                  { action: "release" },
                  "Released — the next account to open the link gets it.",
                )
              }
            >
              Release {project.clientUserEmail}
            </button>
          )}
        </div>
      </section>

      {built ? (
        <section
          className="ws-ship-sec ws-ship-move"
          aria-label="Move into the hub"
        >
          <MoveIntoHub
            project={built}
            busy={ab.busy}
            moving={ab.moving}
            onMove={() => void ab.absorb()}
            onRetire={() => void ab.retire()}
          />
          {ab.error && <p className="ws-error">{ab.error}</p>}
        </section>
      ) : (
        !project.appSlug && (
          <section className="ws-ship-sec" aria-labelledby="ship-move">
            <h3 id="ship-move">Move into hub</h3>
            <p className="ws-hint">
              Shows here for a site App Builder built on its own folder and
              repo. This one wasn&apos;t built by App Builder on this account,
              so there is no folder on your PC to move in.
            </p>
          </section>
        )
      )}

      <section className="ws-ship-sec" aria-labelledby="ship-end">
        <h3 id="ship-end">Archive or delete</h3>
        <div className="ws-ship-row">
          <button
            className="ws-btn ghost small"
            disabled={Boolean(busy)}
            onClick={() =>
              void run(
                "archive",
                { action: "meta", archived: !project.archived },
                project.archived
                  ? "Unarchived — the client link opens again."
                  : "Archived — the client link is closed.",
              )
            }
          >
            {project.archived ? "Unarchive" : "Archive"}
          </button>
        </div>
        <label className="ws-field">
          <span>
            Delete forever — type <b>{project.name}</b>
          </span>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={project.name}
            aria-label={`Type ${project.name} to delete it`}
          />
        </label>
        <button
          className="ws-btn small ws-danger"
          disabled={
            typed.trim().toLowerCase() !== project.name.trim().toLowerCase() ||
            Boolean(busy)
          }
          onClick={async () => {
            if (await run("delete", { action: "delete" }, "Deleted."))
              onDeleted();
          }}
        >
          {busy === "delete" ? "Deleting…" : "Delete this website"}
        </button>
        <p className="ws-hint">
          Deletes its requests, versions and client link. The code and the live
          site are not touched.
        </p>
      </section>

      {said && (
        <p className={said.tone === "ok" ? "ws-notice" : "ws-error"}>
          {said.text}
        </p>
      )}
      <a className="ws-ship-more" href="/apps/client-review?tab=admin">
        Brief lane, invite and the rest — full console
      </a>
    </div>
  );
}
