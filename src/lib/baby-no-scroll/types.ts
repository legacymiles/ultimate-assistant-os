// ---------------------------------------------------------------------------
// Baby No Scroll — the shapes the lock and the stage agree on.
//
// Two of these are the whole app. A Target is what YouTube is pointed at; a
// Settings is every decision a parent made before handing the screen over.
// Both are plain data so they can be saved, synced and tested without a DOM.
// ---------------------------------------------------------------------------

/** Which corner the padlock rests in. */
export type Corner = "tl" | "tr" | "br" | "bl";

/** The two things the screen can be locked onto. */
export type Mode = "youtube" | "games";

/** The games a baby can be locked into. */
export type GameId = "piano" | "balloons" | "eggs" | "sparkle";

/**
 * What YouTube is pointed at. A watch link that carries BOTH a video and a
 * playlist keeps the list, because the thing that matters with a baby is that
 * it does not stop — but it starts on the video the parent actually picked.
 */
export type Target =
  | { kind: "video"; id: string; list?: string }
  | { kind: "playlist"; id: string };

/** A saved thing to put on, so a parent is not pasting links one-handed. */
export interface Show {
  id: string;
  /** What the parent calls it, not what YouTube calls it. */
  name: string;
  target: Target;
  /** ms since epoch, so the list can lead with what gets used. */
  usedAt: number;
}

export interface Settings {
  mode: Mode;
  game: GameId;
  corner: Corner;
  /** The puck's diameter in px. Small hides better; big is easier one-handed. */
  lockSize: "small" | "large";
  /**
   * Whether reaching the far end is enough, or whether it must then be HELD.
   * On by default: a baby's thumb can cross a phone, but it will not stay put.
   */
  holdToConfirm: boolean;
  /** Ask for real fullscreen, which is what actually hides the browser's own UI. */
  fullscreen: boolean;
  /** Hold the screen awake with the Wake Lock API where it exists. */
  keepAwake: boolean;
  /** Loop a single video forever rather than letting YouTube pick what is next. */
  loop: boolean;
  shows: Show[];
}

export const DEFAULT_SETTINGS: Settings = {
  mode: "youtube",
  game: "balloons",
  corner: "br",
  lockSize: "large",
  holdToConfirm: true,
  fullscreen: true,
  keepAwake: true,
  loop: true,
  shows: [],
};
