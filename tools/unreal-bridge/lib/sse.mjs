// Parse a Server-Sent Events body into the JSON messages it carries.
//
// Epic's MCP server answers `tools/call` with `text/event-stream`: progress
// notifications and the final JSON-RPC result each arrive as one event. An
// event ends at a blank line; its `data:` lines are joined with "\n". Anything
// after the last blank line is an event still being written, so it is left
// out rather than half-parsed.

export function parseSse(text) {
  const normalized = String(text).replace(/\r\n?/g, "\n");
  const blocks = normalized.split("\n\n");
  // The final block has no terminating blank line: incomplete, skip it.
  blocks.pop();

  const out = [];
  for (const block of blocks) {
    const data = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (!data.length) continue;
    try {
      out.push(JSON.parse(data.join("\n")));
    } catch {
      // A non-JSON event (a keep-alive comment, say) carries nothing for us.
    }
  }
  return out;
}
