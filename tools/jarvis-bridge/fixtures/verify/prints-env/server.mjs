import { page, serve } from "../serve.mjs";

// Answers 500 the moment it can see anything that looks like a key, so the
// gate passes this app only if it started it with a scrubbed environment.
// Named providers only: npm adds variables of its own to a script's environment.
const leaked = () => Object.keys(process.env).filter((k) => /^(OPENROUTER|ANTHROPIC|OPENAI|SUPABASE|STRIPE)_/i.test(k));

serve({
  "/": () => (leaked().length ? { status: 500, body: `saw ${leaked().join(",")}` } : { status: 200, body: page("<h1>No keys in sight</h1>") }),
});
