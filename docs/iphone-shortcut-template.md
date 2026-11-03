# The shared "Send to Jarvis" Shortcut

Camera Autopilot needs a Shortcut on the user's iPhone. Building it by hand is
eight blocks in Apple's Shortcuts app, and every block is somewhere to get it
wrong — a typed word where a blue variable chip belongs, the sending link
pasted into the clean-up action, a File field left as Text. All three have
actually happened.

So the owner builds it once, shares it, and everybody else taps a link. iOS
asks the installer one question while it installs — their key — and the
Shortcut's three URL actions read it from the one box they pasted into.

Setup then costs the user two taps and one paste.

## Why the first shared link was unsafe

A shared Shortcut is a file anyone with the link can download, and whatever is
typed into its actions travels with it. The first `Send To Jarvis 1` link
carried a live push key in both of its URL actions and a token in a header, so
anyone with the link could push photos into the owner's Jarvis and call the
clean-up endpoint. Nothing about the URL showed that.

That is the whole reason this recipe exists: the key must not be *in* the
Shortcut. It has to be a question the Shortcut asks.

## Making the shareable copy

Work on a duplicate. The original keeps running on the owner's phone while
this one is taken apart.

1. **Shortcuts** → long-press **Send to Jarvis** → **Duplicate**. Rename the
   copy **Send to Jarvis (shared)**.
2. Open the copy. At the very **top**, above everything: **Add Action** →
   search `Text` → tap **Text**. Drag it above the first block. **Leave its box
   empty.**
3. Each of the three **URL** actions: tap the URL text, delete everything after
   `?key=`, keep the `?key=`, then — cursor at the end — tap the **Text**
   variable on the bar above the keyboard. Do all three:
   - the one at the top, ending `/inbox/cursor?key=`
   - the one inside the Repeat, ending `/inbox/push?key=`
   - the one at the bottom, ending `/inbox/present?key=`

   Each URL must now **end in a blue chip**. One that still ends in `=` has no
   key attached, and every install will send an empty one. This is the step
   that silently failed the first time it was tried: deleting the old key
   looks like the whole job, and the Shortcut runs perfectly happily without
   the chip.
4. In the **Get Contents of URL** that sends the photos, swipe left on the
   `X-Dashboard-Token` header row and **delete it**. The `?key=` in the URL is
   the only credential the site needs, and a header is a second copy that
   cannot be answered by an import question — so it ships to everyone.
5. Tap the **ⓘ** (or the name at the top → **Details**). Find **Import
   Questions** → **Add Import Question** → choose the empty **Text** action →
   type the question: *Paste your Jarvis key*.
6. Test it: type the owner's own key into the Text box, run it, check photos
   arrive and Camera Autopilot's row reports back.
7. **Clear the Text box again.** This is the step that keeps the key out of the
   shared file. The import question does not remove a value that is already
   there — it only asks the installer to replace it.
8. **Share** → **Copy iCloud Link**.

A duplicate is not always a faithful copy of what was working: the first one
made this way came back with Combine Text emptied and the clean-up POST
pointing at the sending link. Run the check below before trusting it — that is
what it is for.

## The file at `public/downloads/send-to-jarvis.shortcut`

Until a signed link exists, the guide offers that file instead, and step 3 is
download-and-import rather than an eight-block build. It is the same Shortcut:
an empty Text box with the import question on it, and two URL actions —
`/inbox/push` and `/inbox/present` — each ending in the chip that carries the
pasted key. No bookmark link, so each run re-sends the newest photos rather
than picking up where it left off; the hand-build steps for adding one are
still in the guide's fold.

It costs the user one switch: Apple only signs a Shortcut shared from a phone,
so iPhone refuses a file until **Settings → Shortcuts → Advanced → Allow
Untrusted Shortcuts** is on. That is why a shared link is still the better
route, and why this is the fallback rather than the answer.

It was made by taking the owner's own shared Shortcut and applying the five
fixes the check below refused it over — nothing in it was authored from
scratch, so every action is one Shortcuts itself produced. To replace it,
import it on a phone, change what you need, share it, and either paste that
link into `SHARED_SHORTCUT` or download the file back out of the share.

## Before publishing the link

```
node scripts/check-shortcut-link.mjs https://www.icloud.com/shortcuts/<id>
```

It takes a path as well as a link, so a Shortcut can be checked before anyone
has shared it:

```
node scripts/check-shortcut-link.mjs public/downloads/send-to-jarvis.shortcut
```

It downloads the Shortcut Apple is actually serving, parses the property list,
and reads the thing the way Shortcuts does — which action feeds which, and what
is typed where. It prints the action list, then refuses the link if a key,
token, secret or password is sitting inside it, if the import question is
missing, if a URL stops at `?key=` without the chip, if Combine Text is empty,
or if the clean-up posts its names to the sending link.

Exit 0 means it is safe to hand out.

## Publishing it

Paste the link into `SHARED_SHORTCUT` in
[`src/lib/dashboard/iphoneShortcut.ts`](../src/lib/dashboard/iphoneShortcut.ts)
and push. That is the whole deploy — no env var, no Vercel dashboard, no
redeploy dance, because the link holds no secret.

`NEXT_PUBLIC_IPHONE_SHORTCUT_URL` still wins when it is set, which is how a
replacement Shortcut gets tried before it is committed.

Empty is a supported state: the guide then teaches the hand-build, which is
what every user got before this existed.

## Replacing or revoking a link

Sharing cannot be edited — a shared Shortcut is a snapshot. Changing the
Shortcut means sharing it again and replacing the link here.

To revoke one: **Shortcuts** → the shortcut → **⌄** → **Share** → **Stop
Sharing**. Anyone who already installed it keeps their copy; the link stops
working for everybody else.
