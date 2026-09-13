// ---------------------------------------------------------------------------
// Duration and display size straight from an MP4/MOV header.
//
// A video downloaded from a link has to be checked against the model's limits
// on the server, where there is no ffprobe and no <video> element. Both facts
// live in two small boxes: moov/mvhd (timescale + duration) and each
// trak/tkhd (width, height, and a matrix that says whether a phone recorded
// it sideways). Reading them needs no dependency.
//
// Pure. Returns nulls rather than throwing for anything it can't find.
// ---------------------------------------------------------------------------

export interface Mp4Info {
  /** The file starts with an ISO-BMFF `ftyp` box (mp4, mov, m4v). */
  isMp4: boolean;
  durationSec: number | null;
  /** Display size, rotation applied. */
  width: number | null;
  height: number | null;
}

interface Box {
  type: string;
  start: number;
  end: number;
}

function* boxes(dv: DataView, start: number, end: number): Generator<Box> {
  let off = start;
  while (off + 8 <= end) {
    let size = dv.getUint32(off);
    const type = String.fromCharCode(dv.getUint8(off + 4), dv.getUint8(off + 5), dv.getUint8(off + 6), dv.getUint8(off + 7));
    let header = 8;
    if (size === 1) {
      if (off + 16 > end) return;
      size = Number(dv.getBigUint64(off + 8));
      header = 16;
    } else if (size === 0) {
      size = end - off;
    }
    if (size < header || off + size > end) return;
    yield { type, start: off + header, end: off + size };
    off += size;
  }
}

function child(dv: DataView, parent: Box, type: string): Box | undefined {
  for (const b of boxes(dv, parent.start, parent.end)) if (b.type === type) return b;
  return undefined;
}

export function readMp4Info(bytes: Uint8Array): Mp4Info {
  const info: Mp4Info = { isMp4: false, durationSec: null, width: null, height: null };
  if (bytes.byteLength < 12) return info;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  info.isMp4 = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) === "ftyp";
  if (!info.isMp4) return info;

  try {
    let moov: Box | undefined;
    for (const b of boxes(dv, 0, bytes.byteLength)) if (b.type === "moov") moov = b;
    if (!moov) return info;

    const mvhd = child(dv, moov, "mvhd");
    if (mvhd) {
      const v1 = dv.getUint8(mvhd.start) === 1;
      const timescale = dv.getUint32(mvhd.start + (v1 ? 20 : 12));
      const duration = v1 ? Number(dv.getBigUint64(mvhd.start + 24)) : dv.getUint32(mvhd.start + 16);
      if (timescale > 0 && duration > 0) info.durationSec = duration / timescale;
    }

    for (const trak of boxes(dv, moov.start, moov.end)) {
      if (trak.type !== "trak") continue;
      const tkhd = child(dv, trak, "tkhd");
      if (!tkhd) continue;
      const v1 = dv.getUint8(tkhd.start) === 1;
      const matrix = tkhd.start + (v1 ? 52 : 40);
      const w = dv.getUint32(tkhd.start + (v1 ? 88 : 76)) / 65536;
      const h = dv.getUint32(tkhd.start + (v1 ? 92 : 80)) / 65536;
      if (!w || !h) continue; // audio track
      // a == d == 0 means a 90° or 270° rotation: the picture is displayed sideways.
      const rotated = dv.getInt32(matrix) === 0 && dv.getInt32(matrix + 16) === 0;
      info.width = Math.round(rotated ? h : w);
      info.height = Math.round(rotated ? w : h);
      break;
    }
  } catch {
    // A truncated or unusual file: keep whatever was read.
  }
  return info;
}
