# Recall — Lists (shared family board)

Date: 2026-08-28
Status: approved, ready to plan

## Problem

Recall today is a personal RAG second brain: folders you open like pages, one
search box, an encrypted vault, an agent. It is excellent for durable reference
material and bad for the churn of daily life — "buy milk", "dentist Tuesday",
"renew the car insurance". Those are short-lived, get deleted constantly, and
belong to the whole household rather than to one project folder.

So Recall gains a second home-page tab: **Lists**. A shared family board of
throwaway items, colour-coded by urgency and by who added them.

## Non-goals

- Not a replacement for the folder/RAG side. Lists items are never indexed,
  never searched by the main search box, never seen by the agent.
- Not real-time collaboration. No websockets, no live cursors. A member sees
  changes on their next load/refresh.
- Not a calendar. `dueDate` is a flag on an item, not a scheduling system.

## Storage decision (and why it differs from the rest of Recall)

The RAG side is `localStorage` under `recall:v1`. Lists **cannot** be, because
the feature is defined by an invite link that a family member opens on their own
phone. Shared data has to leave the device.

Lists therefore live server-side in a JSON file behind API routes, using the
exact pattern `src/lib/recall/gateStore.ts` already established for the app
password: a file next to the project, written through Node-runtime route
handlers.

- `.recall-gate.json`  — existing, the admin app password
- `.recall-lists.json` — new, members + list definitions + items

**Persistence is honest, not assumed.** As with `gateStore`, this persists on a
long-lived Node host (local dev, a VPS) and is ephemeral on Vercel serverless.
`gateStore` already probes for this; the Lists UI surfaces the same warning
rather than silently losing the family's shopping list.

This file is the Supabase seam. Swapping the store later changes no types, no
API route shapes, and no components.

## Access model

Two distinct principals, two distinct cookies.

| | Admin | Member |
|---|---|---|
| Authenticates with | existing Recall app password | own password, set once via invite |
| Cookie | `recall_auth` (exists today) | `recall_member` (new) |
| Can reach | all of Recall + Lists | Lists only |
| `/apps/recall` | full app | 302 to `/apps/recall/lists` |
| Folders, search, vault, agent, capture | yes | blocked server-side |

The member token must never satisfy the admin check. A member who types
`/apps/recall` or hits `/api/recall/*` directly is rejected by the route, not
merely shown a different component. This is the security-relevant invariant of
the whole feature.

Admin identity is not a row in the members file — the admin is simply whoever
holds the app password. The members file records the admin as a display
identity (name + colour) so their items are attributable, but authority comes
from `recall_auth`.

## Invite flow

1. Admin opens Lists, hits **Invite**; the server mints a single-use token.
2. The link is `/recall-join?t=<token>`. Valid 7 days. Admin can revoke while
   pending.
3. The invitee opens it, enters a name, picks a colour from those still free,
   and sets a password (min 8 chars, PBKDF2-hashed exactly as `gateStore` hashes
   the app password — 210,000 iterations, sha256, 32-byte key, per-user salt).
4. The token is consumed on success. They then sign in with name + password; no
   link needed again.
5. Admin can remove a member, choosing at removal time whether to delete that
   member's items or leave them attributed to a removed-member placeholder.

## Data model

```ts
type Role = "admin" | "member";
type Priority = "urgent" | "low" | "wish" | null;

interface Member {
  id: string;
  name: string;
  colour: string;      // key into a fixed member palette
  role: Role;
  salt: string;        // base64
  hash: string;        // base64, PBKDF2
  joinedAt: string;
}

interface Invite {
  token: string;       // random 32 bytes, hex
  createdAt: string;
  expiresAt: string;
  consumedAt?: string;
}

interface ListDef {
  id: string;
  name: string;
  icon: string;        // key into the existing Icon set
  builtIn: boolean;
  hidden: boolean;     // admin can hide a built-in they never use
  order: number;
}

interface ListItem {
  id: string;
  listId: string;
  text: string;
  priority: Priority;
  note?: string;
  dueDate?: string;    // ISO date, no time
  url?: string;
  done: boolean;
  authorId: string;    // Member.id
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

interface ListsData {
  members: Member[];
  invites: Invite[];
  lists: ListDef[];
  items: ListItem[];
}
```

### The eight built-in lists

`todo` To-Do · `buy` To-Buy · `remember` Remember / Upcoming · `ideas` Ideas ·
`goals` Goals · `projects` Projects · `bills` Bills / Payments · `notes` Notes

Seeded on first run with `builtIn: true`. Admin may add custom lists (name,
icon) and hide built-ins. A built-in is hidden, never deleted, so hiding one can
never destroy its items — the same invariant the folder-section code already
enforces.

### Priority tiers

Four states, not three. The three the user asked for, plus an unset default:

- `urgent` — red. Hot, needs doing now.
- `low` — orange. Running low, restock soon.
- `wish` — yellow. Wish list, someday.
- `null` — neutral grey. The default.

Forcing every item into one of three colours would make the colours stop
carrying signal; most shopping-list rows are simply normal.

## Permissions

Enforced in the API route on every mutation, by re-reading the caller's cookie.
The UI hides what the caller cannot do, but the UI is not the enforcement point.

| Action | Admin | Member |
|---|---|---|
| Add an item to any list | yes | yes |
| Edit / delete an item | any item | only where `authorId` is theirs |
| Toggle `done` | any item | **any item** |
| Add / hide / reorder lists | yes | no |
| Invite, revoke, remove members | yes | no |
| Reach the RAG side | yes | no |

`done` is deliberately open to everyone: if one person buys the milk another
person added, they must be able to tick it off. Deletion stays owner-scoped.

## UI

### Tab switch

The Recall home page gains a two-tab switch: **Folders** (today's `FolderHome`,
unchanged and still the default for the admin) and **Lists**. Members never see
the switch — they only ever get the Lists view.

### The board — card wall

A responsive grid of list tiles (3-up desktop, 2-up tablet, 1-up phone),
matching the visual language of the existing folder home grid.

- Each tile: icon + name + count header, then its items.
- An empty list collapses to just its header row, so an unused Ideas list costs
  one line rather than a large empty card.
- An item row: priority dot, text (struck through when done), member colour
  circle. Note / due date / link render as small secondary affordances only when
  present.
- An overdue `dueDate` gets a visible flag.
- A dashed **New list** tile at the end, admin only.

### Above the grid

- **Member filter** — a row of colour chips, one per member, plus "All".
  Multi-select in any combination; filters items by `authorId`. Persisted per
  device so it survives a reload.
- **Quick add** — a single input plus a list picker, so anything can be fired
  into any list without navigating into that tile.
- **Who you are** — a chip showing the current identity, with sign-out.

### Completed items

Ticking strikes the item through and drops it to the bottom of its tile. Items
auto-clear 24 hours after `completedAt`, swept lazily on read. Without this a
daily-use shopping list becomes an archive within a week.

## Files

New:

- `src/lib/recall/lists/types.ts` — the model above
- `src/lib/recall/lists/store.ts` — server-side file-backed store + permission checks
- `src/lib/recall/lists/session.ts` — member cookie mint/verify, PBKDF2 helpers
- `src/app/api/recall/lists/route.ts` — read + item CRUD
- `src/app/api/recall/lists/members/route.ts` — invite, join, remove
- `src/app/api/recall/lists/session/route.ts` — member sign-in / sign-out
- `src/app/apps/recall/lists/page.tsx` — the member-facing Lists page
- `src/app/recall-join/page.tsx` — invite acceptance + member sign-in
- `src/components/recall/lists/*` — Board, ListCard, ItemRow, QuickAdd,
  MemberFilter, MemberDialog, ListDialog

Changed:

- `src/app/apps/recall/page.tsx` — admit admins; redirect members to Lists
- `src/components/recall/Recall.tsx` — the Folders / Lists tab switch
- `src/lib/recall/gateStore.ts` — reuse its PBKDF2 helpers rather than
  duplicating the crypto parameters (extract them if needed)

Untouched: every existing RAG component, `src/lib/recall/store.ts`, the vault,
the agent, search.

## Error handling

- Read-only filesystem — the store throws a readable reason and the Lists UI
  shows the same warning the Security dialog already shows for the app password.
- Expired / consumed / unknown invite token — a plain "this link is no longer
  valid, ask for a new one" page. Never leaks whether the token ever existed.
- A member acting outside their permissions — 403 from the route, with the UI
  refreshing to show current truth rather than trusting its own optimistic state.
- Colour collision at signup — the picker only offers colours still free.

## Testing

- Permission matrix: every mutation attempted as admin, as owning member, as
  non-owning member, and unauthenticated. Non-owner delete must 403.
- Route guard: a `recall_member` cookie must not open `/apps/recall`,
  `/api/recall/*`, or any vault/agent route.
- Invite lifecycle: mint, join, token consumed, replay rejected; expiry; revoke
  while pending.
- Sweep: an item completed 25 hours ago is gone on read; one completed 23 hours
  ago is still there.
- A hidden list retains its items and restores them when unhidden.
