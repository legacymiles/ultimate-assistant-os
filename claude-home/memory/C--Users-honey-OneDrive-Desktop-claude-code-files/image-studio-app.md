---
name: image-studio-app
description: "Image Studio at /apps/image-studio — specialist image agents (Nostalgia, Glamour, Family Portrait, Cartoon→Real, GTA Life); user will add more agents later"
metadata: 
  node_type: memory
  type: project
  originSessionId: 9d92e240-b5b0-40b8-993d-0db67d60f934
  modified: 2026-09-14T01:03:36.276Z
---

Built 2026-09-13. Replaced the coming-soon `image-lab` catalog tile.

- **Adding an agent = one object in `src/lib/image-studio/agents.ts`** (brief, styleBlock, model, aspect, hue). The user said they will create more agents later — that file is the only place to touch.
- Flow: prompt + reference photos tagged Person/Style → Rewrite (anthropic/claude-sonnet-5 with the agent brief) → Generate via OpenRouter chat completions with `modalities: ["image","text"]`, default `google/gemini-3.1-flash-image`, image at `choices[0].message.images[].image_url.url`.
- **One image per /generate request** on purpose: Gemini PNGs are 1–2 MB base64, four would pass Vercel's 4.5 MB response limit. The client fires N parallel requests.
- Gallery: blobs in IndexedDB `image-studio-media`, metadata in localStorage `image-studio:gallery`. Not synced.
- Safety boundaries agreed with the user: Glamour = suggestive, never explicit, adults only; GTA Life uses lookalikes, never named celebrities; consent notice on uploads.
- Gotcha found in testing: without an explicit rule the rewrite model called a STYLE ref "the person from Image 1"; `refGuide` now says when there is no person reference.
- **Upload gotcha (user hit it 2026-09-13):** filtering on `file.type.startsWith("image/")` silently dropped real photos with a BLANK MIME type, and drags from web pages carry a URL not a File — both added nothing with no message. Now `src/lib/image-studio/files.ts` accepts anything that might be an image, the decoder (createImageBitmap → `<img>` fallback) decides, and every skip shows a reason. Paste-a-screenshot supported. Never reintroduce a silent filter.
- Verified live: real 1376×768 generation in ~13s, rewrite ~8s. Preview config `image-studio-preview-3221`.

Related: [[hub-ai-provider]], [[auteur-app]]
