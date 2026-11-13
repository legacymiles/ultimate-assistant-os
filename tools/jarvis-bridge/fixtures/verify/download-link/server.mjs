import { page, serve } from "../serve.mjs";

// /export has no file extension to give it away: only its headers say it is a
// download, and the browser refuses to "open" it.
serve({
  "/": page('<h1>Home</h1><a href="/export">Download everything</a><a href="/about">About</a>'),
  "/about": page("<h1>About</h1>"),
  "/export": () => ({
    status: 200,
    body: "name,total\nA,1\n",
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="export.csv"' },
  }),
});
