import "server-only";

// ---------------------------------------------------------------------------
// Cars, through Smartcar — the official way in: the owner signs in with their
// car-maker account (Ford, GM, Toyota, Tesla, Hyundai, BMW… dozens of brands)
// on Smartcar's own screen and approves location, fuel/battery and locks. We
// never see their car password.
//
// Smartcar API v3 (v2.0 retires Dec 1 2026):
//   app token   POST https://iam.smartcar.com/oauth2/token   (client credentials, 1 h)
//   connect     https://connect.smartcar.com/oauth/authorize  → redirect with user_id
//   signals     GET  https://vehicle.api.smartcar.com/v3/vehicles/{id}/signals
//               headers: Authorization: Bearer <app token>, sc-user-id: <user_id>
//
// Keys: SMARTCAR_CLIENT_ID, SMARTCAR_CLIENT_SECRET, SMARTCAR_APPLICATION_ID
// (optional SMARTCAR_MODE=simulated to try it with Smartcar's simulator).
// No keys → the car still works through the "parked here" Shortcut pin.
// ---------------------------------------------------------------------------

import { cleanFix, type Fix } from "../engine";

const TOKEN_URL = "https://iam.smartcar.com/oauth2/token";
const CONNECT_URL = "https://connect.smartcar.com/oauth/authorize";
const API = "https://vehicle.api.smartcar.com/v3";
export const SCOPES = ["read_location", "read_vehicle_info", "read_fuel", "read_battery", "read_security", "read_odometer"];

export function smartcarConfigured(): boolean {
  return Boolean(process.env.SMARTCAR_CLIENT_ID && process.env.SMARTCAR_CLIENT_SECRET && (process.env.SMARTCAR_APPLICATION_ID || process.env.SMARTCAR_CLIENT_ID));
}

export function connectUrl(origin: string, state: string): string {
  const u = new URL(CONNECT_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("application_id", process.env.SMARTCAR_APPLICATION_ID || process.env.SMARTCAR_CLIENT_ID || "");
  u.searchParams.set("redirect_uri", `${origin}/api/find-my-life/car/callback`);
  u.searchParams.set("scope", SCOPES.join(" "));
  u.searchParams.set("state", state);
  if (process.env.SMARTCAR_MODE === "simulated") u.searchParams.set("mode", "simulated");
  return u.toString();
}

let appToken: { token: string; until: number } | null = null;

async function token(): Promise<string> {
  if (appToken && appToken.until > Date.now() + 60_000) return appToken.token;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.SMARTCAR_CLIENT_ID ?? "",
      client_secret: process.env.SMARTCAR_CLIENT_SECRET ?? "",
    }),
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (res.status === 401) throw new Error("Smartcar didn't accept the Client ID / Secret. Re-copy them from the Smartcar dashboard › API Credentials.");
  if (!res.ok) throw new Error("Smartcar is having trouble right now. Your car's last parked spot still shows; try again in a minute.");
  const j = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new Error("Smartcar didn't send a token back. Try again in a minute.");
  appToken = { token: j.access_token, until: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return appToken.token;
}

async function get<T>(url: string, scUserId: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${await token()}`, "sc-user-id": scUserId, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) throw new Error("Your car connection needs to be renewed. Tap Connect car again.");
  if (res.status === 429) throw new Error("The car maker is limiting how often we can ask. Showing the last known spot.");
  if (!res.ok) throw new Error("Couldn't reach your car right now. Showing the last known spot.");
  return (await res.json()) as T;
}

/** The ids of every car this person connected. Accepts the v3 and transition shapes. */
export async function listVehicles(scUserId: string): Promise<string[]> {
  type Shape = { vehicles?: string[]; data?: { id?: string }[] };
  const read = (j: Shape) => [...(j.vehicles ?? []), ...(j.data ?? []).map((v) => v.id ?? "")].filter(Boolean);
  try {
    return read(await get<Shape>(`${API}/vehicles?limit=50`, scUserId));
  } catch {
    // During Smartcar's move to v3 the list lives under the older path.
    return read(await get<Shape>("https://api.smartcar.com/v2.0/vehicles?limit=50", scUserId));
  }
}

interface SignalRow {
  attributes?: { code?: string; status?: { value?: string }; body?: Record<string, unknown> };
  meta?: { retrievedAt?: string; oemUpdatedAt?: string };
}

export interface CarReading {
  name?: string;
  fix: Fix | null;
}

/** Where one car is, plus fuel/charge and locks when the car shares them. */
export async function readCar(vehicleId: string, scUserId: string): Promise<CarReading> {
  const j = await get<{
    data?: SignalRow[];
    included?: { vehicle?: { attributes?: { make?: string; model?: string; year?: number } } };
  }>(`${API}/vehicles/${encodeURIComponent(vehicleId)}/signals?pageSize=100`, scUserId);
  const rows = (j.data ?? []).filter((r) => r.attributes?.status?.value !== "ERROR" && r.attributes?.status?.value !== "UNAVAILABLE");
  const code = (r: SignalRow) => (r.attributes?.code ?? "").toLowerCase();
  const loc = rows.find((r) => code(r) === "location-preciselocation") ?? rows.find((r) => code(r).startsWith("location-") && r.attributes?.body?.latitude !== undefined);
  const body = loc?.attributes?.body ?? {};
  const pct = (re: RegExp) => {
    const r = rows.find((x) => re.test(code(x)));
    const v = r?.attributes?.body?.value;
    return typeof v === "number" ? Math.round(v <= 1 ? v * 100 : v) : undefined;
  };
  const fuel = pct(/fuel.*(level|percent|remaining)/);
  const charge = pct(/(stateofcharge|battery.*(level|percent))/);
  const lockRow = rows.find((r) => /islocked|lock/.test(code(r)));
  const locked = typeof lockRow?.attributes?.body?.value === "boolean" ? (lockRow.attributes.body.value as boolean) : undefined;
  const bits = [
    body.locationType === "LAST_PARKED" ? "Parked" : undefined,
    fuel !== undefined ? `Fuel ${fuel}%` : undefined,
    charge !== undefined ? `Charge ${charge}%` : undefined,
    locked === true ? "Locked" : locked === false ? "UNLOCKED" : undefined,
  ].filter(Boolean);
  const at = loc?.meta?.oemUpdatedAt || loc?.meta?.retrievedAt;
  const fix = cleanFix({ lat: body.latitude, lng: body.longitude, at, detail: bits.join(" · ") || undefined }, "car");
  const v = j.included?.vehicle?.attributes;
  const name = v?.make ? [v.year, v.make, v.model].filter(Boolean).join(" ") : undefined;
  return { name, fix };
}
