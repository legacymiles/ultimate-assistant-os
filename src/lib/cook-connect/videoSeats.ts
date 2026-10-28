// Video at the spades table (owner's rule, Oct 2026): every player on video
// shows live on their own seat, and only ONE video is ever enlarged — the
// spotlight — in a reserved strip above the table so it never covers the cards.
//
// Pure: who is on video at which seat, and which one is in the spotlight.

export interface SeatPerson {
  seat: number;
  /** Empty for an open seat; `bot:<n>` for a computer player. */
  userId: string;
  isBot: boolean;
}

export interface FeedLike {
  userId: string;
  camOn: boolean;
}

/** Spotlight state: whose video is enlarged, or `null` when all are small. */
export interface Spotlight {
  /** userId of the enlarged player. */
  userId: string | null;
  /** True once the player has chosen (or closed) the spotlight themselves. */
  chosen: boolean;
}

export const NO_SPOTLIGHT: Spotlight = { userId: null, chosen: false };

/**
 * Seat → userId of whoever is on video there. Bots and open seats never are.
 * `me` is on video when I have joined the call.
 */
export function seatsOnVideo(
  table: SeatPerson[], feeds: FeedLike[], me: { userId: string; joined: boolean },
): Map<number, string> {
  const live = new Set(feeds.map((f) => f.userId));
  if (me.joined && me.userId) live.add(me.userId);
  const out = new Map<number, string>();
  for (const s of table) {
    if (!s.userId || s.isBot) continue;
    if (live.has(s.userId)) out.set(s.seat, s.userId);
  }
  return out;
}

/**
 * Who should be enlarged right now.
 *  - A choice the player made stays while that person is still on video
 *    (a closed spotlight stays closed).
 *  - If the chosen person leaves, or nobody has chosen, it picks for them:
 *    someone else with their camera on first, then anyone else, then me.
 */
export function resolveSpotlight(
  current: Spotlight,
  onVideo: string[],
  feeds: FeedLike[],
  myId: string,
): Spotlight {
  if (onVideo.length === 0) return NO_SPOTLIGHT;
  if (current.chosen) {
    if (current.userId === null) return current;
    if (onVideo.includes(current.userId)) return current;
  } else if (current.userId && onVideo.includes(current.userId)) {
    // An automatic pick is kept while it still makes sense, so the big tile
    // does not jump between people every time someone toggles a camera.
    const f = feeds.find((x) => x.userId === current.userId);
    const others = onVideo.filter((id) => id !== myId);
    if (current.userId !== myId && (f?.camOn ?? true)) return current;
    if (current.userId === myId && others.length === 0) return current;
  }
  const others = onVideo.filter((id) => id !== myId);
  const camOn = others.find((id) => feeds.find((f) => f.userId === id)?.camOn);
  const pick = camOn ?? others[0] ?? (onVideo.includes(myId) ? myId : onVideo[0]);
  return { userId: pick ?? null, chosen: false };
}

/**
 * Tapping a seat's video: enlarge that person (and only them). Tapping the
 * one already enlarged shrinks it back, so nobody is enlarged.
 */
export function tapSpotlight(current: Spotlight, userId: string): Spotlight {
  if (current.userId === userId) return { userId: null, chosen: true };
  return { userId, chosen: true };
}
