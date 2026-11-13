import { createServer } from "node:http";

import { page, serve } from "../serve.mjs";

// Somebody else's site: another port is another origin. Its script complains
// in the console of whichever page loads it.
const other = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/javascript" });
  res.end('console.error("the advert could not reach its tracker")');
});
await new Promise((ready) => other.listen(0, "127.0.0.1", ready));

serve({
  "/": page(`<h1>Home</h1><script src="http://127.0.0.1:${other.address().port}/widget.js"></script><a href="/own">Own</a>`),
  "/own": page('<h1>Own</h1><script>console.error("the cart could not be read")</script>'),
});
