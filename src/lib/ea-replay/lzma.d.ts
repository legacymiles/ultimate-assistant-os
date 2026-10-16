// LZMA-JS ships no types. Only the synchronous decompress is used: with no
// callback it returns the bytes (as signed numbers) — or a string when the
// output happens to be valid UTF-8, which the caller turns back into bytes.
declare module "lzma" {
  export function decompress(data: number[] | Uint8Array): number[] | string;
}
