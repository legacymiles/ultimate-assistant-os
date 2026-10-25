import "server-only";

// The jobs more than one route does: record where something was seen (with
// its street address), and ask connected cars where they are.

import { addDevice, addFix, distanceM, FindError, setCar, type Doc, type Fix } from "../engine";
import { addressFor } from "./geocode";
import { readCar as readCarTokens, updateFind, writeCar } from "./store";
import { listVehicles, readCar, smartcarConfigured } from "./smartcar";

/** Fill in a street address unless the last fix was already here and had one. */
async function withAddress(doc: Doc, deviceId: string, fix: Fix): Promise<Fix> {
  if (fix.address) return fix;
  const prev = doc.devices.find((d) => d.id === deviceId)?.fixes.find((f) => f.address);
  if (prev && distanceM(prev, fix) < 60) return { ...fix, address: prev.address };
  const address = await addressFor(fix.lat, fix.lng);
  return address ? { ...fix, address } : fix;
}

export async function recordFix(uid: string, deviceId: string, fix: Fix, current: Doc): Promise<Doc> {
  if (!current.devices.some((d) => d.id === deviceId)) throw new FindError("That device isn't on your list any more.", 404);
  const full = await withAddress(current, deviceId, fix);
  const { doc } = await updateFind(uid, (d) => ({ doc: addFix(d, deviceId, full), out: null }));
  return doc;
}

const CAR_EVERY_MS = 3 * 60_000;

/**
 * Ask each connected car where it is — at most every 3 minutes per account, so
 * leaving the page open never runs up the car maker's limits. Errors come back
 * as a plain sentence; the last known spot keeps showing either way.
 */
export async function refreshCars(uid: string, doc: Doc, force = false): Promise<{ doc: Doc; error?: string }> {
  if (!smartcarConfigured()) return { doc };
  const tokens = await readCarTokens(uid);
  if (!tokens.scUserId) return { doc };
  if (!force && tokens.lastFetch && Date.now() - tokens.lastFetch < CAR_EVERY_MS) return { doc };
  await writeCar(uid, { ...tokens, lastFetch: Date.now() });
  const cars = doc.devices.filter((d) => d.carId);
  let next = doc;
  let error: string | undefined;
  for (const car of cars) {
    try {
      const r = await readCar(car.carId!, tokens.scUserId);
      if (r.fix) next = await recordFix(uid, car.id, r.fix, next);
    } catch (e) {
      error = e instanceof Error ? e.message : "Couldn't reach your car.";
    }
  }
  return { doc: next, error };
}

/** After Connect: every car they approved gets a row (reusing a car row that has none). */
export async function linkVehicles(uid: string, scUserId: string): Promise<number> {
  const ids = await listVehicles(scUserId);
  let linked = 0;
  for (const vehicleId of ids) {
    let name: string | undefined;
    try {
      name = (await readCar(vehicleId, scUserId)).name;
    } catch {
      /* the name is a nicety */
    }
    await updateFind(uid, (doc) => {
      if (doc.devices.some((d) => d.carId === vehicleId)) return { doc, out: null };
      const spare = doc.devices.find((d) => d.kind === "car" && !d.carId);
      if (spare) return { doc: setCar(doc, spare.id, vehicleId), out: null };
      const added = addDevice(doc, { kind: "car", name: name ?? "My car" });
      return { doc: setCar(added.doc, added.device.id, vehicleId), out: null };
    });
    linked++;
  }
  return linked;
}
