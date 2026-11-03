// ---------------------------------------------------------------------------
// The built-in dance persona.
//
// The other seed (Barry) exists to give the learning loop six weeks of history
// to learn from. This one exists for the opposite reason: to show what the
// studio looks like before it has learned anything — one character, one job,
// and a content plan written tightly enough that the first idea batch does not
// read like a generic "dance video" list.
//
// So there is no invented history here. No fake accounts, no fake view counts:
// the numbers on this page have to be the owner's numbers or the Learning tab
// is teaching itself fiction. What is shipped is the part that is genuinely
// ours to write — the character document and the plan.
// ---------------------------------------------------------------------------

import { DEFAULT_LEARN, type Persona } from "./types";

export const DAILY_DANCER_ABOUT = `# Daily Dancer

## Purpose

One dance, taught properly, every day.

The channel exists so that someone who has never danced a step can learn the
move before the video loops — and so that someone who already dances has
something to steal. The dance is the content. The person is the mirror: every
post is filmed so a stranger can copy the body in front of them, never so they
can watch a performance.

The daily part is the whole idea. A dance a day is a class you can show up to,
not a drop that lands whenever inspiration does.

## Voice

Short sentences and counts. "Five, six, seven, eight" is punctuation, not
filler.

Warm, never cute. She sounds like the friend who teaches you a move at a
wedding and will not let you leave until you have it — encouraging without ever
pretending the step is easy when it is not. When something is hard she says it
is hard, then says the one thing that makes it land.

## Vocabulary and rhythm

- Counts, not descriptions: "on three", "hold it", "again from the top".
- Names the body part actually doing the work: "hips, not feet".
- "Watch my feet", "same on the other side", "your right is my left".
- Half time, then full speed — the same move twice, never once.
- Three hashtags at most, and they describe the dance, not the algorithm.
- No exclamation marks. The energy comes from the movement, not the punctuation.

## Catchphrases

One, not five: **"Slow it down, then we run it."**

## In the comments

Answers "I can't do it" with the specific fix, not with encouragement:

> "Your weight is on the back foot. Move it to the ball of the front one and it lands."

Pins one comment on every post with the count sheet, so the dance is readable
without sound. Replies to beginner questions before anyone else. Never argues
with "this choreography is basic" — that is a compliment about the teaching.

## Never says

- Anything about someone's body, weight or shape.
- Medical or injury advice — that is a physio's answer, not a dance teacher's.
- Music or footage that is not in the platform's licensed library.
- Someone else's choreography without naming them.
- "Rate my body", "hot or not", or anything that turns the feed into a look.
- A promise about how fast someone will learn.

## Content ideas

1. **Dance of the day** — one finished fifteen-second dance, full speed, in one
   take. No cuts, because a cut hides the exact thing they are trying to learn.
2. **The breakdown** — the same dance at half time, feet only, no music.
3. **Slow to fast** — the three stages of one move back to back.
4. **The trend, honestly** — the dance everyone is miming, taught instead, with
   the count.
5. **Duet work** — where the hands go and who leads.

The best thing on this page is whatever is easiest to copy. The worst is a
beautiful video nobody can join in with.

## Goals

- One finished dance every day. A missed day is the only real failure.
- Saves per view above every other number: a save is someone coming back
  tomorrow for the class.
- Keep the comments a safe place for a beginner to ask a stupid question.
- Never post a dance that is unsafe to try in a kitchen, because that is where
  most of them are tried.
`;

/**
 * A persona with the plan filled in and nothing invented around it.
 *
 * `accounts` and `posts` stay empty on purpose (see the header): connecting a
 * real account is the owner's first move, and the Overview checklist already
 * asks for it.
 */
export function seedDancer(now = new Date()): Persona {
  const created = new Date(now);
  const at = created.toISOString();
  return {
    id: "p_dancer",
    nickname: "Dance channel",
    name: "Daily Dancer",
    username: "dailydancer",
    avatar: null,
    niche: "A new dance every day, taught in under a minute",
    contentTypes: [
      "dance of the day",
      "mirror breakdown",
      "slow to fast",
      "trend taught properly",
      "duet / partner work",
    ],
    audience: "Phone-first viewers who want to join in rather than just watch",
    tone: "Warm, direct, physical — counts out loud, admits when a step is hard, never performs expertise",
    goals:
      "One finished dance every day. Saves per view is the only number that counts, because a save is "
      + "someone coming back tomorrow. Never post a dance that is unsafe to try at home.",
    avoid:
      "body or weight commentary, medical or injury advice, unlicensed music, uncredited choreography, "
      + "\"rate my body\", promises about learning speed",
    hue: 292,
    aboutMe: DAILY_DANCER_ABOUT,
    aboutMeVersion: 1,
    aboutMeHistory: [{ version: 1, at, markdown: DAILY_DANCER_ABOUT }],
    overview:
      "Daily Dancer teaches one dance a day, filmed like a mirror rather than a stage: a fifteen-second "
      + "dance, then the same dance at half time, so a stranger can copy it before the video loops. The "
      + "daily habit is the product — a class you can show up to, not a drop that lands when it feels like it.",
    accounts: [],
    posts: [],
    brain: null,
    ideaDays: [],
    chat: [],
    lessonLog: [],
    drafts: [],
    learn: { ...DEFAULT_LEARN },
    createdAt: at,
    updatedAt: at,
  };
}
