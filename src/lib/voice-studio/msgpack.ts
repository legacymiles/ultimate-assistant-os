// ---------------------------------------------------------------------------
// Minimal MessagePack encoder (server-side).
//
// fish.audio's /v1/tts accepts JSON or msgpack, but voice-cloning `references`
// carry raw audio bytes — which msgpack handles natively (JSON would need an
// undocumented base64 convention). This tiny encoder covers exactly the value
// shapes we send: maps, arrays, strings, ints, float64, bool, null, and binary
// (Uint8Array → bin). No dependency required.
//
// Spec: https://github.com/msgpack/msgpack/blob/master/spec.md
// ---------------------------------------------------------------------------

class Writer {
  private chunks: Uint8Array[] = [];
  private len = 0;

  bytes(u8: Uint8Array) {
    this.chunks.push(u8);
    this.len += u8.length;
  }

  u8(...b: number[]) {
    this.bytes(Uint8Array.from(b));
  }

  finish(): Uint8Array {
    const out = new Uint8Array(this.len);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }
}

function be(value: number, size: number): number[] {
  const out: number[] = [];
  for (let i = size - 1; i >= 0; i--) out.push((value >>> (8 * i)) & 0xff);
  return out;
}

function encodeInt(w: Writer, n: number) {
  if (n >= 0) {
    if (n < 0x80) w.u8(n); // positive fixint
    else if (n < 0x100) w.u8(0xcc, n); // uint8
    else if (n < 0x10000) w.u8(0xcd, ...be(n, 2)); // uint16
    else w.u8(0xce, ...be(n, 4)); // uint32
  } else {
    if (n >= -0x20) w.u8(0xe0 | (n & 0x1f)); // negative fixint
    else if (n >= -0x80) w.u8(0xd0, n & 0xff); // int8
    else if (n >= -0x8000) w.u8(0xd1, ...be(n & 0xffff, 2)); // int16
    else w.u8(0xd2, ...be(n >>> 0, 4)); // int32
  }
}

function encodeFloat64(w: Writer, n: number) {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, n, false); // big-endian
  w.u8(0xcb);
  w.bytes(new Uint8Array(buf));
}

function encodeStr(w: Writer, s: string) {
  const data = new TextEncoder().encode(s);
  const n = data.length;
  if (n < 0x20) w.u8(0xa0 | n); // fixstr
  else if (n < 0x100) w.u8(0xd9, n); // str8
  else if (n < 0x10000) w.u8(0xda, ...be(n, 2)); // str16
  else w.u8(0xdb, ...be(n, 4)); // str32
  w.bytes(data);
}

function encodeBin(w: Writer, data: Uint8Array) {
  const n = data.length;
  if (n < 0x100) w.u8(0xc4, n); // bin8
  else if (n < 0x10000) w.u8(0xc5, ...be(n, 2)); // bin16
  else w.u8(0xc6, ...be(n, 4)); // bin32
  w.bytes(data);
}

function encodeValue(w: Writer, v: unknown) {
  if (v === null || v === undefined) {
    w.u8(0xc0);
  } else if (typeof v === "boolean") {
    w.u8(v ? 0xc3 : 0xc2);
  } else if (typeof v === "number") {
    if (Number.isInteger(v)) encodeInt(w, v);
    else encodeFloat64(w, v);
  } else if (typeof v === "string") {
    encodeStr(w, v);
  } else if (v instanceof Uint8Array) {
    encodeBin(w, v);
  } else if (Array.isArray(v)) {
    const n = v.length;
    if (n < 0x10) w.u8(0x90 | n); // fixarray
    else if (n < 0x10000) w.u8(0xdc, ...be(n, 2)); // array16
    else w.u8(0xdd, ...be(n, 4)); // array32
    for (const item of v) encodeValue(w, item);
  } else if (typeof v === "object") {
    // Skip undefined-valued keys so callers can pass optional fields freely.
    const entries = Object.entries(v as Record<string, unknown>).filter(
      ([, val]) => val !== undefined,
    );
    const n = entries.length;
    if (n < 0x10) w.u8(0x80 | n); // fixmap
    else if (n < 0x10000) w.u8(0xde, ...be(n, 2)); // map16
    else w.u8(0xdf, ...be(n, 4)); // map32
    for (const [key, val] of entries) {
      encodeStr(w, key);
      encodeValue(w, val);
    }
  } else {
    throw new Error(`msgpack: unsupported value type ${typeof v}`);
  }
}

/** Encode a JSON-like value (with optional Uint8Array binary) to MessagePack. */
export function encodeMsgpack(value: unknown): Uint8Array {
  const w = new Writer();
  encodeValue(w, value);
  return w.finish();
}
