import { serve } from "../serve.mjs";

// Nothing on this page is wider than a phone. The only thing wrong with it is
// the missing viewport tag, which makes a phone lay it out 980px wide anyway.
serve({
  "/": '<!doctype html><html><head><link rel="icon" href="data:,"></head><body><h1>Home</h1><p>Short.</p></body></html>',
});
