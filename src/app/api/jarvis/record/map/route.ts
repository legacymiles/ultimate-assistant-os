import { NextResponse } from "next/server";
import { aiEndpoint, aiFetch, DEFAULT_MODEL } from "@/lib/ai/provider";
import { learnMapping, mappingFor } from "@/lib/jarvis/record/inbox";
import { mappableKeys, matchField } from "@/lib/jarvis/record/fields";
import { cors, extensionUid, preflight, unauthorized } from "@/lib/jarvis/record/http";
import { FIELD_BY_KEY, groupById, groupField } from "@/lib/jarvis/record/types";

// Which record field each field of this web form is.
//
// The extension asks this once per page and uses the answer for BOTH
// directions — deciding what a captured value is, and deciding where a known
// value should be typed. One answer for both, because a mapping that differed
// between capture and fill would quietly corrupt the record.
//
// Three rungs, cheapest first:
//
//   1. THE RULES (fields.ts). A well-built form declares `autocomplete` and is
//      solved here, instantly and for free. Most commercial job boards are.
//   2. WHAT THIS SITE ALREADY TAUGHT US. Cached per domain, so a portal is
//      only ever puzzled out once.
//   3. THE MODEL, on whatever is left — the `ctl00$Main$txt17` inputs that
//      government portals are built from. Its answer is cached at rung 2.
//
// Sending every field to a model would be slower, cost money, and be worse
// than the rule that already knows what `given-name` means.

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `You map a web form's fields onto a personal-record schema, for someone filling in job and benefits applications.

For each field you are given, answer with the record key it corresponds to, or null if none fit. Judge by what the field MEANS to the person filling it: read the label first and the technical name second.

Rules:
- null is a correct and common answer. A job-posting reference, a CAPTCHA, a search box, a site's own account settings, a "how did you hear about us" — all map to nothing. Guessing is worse than null: a wrong mapping writes a phone number into a licence number.
- Never map a password, a security question, a payment field or a CAPTCHA to anything at all.
- A field about a PREVIOUS employer maps to a jobs.* key. A field about another person in the home maps to a household_members.* key.

Answer with JSON only: {"map":{"<the ref you were given>":"<record key or null>"}}`;

export function OPTIONS() {
  return preflight();
}

/** Only keys the schema actually has. A hallucinated key is dropped. */
function known(key: string): boolean {
  if (FIELD_BY_KEY.has(key)) return true;
  const [groupId, field] = key.split(".");
  return Boolean(groupId && field && groupById(groupId) && groupField(groupId, field));
}

interface Incoming {
  ref: string;
  name: string;
  id: string;
  autocomplete: string;
  label: string;
  placeholder: string;
  type: string;
}

export async function POST(req: Request) {
  const uid = await extensionUid(req);
  if (!uid) return cors(unauthorized());

  const body = (await req.json().catch(() => ({}))) as { domain?: unknown; fields?: unknown };
  const domain = typeof body.domain === "string" ? body.domain.slice(0, 120) : "";
  const s = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

  const fields: Incoming[] = Array.isArray(body.fields)
    ? body.fields
        .slice(0, 80)
        .map((f) => {
          const o = (f ?? {}) as Record<string, unknown>;
          return {
            ref: s(o.ref, 80),
            name: s(o.name, 120),
            id: s(o.id, 120),
            autocomplete: s(o.autocomplete, 80),
            label: s(o.label, 200),
            placeholder: s(o.placeholder, 200),
            type: s(o.type, 20),
          };
        })
        .filter((f) => f.ref)
    : [];

  if (!domain || !fields.length) {
    return cors(NextResponse.json({ error: "Nothing to map." }, { status: 400 }));
  }

  const map: Record<string, string> = {};
  const by: Record<string, string> = {};

  // Rung 1: the rules.
  const leftover: Incoming[] = [];
  for (const f of fields) {
    const hit = matchField(f);
    if (hit) {
      map[f.ref] = hit.key;
      by[f.ref] = hit.by;
    } else {
      leftover.push(f);
    }
  }

  // Rung 2: what this site taught us before, keyed on the page's own words.
  const cached = await mappingFor(uid, domain);
  const unsolved: Incoming[] = [];
  for (const f of leftover) {
    const hit = cached[f.name] ?? cached[f.id] ?? cached[f.label];
    if (hit && known(hit)) {
      map[f.ref] = hit;
      by[f.ref] = "learned";
    } else {
      unsolved.push(f);
    }
  }

  if (!unsolved.length) return cors(NextResponse.json({ map, by }));

  if (!aiEndpoint()) {
    return cors(
      NextResponse.json({
        map,
        by,
        note: `${unsolved.length} field${unsolved.length === 1 ? "" : "s"} could not be placed by name, and there is no AI key on this deployment to read their labels.`,
      }),
    );
  }

  // Rung 3: the model, on the leftovers only.
  try {
    const res = await aiFetch({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: 2000,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content:
              `Site: ${domain}\n\nRECORD KEYS: ${mappableKeys()}\n\nFIELDS:\n` +
              unsolved
                .map(
                  (f) =>
                    `- ref "${f.ref}" · label "${f.label || f.placeholder}" · name "${f.name || f.id}" · type ${f.type}`,
                )
                .join("\n"),
          },
        ],
      }),
    });

    if (!res.ok) return cors(NextResponse.json({ map, by, note: `The model refused that (${res.status}).` }));

    const data = await res.json();
    const raw = typeof data?.choices?.[0]?.message?.content === "string" ? data.choices[0].message.content : "";
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return cors(NextResponse.json({ map, by }));

    const parsed = JSON.parse(raw.slice(start, end + 1)) as { map?: Record<string, unknown> };
    const learned: Record<string, string> = {};

    for (const [ref, key] of Object.entries(parsed.map ?? {})) {
      if (typeof key !== "string" || !known(key)) continue;
      const field = unsolved.find((f) => f.ref === ref);
      if (!field) continue;
      map[ref] = key;
      by[ref] = "model";
      // Cached against the page's own words, not the ref: a ref is generated
      // fresh on every page load, so caching it would teach us nothing.
      const anchor = field.name || field.id || field.label;
      if (anchor) learned[anchor] = key;
    }

    if (Object.keys(learned).length) await learnMapping(uid, domain, learned);
    return cors(NextResponse.json({ map, by, learned: Object.keys(learned).length }));
  } catch (e) {
    return cors(NextResponse.json({ map, by, note: e instanceof Error ? e.message : "Mapping failed." }));
  }
}
