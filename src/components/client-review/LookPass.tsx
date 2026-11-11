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
// Two shapes, decided by what is being built:
//
//   EDITS to a live site → the edit bake-off: the approved edits painted with
//   Flux 2 onto a screenshot of the version the client asked against, three
//   ways. It answers "did you understand what I asked for" before a build
//   finds out. The owner's paintings are saved on the project, so the client
//   sees the same three pictures on their own phone.
//
//   A FIRST build → the look bake-off: three design directions, drawn from
//   the version summary (App Builder writes a bullet per accepted feature) or
//   the site's name alone. The same three the owner saw in App Builder,
//   because the project carries `designSkill` across the hand-off.
// ---------------------------------------------------------------------------

import { useCallback, useMemo, useRef } from "react";

import { MockupBakeOff } from "@/components/mockup/MockupBakeOff";
import { absoluteSiteUrl } from "@/lib/client-review/apps";
import { joinEdits, pickMatches, type CustomLane, type EditLaneId, type EditPick } from "@/lib/mockup/edit";
import { shrinkImage } from "@/lib/mockup/shrink";
import { specFromEdits, specFromSummary } from "@/lib/mockup/spec";
import type { PortalView } from "@/lib/client-review/types";

export function LookPass({
  view,
  busy,
  onPick,
  onSaveMockups,
}: {
  view: PortalView;
  busy: string;
  onPick: (skill: string, pick?: EditPick) => void;
  /** Owner only: keep the three paintings on the project for the client. */
  onSaveMockups?: (edit: string, lanes: { lane: EditLaneId; image: string; label: string; instruction: string }[]) => void;
}) {
  const version = useMemo(
    () => view.versions.find((v) => v.id === view.buildingVersionId) ?? view.versions[0] ?? null,
    [view.versions, view.buildingVersionId],
  );
  // The page the edits were asked against: the version the client is looking
  // at, which is the newest one with an address.
  const live = useMemo(
    () => view.versions.find((v) => v.id === view.currentVersionId && v.siteUrl) ?? view.versions.find((v) => v.siteUrl) ?? null,
    [view.versions, view.currentVersionId],
  );

  // The edits that are actually being built. Filtered by status rather than
  // by version id, because an approved request was written against the
  // PREVIOUS version — it is the one being built that it changes.
  const edits = useMemo(() => {
    const approved = view.requests.filter((r) => r.status === "approved");
    return (approved.length ? approved : view.requests.filter((r) => r.status === "sent")).map((r) => ({
      text: r.adminText || r.text,
      pin: r.pin ? { x: r.pin.x, y: r.pin.y } : undefined,
    }));
  }, [view.requests]);

  const editText = useMemo(() => joinEdits(edits.map((e) => e.text)), [edits]);
  // Only an edit to a page that exists can be painted onto it.
  const editing = Boolean(editText && (live?.siteUrl || live?.image));

  const spec = useMemo(() => {
    const siteName = view.name;
    const clientName = view.clientName;
    const number = version?.number ?? "v1";
    if (edits.length) return specFromEdits({ siteName, clientName, version: number, edits });
    return specFromSummary({ siteName, clientName, version: number, summary: version?.summary ?? "" });
  }, [view.name, view.clientName, edits, version]);

  // The owner's paintings, but only the ones drawn for THESE edits — and the
  // readings they painted, so everyone reads the same three versions (and
  // the owner's board asks Flux for the same pictures again).
  const shared = view.mockups && view.mockups.edit === editText ? view.mockups.lanes : null;
  const sharedLanes = useMemo<CustomLane[] | undefined>(() => {
    if (!shared) return undefined;
    const order: EditLaneId[] = ["faithful", "polished", "bold"];
    const lanes = order.map((id) => shared.find((l) => l.lane === id));
    return lanes.every((l) => l?.instruction) ? lanes.map((l) => ({ label: l!.label, instruction: l!.instruction! })) : undefined;
  }, [shared]);
  // A pick made for an earlier batch isn't a pick for this one.
  const chosen = view.look && (!editing || pickMatches(view.look.edit, editText)) ? view.look : null;

  const saving = useRef("");
  const painted = useCallback(
    (lanes: { lane: EditLaneId; image: string; label: string; instruction: string }[]) => {
      if (!onSaveMockups || !view.viewerOwner) return;
      const sig = `${editText}|${lanes.map((l) => l.image.length).join(",")}`;
      if (saving.current === sig) return;
      saving.current = sig;
      void Promise.all(lanes.map(async (l) => ({ ...l, image: await shrinkImage(l.image) }))).then((small) =>
        onSaveMockups(editText, small),
      );
    },
    [onSaveMockups, view.viewerOwner, editText],
  );

  const owner = Boolean(view.viewerOwner);
  return (
    <div className="cr-look">
      <MockupBakeOff
        spec={spec}
        recommended={view.designSkill}
        chosen={chosen}
        onChoose={busy === "look" ? undefined : (skill, pick) => onPick(skill, pick)}
        chooseLabel={editing ? "This is what I meant" : "Build this one"}
        as={owner ? "owner" : "client"}
        // Flux runs on the owner's PC; a client's screen shows what the owner saved.
        pictures={owner}
        edit={editing ? editText : undefined}
        reference={editing ? { url: live?.siteUrl ? absoluteSiteUrl(live.siteUrl) : undefined, image: live?.image } : null}
        shared={shared}
        customLanes={sharedLanes}
        onPainted={owner && editing ? painted : undefined}
        caption={
          editing
            ? chosen?.edit
              ? `${chosen.by === "client" ? "You picked" : "Picked"} "${chosen.edit.label}" — the build follows it. Tap another to change your mind.`
              : owner
                ? "Your client's edits, painted onto their live page three ways. These pictures are saved to their link once all three are done."
                : shared
                  ? "Your changes, painted onto your site three ways while we build. Pick the one that's closest to what you meant."
                  : "We're painting your changes onto your site — check back in a minute, or pick from the descriptions below."
            : view.look
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
