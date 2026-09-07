// ---------------------------------------------------------------------------
// Copying a password should not leave it sitting in the clipboard all day.
// ---------------------------------------------------------------------------

/** Copy to clipboard, then wipe it so a password does not linger there. */
export async function copyEphemeral(text: string, ms = 30_000): Promise<void> {
  await navigator.clipboard.writeText(text);
  window.setTimeout(() => {
    // Only clear if the clipboard still holds what we put there.
    navigator.clipboard
      .readText()
      .then((cur) => {
        if (cur === text) void navigator.clipboard.writeText("");
      })
      .catch(() => {
        /* clipboard-read not permitted — leave it rather than clobbering */
      });
  }, ms);
}
