"use client";

// ---------------------------------------------------------------------------
// Music Creator — the Voice Library.
//
// The point of the library is that a voice is prepared once. Finding a clip,
// cutting the good seconds out of it and getting it onto the GPU box is the
// slow part of the whole workflow, so the result is kept here and every later
// song reuses it.
//
// What a "voice" actually is gets said plainly on each card, because AuK is
// zero-shot: there is no trained model per voice anywhere, only the reference
// clip and what we know about it. That is also why "Preview" plays the
// reference clip when no test render exists — it is the honest answer to "what
// is this voice?", and it costs no GPU time.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Icon } from "../icons";
import { deleteServerVoice } from "@/lib/music-creator/client";
import type { VoiceProfile } from "@/lib/music-creator/types";
import { useStudio } from "./studio";

export function VoiceLibrary() {
  const { voices, deleteVoice, renameVoice, openTool, fileUrl } = useStudio();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  if (!voices.length) {
    return (
      <div className="mc-empty">
        <p>The Voice Library is empty.</p>
        <button type="button" className="mc-btn mc-btn-go" onClick={() => openTool("artist-voice")}>
          <Icon.Mic width={13} height={13} /> Clone a voice
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mc-panel-h">
        <h3>Voice Library</h3>
        <span className="mc-tag2">{voices.length} saved</span>
        <button type="button" className="mc-btn mc-btn-s mc-spacer" onClick={() => openTool("artist-voice")}>
          <Icon.Plus width={12} height={12} /> New voice
        </button>
      </div>

      <ul className="mc-list">
        {voices.map((v) => (
          <li key={v.id} className="mc-item">
            <div className="mc-item-m">
              {renaming === v.id ? (
                <input
                  className="mc-input"
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={() => {
                    if (draftName.trim()) renameVoice(v.id, draftName.trim());
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                />
              ) : (
                <strong>{v.name}</strong>
              )}
              <span>{describe(v)}</span>
              {v.clipDataUrl ? (
                <audio controls preload="none" src={v.previewFileId ? fileUrl(v.previewFileId) : v.clipDataUrl} />
              ) : (
                <span className="mc-note is-warn">
                  The reference clip is on the device that made this voice, not here. It can still be used while the
                  GPU server holds its copy.
                </span>
              )}
            </div>

            <div className="mc-item-a">
              <button type="button" className="mc-btn mc-btn-s mc-btn-go" onClick={() => openTool("artist-voice", { voiceId: v.id, title: `${v.name} session` })}>
                Use voice
              </button>
              <button
                type="button"
                className="mc-btn mc-btn-s"
                onClick={() => {
                  setRenaming(v.id);
                  setDraftName(v.name);
                }}
              >
                <Icon.Edit width={12} height={12} /> Rename
              </button>
              {confirming === v.id ? (
                <>
                  <button
                    type="button"
                    className="mc-btn mc-btn-s mc-btn-bad"
                    onClick={() => {
                      // The server copy is a cache; failing to reach it must not
                      // block removing the voice from the library.
                      if (v.serverRefId) void deleteServerVoice(v.serverRefId).catch(() => {});
                      deleteVoice(v.id);
                      setConfirming(null);
                    }}
                  >
                    Delete for good
                  </button>
                  <button type="button" className="mc-btn mc-btn-s" onClick={() => setConfirming(null)}>
                    Keep
                  </button>
                </>
              ) : (
                <button type="button" className="mc-btn mc-btn-s" onClick={() => setConfirming(v.id)}>
                  <Icon.Trash width={12} height={12} />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <p className="mc-note">
        A saved voice is a reference clip plus its notes — AuK clones from that clip at generation time rather than
        training a model per voice, which is exactly why reusing a saved voice costs nothing but the upload. The clip
        stays on the device that made it; the rest of the record syncs.
      </p>
    </div>
  );
}

function describe(v: VoiceProfile): string {
  const bits = [new Date(v.created).toLocaleDateString()];
  if (v.artist) bits.push(v.artist);
  if (v.durationS) bits.push(`${v.durationS.toFixed(1)}s reference`);
  bits.push(v.serverRefId ? "on the server" : "not yet uploaded");
  if (v.sourceNote) bits.push(v.sourceNote);
  return bits.join(" · ");
}
