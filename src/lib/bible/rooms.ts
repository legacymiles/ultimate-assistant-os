// ---------------------------------------------------------------------------
// The Bible's rooms, named once.
//
// This app is several applications behind one front door, the way EA World and
// Jarvis Audio Studio are (src/lib/ea-world/studios.ts). Build Plans is built;
// the other three are declared here with `built: false` and render a panel
// saying what they will hold. That is deliberate: the owner is filling a
// building, and he should be able to see its shape.
//
// Deliberately not inside the shell component. The page is a server component
// and validates `?studio=` before rendering anything, and a "use client"
// module's plain functions cannot be called from the server.
// ---------------------------------------------------------------------------

export type RoomId = "plans" | "scout" | "plays" | "funding";

export interface RoomDef {
  id: RoomId;
  label: string;
  /** What this room is for, shown beside the label where there is room. */
  hint: string;
  blurb: string;
  /** False renders the not-built panel instead of mounting anything. */
  built: boolean;
  /** Accent hue 0-360. The shell's ambient light shifts to it. */
  hue: number;
}

export const ROOMS: RoomDef[] = [
  {
    id: "plans",
    label: "Build Plans",
    hint: "how do I make this?",
    blurb:
      "Every idea you have had, each one holding the ordered, costed, sourced list of what you "
      + "actually do to make it exist and sell the first one. Talk to it to make it cheaper, swap a "
      + "material, or ask whether a step is even allowed where you live.",
    built: true,
    hue: 36,
  },
  {
    id: "scout",
    label: "Deal Scout",
    hint: "what is underpriced near me?",
    blurb:
      "Marketplace, OfferUp and Craigslist watched for things worth buying to resell — ranked by "
      + "profit per day of capital, after fees and shipping, with the sold prices it was priced "
      + "against shown on every row. Specced, not built.",
    built: false,
    hue: 168,
  },
  {
    id: "plays",
    label: "Money Plays",
    hint: "what could I run?",
    blurb:
      "Ways to make money filed and rated — what each one needs up front, what it pays, and how "
      + "quickly you would know it was working. Not built yet.",
    built: false,
    hue: 268,
  },
  {
    id: "funding",
    label: "Funding",
    hint: "where does the money come from?",
    blurb:
      "Grants, loans and the other places starting capital actually comes from, with what each one "
      + "demands of you before it hands anything over. Not built yet.",
    built: false,
    hue: 320,
  },
];

export const DEFAULT_ROOM: RoomId = "plans";

export function isRoom(value: unknown): value is RoomId {
  return ROOMS.some((r) => r.id === value);
}

export function roomDef(id: RoomId): RoomDef {
  return ROOMS.find((r) => r.id === id) ?? ROOMS[0];
}
