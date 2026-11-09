"use client";

// ---------------------------------------------------------------------------
// Client Review — the look pass.
//
// Shown on the one screen the portal had nothing on: a version that is being
// built, or a site that has not landed yet. Until now that screen was an orb
// and a sentence, and the client sat in the dark for however long the build
// took — which is both the worst moment for their confidence and the last
// cheap moment to catch a look going the wrong way.
//
// It draws the SAME three directions the owner saw in App Builder, because the
// project carries `designSkill` across the hand-off. A client approving a look
// the owner never had rendered would be a worse bug than no mockups at all.
//
// What it is drawn FROM, in order of truth:
//   1. the edits the client approved — their own words, so the mockup answers
//      "did you understand what I asked for" before a build finds out;
//   2. the version summary — App Builder writes a bullet per accepted feature,
//      which is the best content a first build has;
//   3. the site's name alone, which still gives three real layouts to judge.
// ---------------------------------------------------------------------------

import { useMemo } from "react";

import { MockupBakeOff } from "@/components/mockup/MockupBakeOff";
import { specFromEdits, specFromSummary } from "@/lib/mockup/spec";
import type { PortalView } from "@/lib/client-review/types";

export function LookPass({
  view,
  busy,
  onPick,
}: {
  view: PortalView;
  busy: string;
  onPick: (skill: string) => void;
}) {
  const version = useMemo(
    () => view.versions.find((v) => v.id === view.buildingVersionId) ?? view.versions[0] ?? null,
    [view.versions, view.buildingVersionId],
  );

  const spec = useMemo(() => {
    const siteName = view.name;
    const clientName = view.clientName;
    const number = version?.number ?? "v1";

    // The edits that are actually being built. Filtered by status rather than
    // by version id, because an approved request was written against the
    // PREVIOUS version — it is the one being built that it changes.
    const approved = view.requests.filter((r) => r.status === "approved");
    const edits = (approved.length ? approved : view.requests.filter((r) => r.status === "sent")).map((r) => ({
      text: r.adminText || r.text,
      pin: r.pin ? { x: r.pin.x, y: r.pin.y } : undefined,
    }));

    if (edits.length) return specFromEdits({ siteName, clientName, version: number, edits });
    return specFromSummary({ siteName, clientName, version: number, summary: version?.summary ?? "" });
  }, [view.name, view.clientName, view.requests, version]);

  return (
    <div className="cr-look">
      <MockupBakeOff
        spec={spec}
        recommended={view.designSkill}
        chosen={view.look ?? null}
        onChoose={busy === "look" ? undefined : onPick}
        chooseLabel="Build this one"
        as={view.viewerOwner ? "owner" : "client"}
        caption={
          view.look
            ? `${view.look.by === "client" ? "You picked" : "Picked"} this look — the build follows it. Tap another to change your mind.`
            : "While that's building, here's how it could look. Pick the one you want and we build that."
        }
      />
      {busy === "look" && (
        <p className="cr-look-busy" role="status">
          Saving your choice…
        </p>
      )}
    </div>
  );
}
