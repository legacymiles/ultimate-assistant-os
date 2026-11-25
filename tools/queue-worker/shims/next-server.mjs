// The worker runs hub code outside Next.js. The only piece of next/server that
// shared code reaches for is after() (search usage logging); outside a request
// it simply runs the callback once the current work yields.
export function after(task) {
  const run = typeof task === "function" ? task : () => task;
  setTimeout(() => {
    Promise.resolve()
      .then(run)
      .catch(() => {});
  }, 0);
}
export class NextResponse extends Response {
  static json(body, init) {
    return new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  }
}
export class NextRequest extends Request {}
