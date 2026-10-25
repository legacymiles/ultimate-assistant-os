// ---------------------------------------------------------------------------
// The film engine as a page API, for rendering outside the website.
//
// tools/film3d-render bundles this file with esbuild and drives it in a
// headless browser on the owner's PC: load the film, pull every frame as a
// JPEG and the score as a WAV, and ffmpeg makes the HD MP4. Same engine, same
// frames as the preview the owner approved — only bigger and sharper.
//
//   await film3d.load(filmJsonOrCode, 1080)  → { width, height, seconds }
//   film3d.frame(t)                          → base64 JPEG of the frame at t
//   film3d.moments()                         → the times a contact sheet should show
//   await film3d.score()                     → base64 WAV of the whole score
//   await film3d.mp4(short)                  → base64 MP4 via WebCodecs (when the browser has it)
// ---------------------------------------------------------------------------

import { parseFilmCode, type Film3D } from "./plan";
import { durationOf, keyMoments, sizeFor } from "./director";
import { FilmPlayer } from "./player";
import { renderScore, wavBytes } from "./score";
import { renderFilmToMp4 } from "./encode";

let player: FilmPlayer | null = null;
let film: Film3D | null = null;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function readFilm(input: string | Film3D): Film3D {
  if (typeof input !== "string") return input;
  const parsed = parseFilmCode(input);
  if (parsed) return parsed;
  const raw = JSON.parse(input) as Film3D;
  if (!raw?.beats?.length) throw new Error("That film has no beats.");
  return raw;
}

const api = {
  async load(input: string | Film3D, short = 1080) {
    film = readFilm(input);
    const { width, height } = sizeFor(film.aspect, short);
    player?.dispose();
    player = new FilmPlayer({ width, height, quality: "final" });
    await player.setFilm(film);
    return { width, height, seconds: durationOf(film), beats: film.beats.length, title: film.title };
  },
  frame(t: number, quality = 0.92): string {
    if (!player) throw new Error("Load a film first.");
    player.render(t);
    return player.canvas.toDataURL("image/jpeg", quality).split(",")[1];
  },
  /** The middle of every beat (and each rush cut): what a contact sheet should show. */
  moments(): number[] {
    return film ? keyMoments(film) : [];
  },
  async score(): Promise<string> {
    if (!film) throw new Error("Load a film first.");
    return toBase64(wavBytes(await renderScore(film, 48000)));
  },
  async mp4(short = 1080): Promise<string> {
    if (!film) throw new Error("Load a film first.");
    const r = await renderFilmToMp4(film, { short });
    return toBase64(new Uint8Array(await r.blob.arrayBuffer()));
  },
};

(globalThis as unknown as { film3d: typeof api }).film3d = api;
export default api;
