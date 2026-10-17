// ---------------------------------------------------------------------------
// EA World › Replay — bots you bring.
//
// A custom bot is a few lines of JavaScript with the same shape as the built-in
// ones. Either write it by hand or paste an .mq4 into "Port an EA" and the AI
// writes it (src/app/api/ea-replay/port). Either way it ends up as source text
// that runs here, in your own browser, against your own replay — it is never
// sent anywhere or run on the server.
//
// The source must evaluate to an object:
//
//   ({
//     name: "My bot",
//     params: [{ key: "Lots", label: "Lots", type: "number", default: 0.1 }],
//     create(p) {
//       return { onTick(c) { ... } };
//     },
//   })
// ---------------------------------------------------------------------------

import type { ParamSpec, StrategyDef } from "./strategy";

export interface CustomBot {
  id: string;
  name: string;
  source: string;
  /** Where it came from: "hand" or the .mq4 file name it was ported from. */
  from: string;
  createdAt: number;
}

export const CUSTOM_TEMPLATE = `({
  name: "My bot",
  summary: "Buys a fresh 1-minute high during the session, fixed stop and target.",
  params: [
    { key: "Lots", label: "Lots", type: "number", default: 0.1, min: 0.01, step: 0.01 },
    { key: "StopPts", label: "Stop (pts)", type: "int", default: 80 },
    { key: "TargetPts", label: "Target (pts)", type: "int", default: 120 },
    { key: "Lookback", label: "Lookback (M1 bars)", type: "int", default: 15 },
  ],
  create(p) {
    return {
      onTick(c) {
        if (!c.inSession(800, 1100) || c.positions().length) return;
        const highs = c.candles(60, p.Lookback + 1).map((k) => k.high);
        const prevHigh = c.ind.highest(highs, p.Lookback, 1);
        if (c.Ask > prevHigh) {
          c.OrderSend(c.OP_BUY, p.Lots, c.Ask, c.Ask - p.StopPts * c.Point, c.Ask + p.TargetPts * c.Point, "breakout");
        }
      },
    };
  },
})`;

const TYPES = new Set(["int", "number", "bool", "select"]);

/** Turns source text into a StrategyDef, or throws a message a person can act on. */
export function compileCustom(bot: CustomBot): StrategyDef {
  let raw: unknown;
  try {
    // eslint-disable-next-line no-new-func
    raw = new Function(`"use strict"; return (${bot.source.trim().replace(/;\s*$/, "")});`)();
  } catch (e) {
    throw new Error(`The code did not parse: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!raw || typeof raw !== "object") throw new Error("The code must evaluate to an object: ({ name, params, create })");
  const o = raw as Record<string, unknown>;
  if (typeof o.create !== "function") throw new Error("Missing create(params) — it must return { onTick(c) { … } }");
  const params: ParamSpec[] = Array.isArray(o.params)
    ? (o.params as Record<string, unknown>[])
        .filter((s) => s && typeof s.key === "string")
        .map((s) => ({
          key: String(s.key),
          label: typeof s.label === "string" ? s.label : String(s.key),
          type: (TYPES.has(String(s.type)) ? s.type : "number") as ParamSpec["type"],
          default: (s.default ?? 0) as ParamSpec["default"],
          min: typeof s.min === "number" ? s.min : undefined,
          max: typeof s.max === "number" ? s.max : undefined,
          step: typeof s.step === "number" ? s.step : undefined,
          options: Array.isArray(s.options) ? (s.options as ParamSpec["options"]) : undefined,
          group: typeof s.group === "string" ? s.group : undefined,
          hint: typeof s.hint === "string" ? s.hint : undefined,
        }))
    : [];
  const create = o.create as StrategyDef["create"];
  return {
    id: bot.id,
    name: typeof o.name === "string" && o.name.trim() ? o.name : bot.name,
    summary: typeof o.summary === "string" ? o.summary : `Custom bot (${bot.from})`,
    origin: "custom",
    params,
    suggestedSession: typeof o.suggestedSession === "string" ? o.suggestedSession : undefined,
    create: (p) => {
      const inst = create(p);
      if (!inst || typeof (inst as { onTick?: unknown }).onTick !== "function") {
        throw new Error("create() must return an object with onTick(c)");
      }
      return inst;
    },
  };
}

/** Pulls the code out of a model reply that may wrap it in a ``` fence. */
export function extractCode(reply: string): string {
  const fence = reply.match(/```(?:js|javascript|ts|typescript)?\s*\n([\s\S]*?)```/);
  return (fence ? fence[1] : reply).trim();
}
