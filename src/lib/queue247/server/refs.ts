// Reference pictures in Storage: save what the owner attached, and sign links
// so the conversation can show them again later. Bucket `queue-247` (private).

import { randomBytes } from "node:crypto";
import { signedBlobUrl } from "@/lib/server/blobStore";
import { putFile } from "../h3/blob";
import { H3_BUCKET } from "../h3/upload";
import { refKey, type CleanRef } from "../refs";
import type { TaskMessage } from "../types";

export interface SavedRef {
  key: string;
  name: string;
  dataUrl: string;
}

/** Store each picture; the ones Storage refused are left out (and said so by the caller). */
export async function saveRefs(uid: string, refs: CleanRef[]): Promise<{ saved: SavedRef[]; failed: number }> {
  const saved: SavedRef[] = [];
  let failed = 0;
  for (const r of refs) {
    const key = refKey(uid, randomBytes(9).toString("hex"), r.ext);
    const ok = await putFile(key, Buffer.from(r.base64, "base64"), r.type).catch(() => false);
    if (ok) saved.push({ key, name: r.name, dataUrl: r.dataUrl });
    else failed += 1;
  }
  return { saved, failed };
}

/** Add a one-hour link to every attachment. Without Supabase Storage there is no link and the UI says so. */
export async function signAttachments(messages: TaskMessage[]): Promise<TaskMessage[]> {
  return Promise.all(
    messages.map(async (m) => {
      if (!m.attachments?.length) return m;
      const attachments = await Promise.all(
        m.attachments.map(async (a) => ({ ...a, url: (await signedBlobUrl(H3_BUCKET, a.key, 3600)) ?? undefined })),
      );
      return { ...m, attachments };
    }),
  );
}
