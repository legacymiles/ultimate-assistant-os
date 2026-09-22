"use client";

// The realtime half of the demo backend.
//
// Supabase Realtime carries three things Cook Connect needs: row changes (so a
// board updates when the other player moves), presence (who is at the table),
// and broadcast (video-call signalling). Without keys, all three run over a
// BroadcastChannel instead — which means two tabs of the same browser really
// can play each other, chat, and see each other's presence, with no server.
//
// A BroadcastChannel does not reach another device, so demo mode is honest
// about its limits: it is one browser, and the computer players fill the rest.

import { onLocalChange, type Row } from "./db";

type PgHandler = (payload: { eventType: string; new: Row; old: Row }) => void;
type PresenceHandler = () => void;
type BroadcastHandler = (msg: { event: string; payload: unknown }) => void;

interface PgBinding {
  event: string;
  table: string;
  filter?: string;
  cb: PgHandler;
}

type Wire =
  | { t: "presence"; channel: string; key: string; state: Record<string, unknown> | null }
  | { t: "broadcast"; channel: string; event: string; payload: unknown }
  | { t: "db"; channel: "*"; table: string; event: string; row: Row };

/** One BroadcastChannel for the whole app; channels are multiplexed over it. */
let wire: BroadcastChannel | null = null;
const channels = new Set<LocalChannel>();

function getWire(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!wire) {
    wire = new BroadcastChannel("cook-connect-local");
    wire.onmessage = (e: MessageEvent<Wire>) => {
      for (const ch of channels) ch.receive(e.data);
    };
    // Every tab republishes its own row writes so the others hear them.
    onLocalChange((table, event, row) => {
      post({ t: "db", channel: "*", table, event, row });
      for (const ch of channels) ch.receive({ t: "db", channel: "*", table, event, row });
    });
  }
  return wire;
}

function post(msg: Wire) {
  try { getWire()?.postMessage(msg); } catch { /* channel closed */ }
}

/** Matches PostgREST's `col=eq.value` filter string. */
function passesFilter(filter: string | undefined, row: Row): boolean {
  if (!filter) return true;
  const m = filter.match(/^(.+?)=eq\.(.*)$/);
  if (!m) return true;
  return String(row[m[1]] ?? "") === m[2];
}

export class LocalChannel {
  private pg: PgBinding[] = [];
  private presenceHandlers: PresenceHandler[] = [];
  private broadcastHandlers: { event: string; cb: BroadcastHandler }[] = [];
  private presence: Record<string, unknown[]> = {};
  private myKey: string;
  private mine: Record<string, unknown> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(public readonly name: string, config?: { presence?: { key?: string } }) {
    this.myKey = config?.presence?.key ?? Math.random().toString(36).slice(2);
  }

  on(type: "postgres_changes", opts: { event: string; table: string; filter?: string }, cb: PgHandler): this;
  on(type: "presence", opts: { event: string }, cb: PresenceHandler): this;
  on(type: "broadcast", opts: { event: string }, cb: BroadcastHandler): this;
  on(type: string, opts: Record<string, string | undefined>, cb: unknown): this {
    if (type === "postgres_changes") {
      this.pg.push({ event: opts.event!, table: opts.table!, filter: opts.filter, cb: cb as PgHandler });
    } else if (type === "presence") {
      this.presenceHandlers.push(cb as PresenceHandler);
    } else if (type === "broadcast") {
      this.broadcastHandlers.push({ event: opts.event!, cb: cb as BroadcastHandler });
    }
    return this;
  }

  subscribe(cb?: (status: string) => void): this {
    channels.add(this);
    getWire();
    // Re-announce periodically so a tab that closed without saying goodbye
    // eventually drops out of everyone else's roster.
    this.heartbeat = setInterval(() => {
      if (this.mine) post({ t: "presence", channel: this.name, key: this.myKey, state: this.mine });
    }, 4000);
    setTimeout(() => cb?.("SUBSCRIBED"), 0);
    return this;
  }

  async track(state: Record<string, unknown>) {
    this.mine = state;
    this.presence[this.myKey] = [state];
    post({ t: "presence", channel: this.name, key: this.myKey, state });
    this.presenceHandlers.forEach((h) => h());
  }

  async untrack() {
    this.mine = null;
    delete this.presence[this.myKey];
    post({ t: "presence", channel: this.name, key: this.myKey, state: null });
    this.presenceHandlers.forEach((h) => h());
  }

  presenceState(): Record<string, unknown[]> {
    return this.presence;
  }

  send(msg: { type: string; event: string; payload: unknown }) {
    post({ t: "broadcast", channel: this.name, event: msg.event, payload: msg.payload });
  }

  /** Called by the wire for every message, from this tab or another. */
  receive(msg: Wire) {
    if (msg.t === "db") {
      for (const b of this.pg) {
        if (b.table !== msg.table) continue;
        if (b.event !== "*" && b.event !== msg.event) continue;
        if (!passesFilter(b.filter, msg.row)) continue;
        b.cb({ eventType: msg.event, new: msg.row, old: msg.row });
      }
      return;
    }
    if (msg.channel !== this.name) return;
    if (msg.t === "presence") {
      if (msg.key === this.myKey) return; // our own echo
      if (msg.state === null) delete this.presence[msg.key];
      else this.presence[msg.key] = [msg.state];
      this.presenceHandlers.forEach((h) => h());
      // Answer a newcomer so they learn about us immediately.
      if (msg.state && this.mine) {
        post({ t: "presence", channel: this.name, key: this.myKey, state: this.mine });
      }
      return;
    }
    if (msg.t === "broadcast") {
      this.broadcastHandlers
        .filter((h) => h.event === msg.event)
        .forEach((h) => h.cb({ event: msg.event, payload: msg.payload }));
    }
  }

  teardown() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    void this.untrack();
    channels.delete(this);
  }
}

export function removeLocalChannel(channel: LocalChannel) {
  channel.teardown();
}
