// ---------------------------------------------------------------------------
// What the "Add a recipe" composer was handed, and what that means.
//
// One surface takes a link, photos, a video and the cook's own words in ANY
// combination, so the decisions that used to be made by which tab you clicked
// now have to be made from the evidence itself:
//
//   - is there enough here to read at all?
//   - does this need the reading pipeline (a link to open, pixels to look at),
//     or is it words alone, which the cheaper draft route already answers?
//   - which image is a photo of the FINISHED DISH (invent a recipe that would
//     produce it) and which is a photo of WRITING (transcribe it, don't
//     invent)? Getting that backwards is the one failure that makes the
//     feature useless — a transcribed recipe card beats a guessed one every
//     time, and a guessed one beats a model trying to read text that isn't
//     there.
//
// Pure — no fetch, no DOM — so the route, the view and the tests share it.
// ---------------------------------------------------------------------------

/** How an image should be read. "auto" lets the model decide per picture. */
export type Reading = "auto" | "dish" | "written";

export interface Attachment {
  id: string;
  kind: "image" | "video";
  /** The file's name, shown on the chip. */
  name: string;
  /** A `data:` URL — already downscaled by the time it gets here. */
  dataUrl: string;
  /** Images only; a video is always watched. */
  reading: Reading;
}

export interface Composition {
  /** The cook's own words. Always honoured, whatever else is attached. */
  note: string;
  link: string;
  attachments: Attachment[];
}

export const MAX_IMAGES = 6;
/** One image, downscaled and base64'd. Comfortably over a 1600px JPEG. */
export const MAX_IMAGE_CHARS = 4_000_000;
/** Every image together, so six large photos can't make a request nothing accepts. */
export const MAX_IMAGES_CHARS = 14_000_000;
export const MAX_VIDEO_BYTES = 20 * 1024 * 1024;

export function images(c: Composition): Attachment[] {
  return c.attachments.filter((a) => a.kind === "image");
}

export function video(c: Composition): Attachment | null {
  return c.attachments.find((a) => a.kind === "video") ?? null;
}

/** Anything at all to work from. */
export function hasEvidence(c: Composition): boolean {
  return Boolean(c.note.trim() || c.link.trim() || c.attachments.length);
}

/**
 * True when something has to be OPENED or LOOKED AT — a link to resolve, a
 * video to watch, pixels to read.
 *
 * False means words alone, which goes to the draft route instead: it is
 * cheaper, and it is the only one of the two with a template to fall back on
 * when no AI key is set, so a keyless hub still hands back something editable.
 */
export function needsReading(c: Composition): boolean {
  return Boolean(c.link.trim() || c.attachments.length);
}

/**
 * The line above the button: what is about to be read, in the order it will be
 * read. Shown so the button is never a mystery and a wrong reading is caught
 * before it is paid for.
 */
export function summarise(c: Composition): string {
  const parts: string[] = [];
  const link = c.link.trim();
  if (link) parts.push(linkLabel(link));

  const v = video(c);
  if (v) parts.push("the video");

  const imgs = images(c);
  const dish = imgs.filter((a) => a.reading === "dish").length;
  const written = imgs.filter((a) => a.reading === "written").length;
  const auto = imgs.length - dish - written;
  if (dish) parts.push(`${count(dish, "photo")} of the dish`);
  if (written) parts.push(`${count(written, "photo")} of the writing`);
  // Named, not left bare: "and one photo" at the end of the line reads as an
  // afterthought rather than as a photo nobody has told it how to read.
  if (auto) parts.push(`${count(auto, "photo")} to work out`);

  if (c.note.trim()) parts.push("your note");
  if (!parts.length) return "";
  // The verb has to match the button beside it. With nothing to open or look
  // at, nothing is being READ — a recipe is being written from a sentence, and
  // saying otherwise promises evidence that was never handed over.
  return needsReading(c) ? `Reading ${list(parts)}.` : `Writing from ${list(parts)}.`;
}

/** "a TikTok link", "a YouTube link", "that link" — never the raw URL, which is too long to read. */
function linkLabel(link: string): string {
  let host = "";
  try {
    host = new URL(link.startsWith("http") ? link : `https://${link}`).hostname.replace(/^www\./, "");
  } catch {
    return "that link";
  }
  // "https://tiktok" parses, hostname and all, so a half-typed link would be
  // summarised as if it were a site. A domain has a dot in it.
  if (!host.includes(".")) return "that link";
  const named: [RegExp, string][] = [
    [/tiktok\./, "TikTok"],
    [/instagram\./, "Instagram"],
    [/(facebook\.|fb\.watch)/, "Facebook"],
    [/(youtube\.|youtu\.be)/, "YouTube"],
    [/(twitter\.|x\.com)/, "X"],
    [/pinterest\./, "Pinterest"],
    [/reddit\./, "Reddit"],
  ];
  for (const [pattern, label] of named) if (pattern.test(host)) return `that ${label} link`;
  return host ? `${host}` : "that link";
}

function count(n: number, noun: string): string {
  const words = ["", "one", "two", "three", "four", "five", "six"];
  return `${words[n] ?? n} ${noun}${n === 1 ? "" : "s"}`;
}

function list(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * How to read each picture, as a line per image in the order they are sent.
 *
 * Positional on purpose: the model is handed the images in this order, so
 * "IMAGE 1" in the prompt and the first `image_url` part are the same picture.
 * Without that the toggle on the chip would be decoration.
 */
export function readingBrief(readings: Reading[]): string {
  if (!readings.length) return "";
  const lines = readings.map((r, i) => `IMAGE ${i + 1}: ${READING_INSTRUCTION[r]}`);
  return `THE ${readings.length === 1 ? "PHOTO" : `${readings.length} PHOTOS`} ATTACHED, in order:\n${lines.join("\n")}`;
}

const READING_INSTRUCTION: Record<Reading, string> = {
  dish: "a photo of the finished dish. Identify it, then write a recipe that would actually produce what is pictured — match what you can see (the cut, the colour, the char, the garnish, the portion). Do not pretend to read text that isn't there.",
  written:
    "a picture of WRITING — a recipe card, a cookbook page, a handwritten note, a screenshot. Transcribe it faithfully: use ITS amounts, ITS steps and ITS wording, and never substitute your own. Only fill a gap the writing leaves, and say so in \"assumptions\".",
  auto: "a photo. If it shows writing (a recipe card, a page, a screenshot), transcribe that writing faithfully and use its amounts. If it shows a finished dish, write a recipe that would produce what is pictured.",
};

/** Why this file can't be attached, or null when it can. */
export function rejectFile(file: { type: string; size: number }, already: Composition): string | null {
  if (file.type.startsWith("video/")) {
    if (video(already)) return "One video at a time. Remove the one you've attached first.";
    if (file.size > MAX_VIDEO_BYTES) return "That video is over 20 MB. Trim it, or paste the caption into your note instead.";
    return null;
  }
  if (file.type.startsWith("image/")) {
    if (images(already).length >= MAX_IMAGES) return `${MAX_IMAGES} photos is the limit.`;
    return null;
  }
  return "That file is neither a photo nor a video.";
}
