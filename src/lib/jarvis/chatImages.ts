// ---------------------------------------------------------------------------
// Pictures attached to a chat turn.
//
// Each image is shrunk in the browser twice: a full copy the model reads
// (long edge 1568 px, the size vision models tile at) and a thumbnail that is
// saved in the conversation. Only the thumbnail syncs across devices; the full
// copy lives for this session, so a follow-up question can still see it.
// ---------------------------------------------------------------------------

export const MAX_ATTACHMENTS = 4;
const FULL_EDGE = 1568;
const THUMB_EDGE = 240;

export interface Attachment {
  id: string;
  /** What the model reads. */
  full: string;
  /** What the conversation keeps. */
  thumb: string;
  name: string;
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file isn't an image I can read."));
    };
    img.src = url;
  });
}

function shrink(img: HTMLImageElement, edge: number, quality: number): string {
  const scale = Math.min(1, edge / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't resize images.");
  // JPEG has no alpha: paint white first so transparent screenshots stay legible.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

export async function toAttachment(file: File, id: string): Promise<Attachment> {
  if (!file.type.startsWith("image/")) throw new Error(`${file.name || "That file"} isn't an image.`);
  const img = await loadImage(file);
  return {
    id,
    full: shrink(img, FULL_EDGE, 0.85),
    thumb: shrink(img, THUMB_EDGE, 0.7),
    name: file.name || "pasted image",
  };
}

/** Image files out of a paste or drop, in order. */
export function imageFiles(list: DataTransfer | null): File[] {
  if (!list) return [];
  return Array.from(list.files).filter((f) => f.type.startsWith("image/"));
}
