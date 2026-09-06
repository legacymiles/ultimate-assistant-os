// Saved-scenario storage for the basket calculator. Reads stay synchronous off
// localStorage; writes also push to the signed-in user's app_state row so the
// same scenarios show up on another device. See lib/sync/appState.ts.

import { loadLocal, saveSynced } from "@/lib/sync/appState";
import type { BasketSettings, Order } from "./engine";

/** Also the app_state sync key; components pass it to useRemotePull. */
export const KEY = "moc:scenarios:v1";

export interface Scenario {
  id: string;
  name: string;
  orders: Order[];
  settings: BasketSettings;
  mode: "exit-to-pnl" | "pnl-to-exit";
  desiredPnl?: number;
  created_at: string;
  updated_at: string;
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export function loadScenarios(): Scenario[] {
  return loadLocal<Scenario[]>(KEY, []);
}

export function saveScenarios(scenarios: Scenario[]): void {
  saveSynced(KEY, scenarios);
}

export function upsertScenario(s: Scenario): Scenario[] {
  const all = loadScenarios();
  const idx = all.findIndex((x) => x.id === s.id);
  const now = new Date().toISOString();
  const next: Scenario = { ...s, updated_at: now };
  if (idx >= 0) all[idx] = next;
  else all.unshift({ ...next, created_at: now });
  saveScenarios(all);
  return all;
}

export function renameScenario(id: string, name: string): Scenario[] {
  const all = loadScenarios();
  const s = all.find((x) => x.id === id);
  if (s) {
    s.name = name;
    s.updated_at = new Date().toISOString();
    saveScenarios(all);
  }
  return all;
}

export function duplicateScenario(id: string): Scenario[] {
  const all = loadScenarios();
  const s = all.find((x) => x.id === id);
  if (!s) return all;
  const copy: Scenario = {
    ...s,
    id: uid("sc"),
    name: `${s.name} (copy)`,
    orders: s.orders.map((o) => ({ ...o, id: uid("o") })),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  all.unshift(copy);
  saveScenarios(all);
  return all;
}

export function deleteScenario(id: string): Scenario[] {
  const all = loadScenarios().filter((x) => x.id !== id);
  saveScenarios(all);
  return all;
}

// ----- export helpers ----------------------------------------------------

export function ordersToCsv(orders: Order[], settings: BasketSettings): string {
  const head = "id,side,lots,entryPrice,symbol\n";
  const rows = orders
    .map((o) =>
      [o.id, o.side, o.lots, o.entryPrice, settings.symbol].join(","),
    )
    .join("\n");
  return head + rows + "\n";
}

export function downloadFile(name: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
