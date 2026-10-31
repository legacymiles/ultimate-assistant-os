// ---------------------------------------------------------------------------
// The one choke point between the tree and any AI call.
//
// Profile holds passwords, card numbers, door codes and ID numbers. Those must
// never reach a model, an embedding, About Me or the Map — not because a model
// would misuse them, but because anything in context can be echoed back into a
// chat transcript, and a transcript is not where a door code belongs.
//
// So there is exactly ONE function that turns the tree into text for an AI, it
// drops `secret` values on the floor, and `profile.test.ts` fails if a planted
// secret ever appears in its output. Every route imports this; none of them
// serialises nodes themselves.
// ---------------------------------------------------------------------------

import { childrenOf, pathOf, roots } from "./model";
import type { Basics, Node } from "./types";

/** What replaces a secret, so the model knows the fact EXISTS without seeing it. */
const HELD = "[held in vault]";

export function isSecret(label: string, kind: string): boolean {
  if (kind === "secret") return true;
  // Belt and braces: a field the owner typed into a plain text row but named
  // like a credential is treated as one anyway.
  return /(password|passcode|pin\b|cvv|secret|private key|api key|door code|alarm code|ssn|social security|full number|routing)/i.test(label);
}

export interface RedactOptions {
  /** Cap the output so a 500-folder tree cannot blow the context window. */
  maxChars?: number;
  /** Include field values (false = structure only, for the Map). */
  values?: boolean;
  /**
   * Tag each folder line with its node id, e.g. `- Acme (job) #a1b2c3d4`.
   *
   * About Me's provenance is only real if the model cites the folders it used,
   * and it can only cite ids it was shown. Off by default: a plain read of the
   * tree should not be littered with ids.
   */
  withIds?: boolean;
  /**
   * Drop branches that hold no values at all.
   *
   * A seeded profile is mostly empty folders, and a model shown an empty
   * "Health" folder will dutifully write "Health folder is on file" into the
   * briefing. That is not a fact, and About Me is read on every turn — so the
   * empty half of the tree is simply not sent when the output is prose.
   */
  onlyFilled?: boolean;
}

/**
 * The tree as indented text, secrets removed. This is the ONLY representation
 * of the tree that is allowed to leave the browser.
 */
export function redactForAi(nodes: Node[], basics: Basics, opts: RedactOptions = {}): string {
  const { maxChars = 24_000, values = true, withIds = false, onlyFilled = false } = opts;
  const lines: string[] = [];
  const tag = (n: Node) => (withIds ? ` #${n.id}` : "");

  const hasValue = (n: Node) => n.fields.some((f) => f.value.trim()) || n.notes.trim().length > 0;
  /** A branch is worth sending if it, or anything under it, holds a value. */
  const worth = (n: Node): boolean => {
    if (!onlyFilled) return true;
    if (hasValue(n)) return true;
    return childrenOf(nodes, n.id).some(worth);
  };

  const who = [
    basics.name && `Name: ${basics.name}`,
    basics.birthday && `Birthday: ${basics.birthday}`,
    basics.pronouns && `Pronouns: ${basics.pronouns}`,
    basics.location && `Location: ${basics.location}`,
    basics.headline && `Always know: ${basics.headline}`,
  ].filter(Boolean);
  if (who.length) lines.push(who.join("\n"), "");

  const walk = (parentId: string | null, depth: number) => {
    for (const n of childrenOf(nodes, parentId)) {
      if (!worth(n)) continue;
      const pad = "  ".repeat(depth);
      lines.push(`${pad}- ${n.name}${n.pack ? ` (${n.pack})` : ""}${tag(n)}`);
      if (values) {
        for (const f of n.fields) {
          if (!f.value.trim()) continue;
          const v = isSecret(f.label, f.kind) ? HELD : f.value.replace(/\s+/g, " ").slice(0, 300);
          lines.push(`${pad}    ${f.label}: ${v}${f.confirmed ? "" : "  (unconfirmed)"}`);
        }
        if (n.notes.trim()) lines.push(`${pad}    notes: ${n.notes.replace(/\s+/g, " ").slice(0, 400)}`);
      }
      walk(n.id, depth + 1);
    }
  };
  // Roots are walked explicitly so a node with a dangling parentId is still reached.
  for (const r of roots(nodes)) {
    if (!worth(r)) continue;
    lines.push(`- ${r.name}${tag(r)}`);
    if (values) {
      for (const f of r.fields) {
        if (!f.value.trim()) continue;
        lines.push(`    ${f.label}: ${isSecret(f.label, f.kind) ? HELD : f.value.slice(0, 300)}`);
      }
    }
    walk(r.id, 1);
  }

  const text = lines.join("\n");
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…(truncated)` : text;
}

/**
 * The Map — the video's `AGENTS.md`, generated for Jarvis's system prompt.
 *
 * Structure and RULES, never values. It is what makes a 300-folder profile
 * legible to a model: without it the model greps blindly and invents.
 */
export function buildMap(nodes: Node[], basics: Basics): string {
  const where = roots(nodes)
    .map((r) => {
      const kids = childrenOf(nodes, r.id).map((c) => c.name);
      return `- **${r.name}** — ${kids.length ? kids.join(", ") : "empty"}`;
    })
    .join("\n");

  const vaulted = nodes
    .flatMap((n) => n.fields.filter((f) => isSecret(f.label, f.kind) && f.value.trim()).map((f) => `${pathOf(nodes, n.id)} · ${f.label}`))
    .slice(0, 40);

  return `# Profile map

${basics.name ? `${basics.name}'s personal record. ` : ""}Read this before answering anything about the owner.

## Where things live

${where || "- (nothing yet — the profile has not been seeded)"}

## Rules

- **About Me** is the briefing and is already in your context. Read it first; open folders only when it does not answer the question.
- Facts come from the folder they live in, never from memory of an earlier conversation.
- A field marked \`(unconfirmed)\` was drafted by AI and not yet agreed. Say so when you use it.
- **Secrets never enter chat.** Passwords, card numbers, door codes, ID and routing numbers are held in the vault and shown as ${HELD}. If the owner asks for one, tell them which folder holds it and let them reveal it themselves.
- When a new fact arrives, write it to the folder it belongs to and say which folder you changed.

## Held in the vault (names only, ${vaulted.length})

${vaulted.length ? vaulted.map((v) => `- ${v}`).join("\n") : "- (none yet)"}
`;
}
