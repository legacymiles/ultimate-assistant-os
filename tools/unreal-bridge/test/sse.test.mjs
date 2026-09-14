import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSse } from "../lib/sse.mjs";

test("parses complete events in order", () => {
  const body = 'event: message\ndata: {"a":1}\n\ndata: {"b":2}\n\n';
  assert.deepEqual(parseSse(body), [{ a: 1 }, { b: 2 }]);
});

test("joins multi-line data fields", () => {
  const body = 'data: {"a":\ndata: 1}\n\n';
  assert.deepEqual(parseSse(body), [{ a: 1 }]);
});

test("ignores a trailing event that is still being written", () => {
  const body = 'data: {"a":1}\n\ndata: {"b":';
  assert.deepEqual(parseSse(body), [{ a: 1 }]);
});

test("handles CRLF line endings and non-JSON events", () => {
  const body = ': keep-alive\r\n\r\ndata: {"ok":true}\r\n\r\n';
  assert.deepEqual(parseSse(body), [{ ok: true }]);
});
