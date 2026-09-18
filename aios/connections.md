# Connections

What this AI OS / hub can actually reach today (from `.env.local` key names and wired MCP servers).
Personal-life domains (email, calendar, tasks) are tracked per person in the New Dashboard app.

| System | Used for | Mechanism | Where it's configured |
|---|---|---|---|
| OpenRouter | All AI calls (Claude Opus 5, Gemini for audio/video) | key | `OPENROUTER_API_KEY` → `src/lib/ai/provider.ts` |
| Vercel AI Gateway | Fallback AI + Seedance/H3 video | key | `AI_GATEWAY_API_KEY` |
| Supabase | Auth, `app_state` sync, storage buckets | key | `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY` |
| Vercel | Hosting of the hub | CLI (not installed) | `.vercel/` |
| GitHub | Repo | git | `origin` |
| fish.audio | Voice Studio TTS + cloning | key | `FISH_API_KEY` |
| RunPod | Music Creator GPU | key | `RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID` |
| God's Eye data feeds | Windy, NASA FIRMS, AISStream, TomTom | key | `WINDY_*`, `NASA_FIRMS_MAP_KEY`, `AISSTREAM_API_KEY`, `TOMTOM_API_KEY` |
| Blender | 3D Studio renders | MCP (`blender`) | user-scope MCP |
| Unreal Engine 5.8 | Game Creator | MCP (`unreal`) | `tools/unreal-bridge` |
| YouTube / video | Watching videos | MCP (`video-analyzer`) + `video-analyzer` skill | user-scope MCP |
| Google Drive | Dashboard backup / import | OAuth in-app | `src/lib/dashboard/driveBackup` |
| iPhone Photos | Dashboard photo inbox | Shortcut push | `/api/dashboard` |
