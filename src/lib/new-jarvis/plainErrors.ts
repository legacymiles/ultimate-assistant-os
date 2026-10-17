// ---------------------------------------------------------------------------
// What went wrong, in words a person can act on.
//
// Providers answer failures in their own dialect — "No endpoints found for
// deepseek/x", "User not found.", a 402 with a JSON body — and passing that
// through makes the owner (or any user) debug an API. Every failure Jarvis
// shows goes through here first: what happened, and the one thing to do.
// The raw text still goes to the server log for whoever fixes the code.
// ---------------------------------------------------------------------------

export function plainCloudError(status: number, raw: string): string {
  const t = `${status} ${raw}`.toLowerCase();

  if (status === 401 || status === 403 || /no auth credentials|user not found|invalid api key|unauthori[sz]ed|api key/.test(t)) {
    return "Your OpenRouter key isn't working — it's missing, mistyped or was revoked. Add a fresh one in Setup › Keys, or switch the brain to Claude (your subscription).";
  }
  if (status === 402 || /insufficient|credit|balance|payment required/.test(t)) {
    return "Your OpenRouter account is out of credit. Top it up at openrouter.ai/settings/credits, or switch the brain to Claude (your subscription) or a free model.";
  }
  if (status === 404 || /no endpoints found|not a valid model|model .*not (found|exist)|unknown model/.test(t)) {
    return "That model isn't available on OpenRouter right now — it may have been renamed or retired. Pick another one in the model picker.";
  }
  if (/tool[s]? (use |calling )?(is )?not supported|does not support tools|tool_choice/.test(t)) {
    return "That model can't use tools, so it can't drive the browser or save things. Pick another model — Claude or DeepSeek both can.";
  }
  if (/image|vision|audio|input_audio|video|modalit/.test(t) && (status === 400 || status === 422)) {
    return "That model can't read what you attached. Pick a model with 🖼 / 🎧 / 🎬 next to it in the picker, or send it without the attachment.";
  }
  if (status === 413 || /too large|payload|context length|maximum context|too many tokens/.test(t)) {
    return "That was too much to send in one go. Try fewer or smaller attachments, or a shorter message.";
  }
  if (status === 429 || /rate.?limit|too many requests/.test(t)) {
    return "That model is getting too many requests right now. Wait a moment and try again, or pick another model.";
  }
  if (status === 408 || status === 504 || /timed? ?out|timeout/.test(t)) {
    return "The model took too long to answer. Try again — or for a long job, pick a faster model.";
  }
  if (status >= 500 || /overloaded|unavailable|provider returned error|upstream/.test(t)) {
    return "The model's provider is having trouble right now. Try again in a minute, or pick another model.";
  }
  const first = raw.split(/(?<=[.!?])\s/)[0]?.trim() ?? "";
  return first ? `The AI couldn't answer: ${first.slice(0, 180)}` : "The AI couldn't answer, and didn't say why. Try again.";
}

/** When the website itself answered with something that isn't JSON (a timeout page, a crash). */
export function plainSiteError(status: number): string {
  if (status === 504 || status === 408) return "Jarvis's server took too long on that step and gave up. Try again — it usually goes through.";
  if (status === 413) return "That was too much to send in one go. Try fewer or smaller attachments.";
  if (status === 401 || status === 403) return "Your sign-in to Jarvis expired. Refresh the page and sign in again.";
  if (status >= 500) return "Jarvis's server hit a problem on that step. Try again in a moment.";
  return `Jarvis's server answered in a way it shouldn't have (${status}). Try again.`;
}

/** The PC's local agent could not be used for a step, in plain words. */
export function plainBridgeError(status: number, message: string): string {
  if (status === 0) {
    return "Jarvis can't reach the local agent on your PC — it isn't running, or this isn't that PC. Start it with tools\\jarvis-bridge\\start.cmd, or switch the brain to a cloud model.";
  }
  if (status === 401) return "This browser isn't paired with your PC's local agent. Pair it from the status bar at the bottom of Jarvis.";
  if (status === 404 || /no route/i.test(message)) {
    return "Your PC's local agent is an older version that can't do this yet. Update it — run tools\\jarvis-bridge\\install.cmd again on the PC — then try once more.";
  }
  return message;
}
