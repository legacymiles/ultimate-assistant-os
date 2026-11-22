# Unified identity: Profiles as the one source of truth for people

Status: built 2026-11-22. Owner request: "Jarvis autopilot will be getting its facial recognition
from users profiles, superseding the images in the folders tab", plus Jarvis Memory, the LLM
harness and every app sharing one understanding of who each person is.

## What was there before

Four people stores, unlinked: Photos `Person` (`recall-photos:v1`, the faces Camera Autopilot
matched against), Profiles `ProfileNode` (`profiles:v1`), Dashboard `Profile` (`recall:v1`) and
`Birthday`. Recognition is one vision call per photo against a contact-sheet grid of
`Person.refs`. Two leaks fed library pictures into recognition: the person's character sheet
(whose `identifiers` steer the matcher) was built from refs **plus every photo filed under them**,
and album reference pictures uploaded in the Photos tab could stand in for a person. A profile's
gallery also displayed every picture in its Dashboard folder (Images → Profile read-back).

## The model

- **Identity ID = the person's `ProfileNode.id`.** Persistent, unique, already synced. Every
  other store points at it: Photos `Person.identityId`, Dashboard `Folder.identityId` and
  `Item.identityIds`, memory rows `identity:<id>`.
- **Profiles holds the curated identity collection.** `Media.ref` marks a photo as an authorized
  face reference; `ProfileNode.primaryMediaId` + `avatar` is the profile picture;
  `ProfileNode.faceConsent` is the per-person permission. Only media whose `origin` is not a
  read-back can be either.
- **The Images tab (Dashboard folders) holds the full library.** Untouched as a store.

## One-way image rule

| From → To | Behaviour |
|---|---|
| Profile upload → Images folder | Copied automatically (existing `mirrorPlan`), now tagged with the identity id |
| Images folder → Profile | **Never automatic.** The read-back into the gallery is removed. The profile offers an explicit "Add from Images library" picker; picking copies the picture into the profile (origin `library`) |
| Images folder → face reference / profile picture | **Impossible.** Only profile media can be flagged; Photos-tab refs and character sheets for identity-linked people ignore the library |

Enforced in code, not just UI: `addPersonRef` refuses identity-linked people; `gatherPictures`
and `buildContactSheet` read only enrolled profile references for them; tests cover each.

## Biometric data

The face references derived for recognition (256px crops of the flagged profile photos) are
the biometric templates. They live in `identity-faces:v1`:

- With `IDENTITY_ENC_KEY` set, the blob is sealed server-side (AES-256-GCM, owner sign-in only,
  `/api/identity/seal`) and only ciphertext syncs to `app_state`.
- Without it, the blob is kept on this device only and never synced. Any device can rebuild it
  from the profile photos the owner flagged, so nothing is lost.
- No consent, no template: enrolment needs `faceConsent.granted`. Revoking deletes that person's
  templates, clears their Photos refs and sheet, and stops matching at once. "Delete all face
  data" wipes the store on every device.
- Templates never enter a prompt as text, never reach Jarvis Memory, and the identity memory
  card carries no face data.
- The written description Autopilot uses (`Person.sheet`) is built only from those templates and
  is cleared when consent is withdrawn.
- The reference photos themselves are ordinary profile photos (same storage and row-level
  security as every profile photo); the Photos tab's own plaintext copies (`Person.refs`) are
  emptied for every linked person.

## Camera Autopilot

Before each import or re-read the pipeline runs `syncIdentitiesToPhotos()`: each enrolled
identity becomes (or adopts, by name/alias) a Photos `Person` with `identityId`, its refs
supplied at contact-sheet time from the decrypted template store. Legacy Photos people with
hand-uploaded refs are carried into Profiles once (as person profiles with those refs flagged and
consent marked "carried over") so Autopilot keeps recognising them, now through the one identity.

Confidence: `identity-settings:v1` holds `autoAssign` (default 0.8) and `suggestFloor` (0.5).
Hits at or above `autoAssign` are assigned; hits between the two are **uncertain** — kept off the
routing, shown on the review card as "Is this Brandy?" and only assigned on a yes; below the floor
they count as unidentified.

## Jarvis Memory and the LLM harness

- `src/lib/identity/registry.ts` builds identity cards (name, aliases, label, path, safe facts,
  enrolment status) and `resolveMentions(text)` maps names, first names, aliases and relationship
  words ("my son") to identity ids, flagging ambiguity rather than guessing.
- `identityDigest()` replaces the Photos-only PEOPLE block in the Jarvis chat digest and is added
  to the New Jarvis agent context and the Autopilot chat, mentioned people first.
- `/api/identity/memory` upserts one `identity` memory per person (`external_id identity:<id>`,
  hash-gated) and deletes cards for removed people, so the jarvis-memory MCP, the harness and
  search all answer "who is Brandy" from the same record. No secret/noAi rows, no biometrics.
- `identifyImage()` resolves a dropped photo to enrolled identities with the same matcher and
  thresholds; Profiles chat uses it when photos are dropped.

## Propagation

`IDENTITY_CHANGED` fires on every Profiles commit that touches a person; listeners re-run the
Photos link, the memory card sync and the template build. Renames flow to the Photos person, the
Dashboard folders (existing mirror) and the memory card. Duplicate person names are reported in
Profiles › Settings › Face recognition, and migration links by name/alias before it ever creates.
