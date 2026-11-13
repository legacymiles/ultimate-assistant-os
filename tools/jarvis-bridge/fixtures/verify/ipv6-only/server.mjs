// Listens on IPv6 loopback and nowhere else, the way Vite does on a PC where
// "localhost" means ::1. With OWN_PORT it also ignores PORT and prints the
// address it chose, as Vite does.
import { createServer } from "node:http";

const port = process.env.OWN_PORT ? 0 : Number(process.env.PORT) || 0;
const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"></head><body><h1>Home</h1></body></html>');
});
server.listen(port, "::1", () => console.log(`  Local:   http://localhost:${server.address().port}/`));
