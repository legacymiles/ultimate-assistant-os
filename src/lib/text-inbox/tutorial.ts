// ---------------------------------------------------------------------------
// Screenshots for the Text Inbox setup tutorial, by step.
//
// The owner sends real iPhone screenshots of each step; they live in
// public/text-inbox/tutorial/ and are listed here so every user sees them
// under the matching step in Text Inbox › Set up. A step with no pictures
// just shows its words.
//
// Step ids: in-1 … in-5 (the "Text to Jarvis" automation), out-1 … out-6
// (the "Jarvis Send" Shortcut), push-1 … push-3 (notifications).
// ---------------------------------------------------------------------------

export interface TutorialShot {
  src: string;
  alt: string;
}

export const TUTORIAL_IMAGES: Record<string, TutorialShot[]> = {};

export function shotsFor(step: string): TutorialShot[] {
  return TUTORIAL_IMAGES[step] ?? [];
}
