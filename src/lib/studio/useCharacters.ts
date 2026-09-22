"use client";

// ---------------------------------------------------------------------------
// The cast the composer can @-mention.
//
// One read of the photo library, turned into the shape the @ menu and the render
// both want. It lives here rather than in the Photos domain because it is a
// Studio concern: Photos decides who the library knows, Studio decides what an
// @ is worth.
//
// Avatars come from IndexedDB, so this is async and the list arrives a frame
// late. The menu is keyed on the token, never the array index, so a late avatar
// never moves the row under the owner's cursor.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { evidenceCount, allSubjects, subjectAvatar, type Subject } from "@/lib/recall/photos/characters";
import { getPhotos } from "@/lib/recall/photos/store";
import { characterToken, uniqueTokens, type CharacterMention } from "./characters";
import { ROLE_LABELS } from "@/lib/recall/photos/types";

/** A character plus what it takes to actually render them. */
export interface Character extends CharacterMention {
  /** The reference faces, for the render. Never sent to the chat model. */
  images: string[];
}

function toCharacter(s: Subject, token: string): Character {
  const { refs, filed } = evidenceCount(s);
  const sheet = (s.kind === "person" ? s.person.sheet : s.category.sheet) ?? null;
  return {
    token,
    name: s.kind === "person" ? s.person.name : s.category.name,
    kind: s.kind,
    role: s.kind === "person" ? ROLE_LABELS[s.person.role] : "",
    appearance: sheet?.appearance,
    identifiers: sheet?.identifiers,
    wardrobe: sheet?.wardrobe,
    notes: s.kind === "person" ? s.person.notes : s.category.refHint,
    pictures: refs + filed,
    images: s.kind === "person" ? s.person.refs : s.category.refs ?? [],
  };
}

/**
 * Everyone the library knows, newest information first read.
 *
 * People with no picture at all are left out: "@" is a promise that the face
 * will be attached, and an empty promise is worse than an absent name.
 */
export function useCharacters(): { characters: Character[]; reload: () => void } {
  const [characters, setCharacters] = useState<Character[]>([]);

  const reload = useCallback(() => {
    const subjects = allSubjects(getPhotos()).filter((s) => {
      const { refs, filed } = evidenceCount(s);
      return refs + filed > 0;
    });
    const tokens = uniqueTokens(
      subjects.map((s) => (s.kind === "person" ? s.person.name : s.category.name)),
    );
    const base = subjects.map((s, i) => toCharacter(s, tokens[i] ?? characterToken("character")));
    setCharacters(base);
    // Then the faces, once, in the background. A missing avatar costs the menu
    // a monogram, never a row.
    void Promise.all(subjects.map((s) => subjectAvatar(s).catch(() => undefined))).then((avatars) => {
      setCharacters(base.map((c, i) => (avatars[i] ? { ...c, avatar: avatars[i] } : c)));
    });
  }, []);

  useEffect(() => {
    reload();
    // The owner adds a face in the Photos tab and comes back to chat; the list
    // is stale until something tells it, and a tab change is that something.
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);
    window.addEventListener("recall-photos-changed", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("recall-photos-changed", onFocus);
    };
  }, [reload]);

  return { characters, reload };
}
