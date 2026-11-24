"use client";

// Combine ingredients from one or several saved prompts: their chips are
// merged into the build (duplicates skipped), in the order the prompts were
// picked.

import { useState } from "react";
import { Check, X } from "lucide-react";
import { mergeChips } from "@/lib/image-studio/inspire/assemble";
import { extractChips } from "@/lib/image-studio/inspire/extract";
import type { Chip, LibraryPrompt } from "@/lib/image-studio/inspire/types";
import { useInspire } from "../store";
import { chipStyle, Modal } from "../ui";
import { cleanChip } from "./shared";

function chipsOf(p: LibraryPrompt): Chip[] {
  return p.chips.length ? p.chips : extractChips(p.text);
}

export function ImportPrompts({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me, lib, builder, setBuilder, go, requireSignIn, toast } = useInspire();
  const [picked, setPicked] = useState<string[]>([]);
  const prompts = lib.items.filter((i): i is LibraryPrompt => i.kind === "prompt");

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const incoming = mergeChips(
    [],
    picked.flatMap((id) => {
      const p = prompts.find((x) => x.id === id);
      return p ? chipsOf(p).map(cleanChip) : [];
    }),
  );
  const fresh = mergeChips(builder.chips, incoming).length - builder.chips.length;

  const close = () => {
    setPicked([]);
    onClose();
  };
  const apply = () => {
    setBuilder((b) => ({ ...b, chips: mergeChips(b.chips, incoming) }));
    toast(fresh ? `Added ${fresh} ingredient${fresh === 1 ? "" : "s"} from ${picked.length} prompt${picked.length === 1 ? "" : "s"}` : "Those ingredients are already in your build");
    close();
  };

  return (
    <Modal open={open} onClose={close} label="Import from saved prompts">
      <div style={{ padding: 20, display: "grid", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
          <div>
            <div className="insp-h2">Import from saved prompts</div>
            <div className="insp-faint" style={{ fontSize: 12.5 }}>
              Pick one or several — their ingredients are combined into this build.
            </div>
          </div>
          <button type="button" className="insp-btn insp-btn-sm insp-btn-quiet insp-btn-icon" aria-label="Close" onClick={close}>
            <X size={15} />
          </button>
        </div>

        {!me?.signedIn ? (
          <div className="insp-note" style={{ display: "grid", gap: 8 }}>
            Sign in to see the prompts you&apos;ve saved.
            <button type="button" className="insp-btn insp-btn-sm" style={{ justifySelf: "start" }} onClick={() => requireSignIn("use your saved prompts", () => undefined)}>
              Sign in
            </button>
          </div>
        ) : prompts.length === 0 ? (
          <div className="insp-note" style={{ display: "grid", gap: 8 }}>
            Your library has no saved prompts yet. Open any image in Explore and save its prompt — it shows up here, ready to mix.
            <button
              type="button"
              className="insp-btn insp-btn-sm"
              style={{ justifySelf: "start" }}
              onClick={() => {
                close();
                go("explore");
              }}
            >
              Open Explore
            </button>
          </div>
        ) : (
          <ul className="b-import" role="listbox" aria-multiselectable="true" aria-label="Saved prompts">
            {prompts.map((p) => {
              const on = picked.includes(p.id);
              const chips = chipsOf(p);
              return (
                <li key={p.id}>
                  <button type="button" role="option" aria-selected={on} className="b-import-item" onClick={() => toggle(p.id)}>
                    <span className="b-check" data-on={on} aria-hidden>
                      {on && <Check size={11} strokeWidth={3} />}
                    </span>
                    <span style={{ minWidth: 0, display: "grid", gap: 6 }}>
                      <span className="insp-h3" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.title || p.text.slice(0, 60)}
                      </span>
                      <span className="insp-faint" style={{ fontSize: 12, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {p.text}
                      </span>
                      <span className="insp-chips" style={{ gap: 4 }}>
                        {chips.slice(0, 6).map((c) => (
                          <span key={c.text} className="insp-chip insp-chip-sm b-static-chip" style={chipStyle(c)}>
                            {c.text}
                          </span>
                        ))}
                        {chips.length > 6 && <span className="insp-count" style={{ alignSelf: "center" }}>+{chips.length - 6}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {prompts.length > 0 && me?.signedIn && (
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10 }}>
            <span className="insp-faint" style={{ fontSize: 12.5 }}>
              {picked.length ? `${fresh} new ingredient${fresh === 1 ? "" : "s"} from ${picked.length} prompt${picked.length === 1 ? "" : "s"}` : "Nothing picked yet"}
            </span>
            <button type="button" className="insp-btn" disabled={!picked.length} onClick={apply}>
              Add ingredients
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
