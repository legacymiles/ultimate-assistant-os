// ---------------------------------------------------------------------------
// Printer profiles. ADD A PRINTER = one object in PRINTERS.
//
// The export engine reads a profile; it never hard-codes a printer. What a
// profile deliberately does NOT contain is as important as what it does: no
// ICC conversion, no white-ink choke, no ink limit, no mirroring, no underbase.
// Those belong to the RIP and the profile installed in it, and guessing them
// here would silently fight the operator's real settings.
// ---------------------------------------------------------------------------

import type { PrinterProfile } from "./types";

export const LANCELOT_M1630_PRO: PrinterProfile = {
  id: "lancelot-m1630-pro",
  name: "Lancelot M1630 Pro",
  rip: "ColorboxRIP",
  printhead: "Epson F1080 (XP600)",
  inks: "CMYK + White",
  media: "DTF PET transfer film — sheet or roll, automatic powder shaker + dryer",
  maxWidthMm: 300,
  safeWidthMm: 290,
  sheets: [
    { id: "a3", label: "A3 sheet", widthMm: 297, heightMm: 420 },
    { id: "a3-plus", label: "A3+ sheet", widthMm: 300, heightMm: 450 },
  ],
  maxRollLengthMm: 1000,
  targetDpi: 300,
  minGoodDpi: 200,
  minAcceptableDpi: 150,
  minLineMm: 0.5,
  ripOwns: [
    "RGB → CMYK conversion (the ICC profile in ColorboxRIP)",
    "White ink generation, choke and underbase",
    "Ink limits and density",
    "Mirroring for film (set in the RIP's job settings)",
    "Print mode, passes and head settings",
  ],
};

export const PRINTERS: PrinterProfile[] = [LANCELOT_M1630_PRO];

export const DEFAULT_PRINTER_ID = LANCELOT_M1630_PRO.id;

export function getPrinter(id?: string): PrinterProfile {
  return PRINTERS.find((p) => p.id === id) ?? LANCELOT_M1630_PRO;
}

/** Operator-adjustable settings, persisted server-side. */
export interface ProductionSettings {
  printerId: string;
  /** Safe working width, mm. Clamped to the printer's max. */
  safeWidthMm: number;
  /** Gap between designs on a gang sheet, mm. */
  gangGapMm: number;
  /** Edge margin on a gang sheet, mm. */
  gangMarginMm: number;
  /** Shop name on emails and receipts. */
  shopName: string;
  /** Pickup address shown when a customer chooses pickup. */
  pickupNote: string;
}

export const DEFAULT_SETTINGS: ProductionSettings = {
  printerId: DEFAULT_PRINTER_ID,
  safeWidthMm: LANCELOT_M1630_PRO.safeWidthMm,
  gangGapMm: 6,
  gangMarginMm: 5,
  shopName: "DTF Studio",
  pickupNote: "Local pickup — we'll message you when it's pressed and ready.",
};

export function clampSettings(s: Partial<ProductionSettings>): ProductionSettings {
  const merged = { ...DEFAULT_SETTINGS, ...s };
  const printer = getPrinter(merged.printerId);
  return {
    ...merged,
    printerId: printer.id,
    safeWidthMm: Math.max(100, Math.min(printer.maxWidthMm, Number(merged.safeWidthMm) || printer.safeWidthMm)),
    gangGapMm: Math.max(2, Math.min(30, Number(merged.gangGapMm) || DEFAULT_SETTINGS.gangGapMm)),
    gangMarginMm: Math.max(0, Math.min(20, Number(merged.gangMarginMm) || 0)),
    shopName: String(merged.shopName || DEFAULT_SETTINGS.shopName).slice(0, 60),
    pickupNote: String(merged.pickupNote || "").slice(0, 280),
  };
}

export const mmToPx = (mm: number, dpi: number) => Math.round((mm / 25.4) * dpi);
export const cmToPx = (cm: number, dpi: number) => Math.round((cm / 2.54) * dpi);
export const pxToCm = (px: number, dpi: number) => (px / dpi) * 2.54;
/** Effective DPI of `px` source pixels printed across `cm`. */
export const effectiveDpi = (px: number, cm: number) => (cm > 0 ? px / (cm / 2.54) : 0);
