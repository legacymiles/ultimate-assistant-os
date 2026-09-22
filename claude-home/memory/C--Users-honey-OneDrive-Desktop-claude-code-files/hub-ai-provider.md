---
name: hub-ai-provider
description: "Every AI call in the hub goes through src/lib/ai/provider.ts; OpenRouter is preferred because Vercel's AI Gateway free tier serves no Anthropic model even with a card"
metadata: 
  node_type: memory
  type: project
  originSessionId: f7036341-5d5a-42e2-b792-c3a5dfd42723
  modified: 2026-09-19T01:26:30.438Z
---

Decided 2026-09-07. Every AI call site in the hub resolves its endpoint and key
through `src/lib/ai/provider.ts` (`aiEndpoint()` / `aiUrl()` / `aiKey()` /
`DEFAULT_MODEL`). Before this, 16 files hardcoded the Vercel gateway.

**Why OpenRouter is preferred over the Vercel AI Gateway:** the gateway's free
tier serves **no Anthropic model at all** — not Opus 5, not Sonnet 5, not even
Haiku. Adding a credit card is *not* enough; the 403 changes from
`customer_verification_required` to "Free tier users do not have access to this
model", which needs purchased credits. OpenRouter carries the same
`anthropic/claude-opus-5` at the same $5/$25 per 1M and is already funded. Both
speak an identical OpenAI-compatible `/chat/completions` shape and accept the
**same** model strings, which is the only reason one function covers both.

**2026-09-18 update — switchboard + fallback.** The owner picks the provider on the hub front page (AI pill next to V1/V2, `src/components/hub/AiPanel.tsx`); choice + fallback flags + each provider's last error live in server doc `ai-settings` (`src/lib/ai/settings.ts`, 10 s cache). New call sites must use `aiFetch(init)` (sets Authorization, retries on the other provider on 401/402/403/429/5xx/network), not raw `fetch(aiUrl())`. `/api/ai/status` reports credit left (OpenRouter /api/v1/credits, gateway /v1/credits), last errors, builder Claude-plan problems, missing keys. On 2026-09-18 OpenRouter had only $1.66 of $10 left; the gateway showed $5 free credit (which still serves no Anthropic model, so falling back to it only helps non-Anthropic models).

Two call sites deliberately do NOT use the picker:
- `src/lib/soundprint/providers.ts` already had its own OpenRouter/gateway choice.
- `src/app/api/cookbook/generate-recipe-image/route.ts` posts to
  `/v1/images/generations`, which OpenRouter does not mirror.

`AI_MODEL=anthropic/claude-opus-5`. Note `anthropic/claude-sonnet-4-6` (the old
hardcoded default) is both older AND more expensive than `claude-sonnet-5`
($3/$15 vs $2/$10) — never reinstate it.

Related: [[dashboard-app]]

**2026-09-18 site-wide model picker:** AI panel "Website AI — every app" has a searchable Model
dropdown (`src/components/hub/ModelPicker.tsx`, `/api/ai/models` = OpenRouter catalogue via
`src/lib/ai/models.ts`) + 2 fallback models, saved as `model`/`fallbackModels` in the ai-settings doc.
`aiFetch` rewrites the model only for "general" calls (body.model = DEFAULT_MODEL, AI_MODEL or any
`anthropic/*`), tries pick → fallbacks (max 3), skips models that can't read the request's images/audio.
Specialists (gemini image, audio listener, perplexity, video) untouched. Default fallbacks are
non-Claude (gemini-3.8-flash, gpt-5.6-sol): the owner does NOT want apps to depend on Claude.

Gotchas fixed 2026-09-18: OpenRouter alias ids start with "~" (`~openai/gpt-sol-latest`, near the top
of the newest-first list) — the validator must accept them or the pick silently snaps back. Provider
health (lastError/lastOk) now lives in its own server doc `ai-health`, never in `ai-settings`, so
health writes from other instances can't overwrite the owner's picks. Inspect live state with the
service-role key: `server_docs` rows `ai-settings` / `ai-health`.
