// ---------------------------------------------------------------------------
// Find My Life — what each kind of thing is, and the best way to find it.
//
// The honest starting point: Apple's Find My and Google's Find Hub have no API
// a website can read. So every kind of thing gets the best source that really
// works, in order — the "ladder" — and the app always shows which rung a
// location came from and how old it is.
//
//   self        the device reports itself (Find My Life open on it)
//   shortcut    an iPhone Shortcut automation pings in the background
//   car         Smartcar (official car-maker logins) — live location
//   disconnect  your phone pins where a Bluetooth thing / CarPlay dropped off
//   tag-link    an AirTag "Share Item Location" link, or the tag's own app
//   manual      "I left it here"
// ---------------------------------------------------------------------------

export type Kind =
  | "phone"
  | "laptop"
  | "tablet"
  | "watch"
  | "earbuds"
  | "glasses"
  | "car"
  | "keys"
  | "wallet"
  | "bag"
  | "bike"
  | "pet"
  | "other";

export type SourceKind = "self" | "shortcut" | "car" | "disconnect" | "tag-link" | "manual";

export type TagBrand = "airtag" | "tile" | "smarttag" | "google" | "chipolo" | "none";

export interface KindInfo {
  id: Kind;
  label: string;
  /** Placeholder shown when naming one. */
  example: string;
  /** The ladder, best rung first. */
  ladder: SourceKind[];
  /** One plain sentence: how we find this kind of thing. */
  how: string;
  /** Has its own Bluetooth link to the phone (so "disconnect" makes sense). */
  bluetooth?: boolean;
  /** Usually carries a tracker tag. */
  tagged?: boolean;
}

export const KINDS: KindInfo[] = [
  {
    id: "phone",
    label: "Phone",
    example: "My iPhone",
    ladder: ["self", "shortcut", "manual"],
    how: "Your phone reports itself — live while Find My Life is open on it, and in the background with an iPhone Shortcut.",
  },
  {
    id: "laptop",
    label: "Laptop",
    example: "Work laptop",
    ladder: ["self", "manual"],
    how: "Open Find My Life on the laptop once and tap “Make this device findable”. It checks in whenever Jarvis is open on it.",
  },
  {
    id: "tablet",
    label: "Tablet",
    example: "iPad",
    ladder: ["self", "shortcut", "manual"],
    how: "Same as a phone: it reports itself while Jarvis is open, or in the background with a Shortcut.",
  },
  {
    id: "watch",
    label: "Watch",
    example: "Apple Watch",
    ladder: ["disconnect", "tag-link", "manual"],
    bluetooth: true,
    how: "Your phone drops a pin the moment the watch disconnects from it — that's where you left it.",
  },
  {
    id: "earbuds",
    label: "Earbuds",
    example: "AirPods Pro",
    ladder: ["disconnect", "tag-link", "manual"],
    bluetooth: true,
    how: "Your phone drops a pin the moment they disconnect — the last place they were with you.",
  },
  {
    id: "glasses",
    label: "Smart glasses",
    example: "Ray-Ban Meta",
    ladder: ["disconnect", "manual"],
    bluetooth: true,
    how: "Meta glasses have no location of their own, so your phone pins the spot where they disconnected from it.",
  },
  {
    id: "car",
    label: "Car",
    example: "The Tahoe",
    ladder: ["car", "disconnect", "manual"],
    bluetooth: true,
    how: "Connect your car-maker login (Smartcar) for live location, fuel and locks — and your phone pins where you parked when CarPlay or the car's Bluetooth disconnects.",
  },
  {
    id: "keys",
    label: "Keys",
    example: "House keys",
    ladder: ["tag-link", "disconnect", "manual"],
    tagged: true,
    how: "Keys need a tag (AirTag, Tile, SmartTag). One tap opens the tag's app, and a shared item link shows right on your map.",
  },
  {
    id: "wallet",
    label: "Wallet",
    example: "Wallet",
    ladder: ["tag-link", "disconnect", "manual"],
    tagged: true,
    how: "A tag in the wallet (AirTag card, Tile Slim) — one tap opens its app, and a shared item link shows on your map.",
  },
  {
    id: "bag",
    label: "Bag",
    example: "Gym bag",
    ladder: ["tag-link", "manual"],
    tagged: true,
    how: "Drop a tag in it. A shared item link shows on your map; the tag's app does the precise finding.",
  },
  {
    id: "bike",
    label: "Bike",
    example: "Road bike",
    ladder: ["tag-link", "manual"],
    tagged: true,
    how: "A hidden tag under the seat. A shared item link shows on your map.",
  },
  {
    id: "pet",
    label: "Pet",
    example: "Max",
    ladder: ["tag-link", "manual"],
    tagged: true,
    how: "A collar tag (AirTag, Tile, SmartTag). A shared item link shows on your map.",
  },
  {
    id: "other",
    label: "Something else",
    example: "Camera",
    ladder: ["tag-link", "disconnect", "manual"],
    how: "With a tag it shows on the map; with Bluetooth your phone pins where it dropped off; otherwise pin it yourself.",
  },
];

export const KIND_BY_ID: Record<Kind, KindInfo> = Object.fromEntries(KINDS.map((k) => [k.id, k])) as Record<Kind, KindInfo>;

export const SOURCE_LABEL: Record<SourceKind, string> = {
  self: "Reported itself",
  shortcut: "iPhone Shortcut",
  car: "Car connection",
  disconnect: "Last seen with your phone",
  "tag-link": "Shared tag link",
  manual: "Pinned by you",
};

/** Short form for tight rows. */
export const SOURCE_SHORT: Record<SourceKind, string> = {
  self: "LIVE",
  shortcut: "SHORTCUT",
  car: "CAR",
  disconnect: "LAST SEEN",
  "tag-link": "TAG",
  manual: "PINNED",
};

export interface TagInfo {
  id: TagBrand;
  label: string;
  /** Where the tag's own app does the precise finding. iOS first, then web. */
  open: { ios?: string; web: string };
  /** Can the owner share a viewable link of the item's location? */
  shareLink: boolean;
}

export const TAGS: TagInfo[] = [
  { id: "airtag", label: "AirTag / Find My", open: { ios: "findmy://items", web: "https://www.icloud.com/find" }, shareLink: true },
  { id: "tile", label: "Tile", open: { web: "https://www.tile.com/" }, shareLink: false },
  { id: "smarttag", label: "Samsung SmartTag", open: { web: "https://smartthingsfind.samsung.com/" }, shareLink: false },
  { id: "google", label: "Google Find Hub tag", open: { web: "https://www.google.com/android/find/" }, shareLink: false },
  { id: "chipolo", label: "Chipolo", open: { web: "https://www.icloud.com/find" }, shareLink: false },
  { id: "none", label: "No tag yet", open: { web: "https://www.apple.com/airtag/" }, shareLink: false },
];

export const TAG_BY_ID: Record<TagBrand, TagInfo> = Object.fromEntries(TAGS.map((t) => [t.id, t])) as Record<TagBrand, TagInfo>;

/** Where the device's maker finds it, for "open the real thing". */
export function makerFinder(kind: Kind, ua = ""): { label: string; url: string } {
  const apple = /iphone|ipad|mac/i.test(ua);
  if (kind === "phone" || kind === "tablet" || kind === "laptop" || kind === "watch" || kind === "earbuds") {
    return apple
      ? { label: "Open Find My", url: /iphone|ipad/i.test(ua) ? "findmy://devices" : "https://www.icloud.com/find" }
      : { label: "Open Find My / Find Hub", url: "https://www.icloud.com/find" };
  }
  return { label: "Open Find My", url: /iphone|ipad/i.test(ua) ? "findmy://items" : "https://www.icloud.com/find" };
}
