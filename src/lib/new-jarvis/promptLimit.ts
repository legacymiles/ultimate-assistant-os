// ---------------------------------------------------------------------------
// How long a prompt typed or pasted into any Jarvis chat may be.
//
// One number for every place a person talks to Jarvis or a harness: the main
// chat, the Website Studio and Client Review boxes, the steer box while a build
// runs, App Builder's idea and agent chat, In Queue requests and the Enhance
// button. Each used to carry its own cap (2,000 here, 4,000 there), and a long
// prompt pasted into the Studio was quietly cut off at 2,000 characters.
//
// 100,000 characters is about 25,000 tokens — a long spec or a whole master
// prompt fits, and it is still far inside every model's context and every
// request-size limit on the way (Vercel's 4.5 MB body, the PC helper's 20 MB).
// Pure and dependency-free, so the browser and the server read the same value.
// ---------------------------------------------------------------------------

export const MAX_PROMPT_CHARS = 100_000;
