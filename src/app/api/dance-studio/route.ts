// GET /api/dance-studio — the caller's whole studio: dances, characters,
// generations, plus which provider would render and whether it can.

import { NextResponse } from "next/server";

import { requireUid } from "@/lib/dance-studio/server/http";
import { loadLibrary } from "@/lib/dance-studio/server/library";
import { providerInfo } from "@/lib/dance-studio/server/providers";
import { gatewayBalanceNotice } from "@/lib/dance-studio/server/providers/gateway";
import { remoteStorage } from "@/lib/dance-studio/server/storage";
import type { StudioState } from "@/lib/dance-studio/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const uid = await requireUid();
  if (uid instanceof NextResponse) return uid;

  const remote = remoteStorage();
  const provider = providerInfo();
  if (provider.id === "gateway") provider.notice = await gatewayBalanceNotice();
  const state: StudioState = {
    library: await loadLibrary(uid),
    provider,
    storage: {
      remote,
      note: remote
        ? "Media is kept in private Supabase Storage."
        : "Media is on this machine's disk, which the video model can't download from. Set SUPABASE_SERVICE_ROLE_KEY to generate.",
    },
  };
  return NextResponse.json(state);
}
