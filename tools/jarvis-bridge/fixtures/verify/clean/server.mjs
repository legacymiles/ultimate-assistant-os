import { page, serve } from "../serve.mjs";

serve({
  "/": page('<h1>Home</h1><a href="/about">About</a>'),
  "/about": page('<h1>About</h1><a href="/">Home</a>'),
});
