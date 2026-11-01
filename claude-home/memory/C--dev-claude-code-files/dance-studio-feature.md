---
name: dance-studio-feature
description: "Dance Vault \"Studio\" view — reference dance video + reusable character → MiniMax H3 motion-transfer video; provider adapter, Supabase storage, $10 gateway video minimum"
metadata: 
  node_type: memory
  type: project
  originSessionId: 7fc758b9-9c16-458f-8a84-982ca81e8f3c
  modified: 2026-09-13T23:15:14.722Z
---

Built 2026-09-13 inside Dance Vault (`/apps/tiktok-dances?view=studio`, Wall/Studio toggle in the header).
User wanted: upload/URL a dance → pick a saved character → generate a NEW video where the character
performs that exact dance. Libraries: dances (Dance 001…), characters, generations (every take kept, regenerate).

**User chose MiniMax H3, explicitly NOT Kling** ("cheaper and looks better"). Kling v3 Motion Control is on
the gateway and purpose-built, but don't reintroduce it as default. H3 reference mode: image = identity,
video = performance ("Video 1" / "Image 1..N" labels in attach order); prompt in `src/lib/dance-studio/h3prompt.ts`.

Code: `src/lib/dance-studio/` (types, limits, h3prompt, mp4 header parser, client.ts preprocessing,
server/{storage,library,importLink,http}, server/providers/{gateway,minimax,index}), routes `src/app/api/dance-studio/*`,
UI `src/components/dances/studio/*`. Provider seam = `MotionProvider` (start → opaque operation, status(operation)).
Gateway provider uses `experimental_startVideo`/`experimental_getVideoStatus` (needed `ai` ≥7.0.76 — upgraded to 7.0.99).
MiniMax-direct provider reuses Auteur's `minimaxBackend` when `MINIMAX_API_KEY` is set.

Load-bearing facts:
- H3 limits: ref video mp4 2–15s ≤50MB URL-only; images URL-only; output 4–15s. So media MUST be in Supabase
  Storage (private bucket `dance-studio`, auto-created by `blobStore.ensureBucket`, migration 20260913120000) and
  handed over as signed links. Local-disk mode can't generate.
- Clips >15s / non-mp4 / >50MB are cut+re-encoded IN THE BROWSER (MediaRecorder mp4, Chrome/Edge/Safari; not Firefox).
- Link import uses per-site download workflows (`src/lib/social-import/videoDownload.ts` + `ytdlp.ts`,
  doc `docs/video-download-workflows.md`) — user explicitly wants ANY link (FB/YT/IG…) to work, via GitHub downloaders.
  yt-dlp is auto-fetched from the pinned GitHub release + SHA-256 checked (no install needed, works on Vercel /tmp);
  `--js-runtimes node:<execPath>` for YouTube. Verified anonymously 2026-09-13 from home IP: TikTok (tikwm),
  YouTube, Instagram reel, Facebook reel (all yt-dlp), X (FxTwitter). Per-site cookies via YTDLP_COOKIES_<SITE>;
  cobalt only if self-hosted (COBALT_API_URL). Datacenter IPs (Vercel) may get YouTube bot checks — untested there.
- Character images: prepared on pick (not on save); HEIC via lazy `heic2any`; click-or-drag drop zone, Ctrl+V paste,
  and "paste an image link" (`/api/dance-studio/fetch-image`, page links use og:image). User reported "can't upload an
  image" TWICE on this computer with NO request ever reaching the server → the native file picker most likely never
  opened (Claude desktop Browser pane / embedded browser). Paste + link paths exist for exactly that; verified in the pane.
  Tell the user to open http://localhost:<port> in real Chrome if the picker does nothing.
- Committed + pushed as c2ea16f (2026-09-13, user approved deploy). Clean `next build` needs a fresh NEXT_DIST_DIR —
  a reused `.next-verify` inside OneDrive failed with EINVAL readlink (not a code error).
- **AI Gateway refuses ALL video generation below a $10 balance** (balance was $5 on 2026-09-13). The studio shows a
  balance warning. Nothing has been rendered for real yet — pipeline verified up to the gateway start call.
- Library = server_docs doc `.dance-studio-<uid>.json` (server advances renders, so not localStorage).
- Preview with real storage: `dance-studio-preview-3220` (`--no-auth-keep-storage` flag in dev-preview.mjs).

Wall's Add dance now accepts any social link (resolve route); login-walled "Instagram" titles are treated as unreadable.

Related: [[dance-vault-app]], [[auteur-app]], [[social-link-import]], [[hub-deployment-supabase]], [[hub-ai-provider]]
