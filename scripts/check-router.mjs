// ---------------------------------------------------------------------------
// Does the router's table still match OpenRouter?
//
//   npm run check:router
//
// src/lib/ai/router.ts hard-codes facts about six models: what each one reads,
// whether it does JSON, how much context it has, what it costs. Those facts are
// the whole routing decision — if MiMo quietly loses audio, or the free Qwen
// stops being free, the router keeps making a decision that used to be right.
//
// So this re-reads OpenRouter's public model list (no key needed) and compares.
// It exits non-zero on a real difference, which is the point: it is meant to be
// run before a deploy, not admired.
//
// Prices are allowed to move a little without failing — providers re-price often
// and a fraction of a cent does not change any rule here. Modalities, JSON
// support and a model going missing are hard failures, because each one turns a
// routing rule into a broken call.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";

const SOURCE = "src/lib/ai/router.ts";
const PRICE_TOLERANCE = 0.5; // 50% drift before it is worth a person's attention.

/** The ROUTER_MODELS array, read out of the TypeScript without compiling it. */
function tableFrom(source) {
  const body = source.slice(source.indexOf("export const ROUTER_MODELS"));
  const models = [];
  for (const block of body.split(/\n  \{\n/).slice(1)) {
    const chunk = block.split(/\n  \},?\n/)[0];
    const str = (key) => chunk.match(new RegExp(`${key}:\\s*"([^"]+)"`))?.[1];
    const num = (key) => {
      const raw = chunk.match(new RegExp(`${key}:\\s*([0-9_.]+)`))?.[1];
      return raw === undefined ? undefined : Number(raw.replace(/_/g, ""));
    };
    const id = str("id");
    if (!id) continue;
    const reads = (chunk.match(/reads:\s*\[([^\]]*)\]/)?.[1] ?? "")
      .split(",")
      .map((s) => s.trim().replace(/"/g, ""))
      .filter(Boolean);
    const price = chunk.match(/price:\s*\[([^\]]*)\]/)?.[1];
    models.push({
      id,
      label: str("label"),
      reads,
      json: /json:\s*true/.test(chunk),
      context: num("context"),
      price: price ? price.split(",").map((p) => Number(p.trim())) : null,
    });
    if (models.length > 40) break;
  }
  return models;
}

const table = tableFrom(readFileSync(SOURCE, "utf8"));
if (table.length === 0) {
  console.error(`Could not read ROUTER_MODELS out of ${SOURCE}.`);
  process.exit(2);
}

const res = await fetch("https://openrouter.ai/api/v1/models");
if (!res.ok) {
  console.error(`OpenRouter's model list answered ${res.status}. Not a router problem; try again.`);
  process.exit(2);
}
const live = new Map((await res.json()).data.map((m) => [m.id, m]));

const problems = [];
const notes = [];

for (const model of table) {
  const actual = live.get(model.id);
  if (!actual) {
    problems.push(`${model.id} is no longer on OpenRouter. The ${model.label} rung has no model.`);
    continue;
  }

  const reads = [...(actual.architecture?.input_modalities ?? [])].sort();
  const claimed = [...model.reads].sort();
  const lost = claimed.filter((r) => !reads.includes(r));
  const gained = reads.filter((r) => !claimed.includes(r));
  if (lost.length) problems.push(`${model.id} no longer reads ${lost.join(", ")} — the table says it does.`);
  if (gained.length) notes.push(`${model.id} now also reads ${gained.join(", ")}; the table has not caught up.`);

  const json = (actual.supported_parameters ?? []).includes("response_format");
  if (json !== model.json) {
    problems.push(
      `${model.id} JSON support is ${json ? "now available" : "gone"}; the table says ${model.json}. The strict-JSON rule depends on this.`,
    );
  }

  const context = Number(actual.context_length ?? 0);
  if (context < model.context) {
    problems.push(`${model.id} context shrank to ${context.toLocaleString()} from the ${model.context.toLocaleString()} in the table.`);
  } else if (context > model.context) {
    notes.push(`${model.id} context grew to ${context.toLocaleString()}; the table still says ${model.context.toLocaleString()}.`);
  }

  if (model.price) {
    const [inLive, outLive] = [Number(actual.pricing?.prompt ?? 0) * 1e6, Number(actual.pricing?.completion ?? 0) * 1e6];
    const [inSaid, outSaid] = model.price;
    const free = inSaid === 0 && outSaid === 0;
    if (free && (inLive > 0 || outLive > 0)) {
      problems.push(`${model.id} is no longer free: $${inLive.toFixed(3)}/$${outLive.toFixed(3)} per million.`);
    } else if (!free) {
      const drift = (said, now) => said > 0 && Math.abs(now - said) / said > PRICE_TOLERANCE;
      if (drift(inSaid, inLive) || drift(outSaid, outLive)) {
        notes.push(
          `${model.id} re-priced: table says $${inSaid}/$${outSaid}, OpenRouter says $${inLive.toFixed(3)}/$${outLive.toFixed(3)} per million.`,
        );
      }
    }
  }
}

for (const note of notes) console.log(`note   ${note}`);
for (const problem of problems) console.error(`BROKEN ${problem}`);

if (problems.length) {
  console.error(`\n${problems.length} routing rule(s) no longer match OpenRouter. Fix ${SOURCE}.`);
  process.exit(1);
}
console.log(`\nAll ${table.length} router models still match OpenRouter${notes.length ? `, with ${notes.length} note(s) above` : ""}.`);
