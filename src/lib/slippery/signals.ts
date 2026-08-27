// Module-level mutable bag of per-frame values the HUD wants to show. The sim
// writes here every frame; the HUD reads it from its own rAF loop. This keeps
// twitch-rate data off the React/zustand path so we never re-render at 60fps.

import type { FallState } from "./movement";

export const hud = {
  timer: 0,
  speed: 0,
  balance: 0,
  oppDist: 99,
  tension: 0, // 0..1, how close the opponent is (for the HUD danger bar/vignette)
  fall: "ok" as FallState,
  event: "", // transient toast text (JUKE! / SLIP! / WIPEOUT!)
  eventUntil: 0, // performance.now() timestamp the toast expires
};

export function resetHud() {
  hud.timer = 0;
  hud.speed = 0;
  hud.balance = 0;
  hud.oppDist = 99;
  hud.tension = 0;
  hud.fall = "ok";
  hud.event = "";
  hud.eventUntil = 0;
}

export function flash(text: string, ms = 900) {
  hud.event = text;
  hud.eventUntil = (typeof performance !== "undefined" ? performance.now() : Date.now()) + ms;
}
