import { page, serve } from "../serve.mjs";

// One missing file, used by every page: one fault, not three.
const logo = '<img src="/logo.png" alt="">';

serve({
  "/": page(`<h1>Home</h1>${logo}<a href="/a">A</a><a href="/b">B</a>`),
  "/a": page(`<h1>A</h1>${logo}`),
  "/b": page(`<h1>B</h1>${logo}`),
});
