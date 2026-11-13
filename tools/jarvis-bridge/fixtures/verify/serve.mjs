// A tiny app for the verify gate's tests: no packages, no framework.
import { createServer } from "node:http";

/** `routes` maps a path to an HTML string, or to a function returning { status, body, headers? }. */
export function serve(routes) {
  const port = Number(process.env.PORT) || 0;
  createServer((req, res) => {
    const at = new URL(req.url, "http://x").pathname;
    const hit = routes[at];
    const out = typeof hit === "function" ? hit() : hit != null ? { status: 200, body: hit } : { status: 404, body: "<h1>Not found</h1>" };
    res.writeHead(out.status, { "Content-Type": "text/html; charset=utf-8", ...out.headers });
    res.end(out.body);
  }).listen(port, "127.0.0.1", () => console.log(`listening on http://127.0.0.1:${port}`));
}

export const page = (body) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"></head><body>${body}</body></html>`;
