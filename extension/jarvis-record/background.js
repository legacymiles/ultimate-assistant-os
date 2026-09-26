// The service worker does two things, both at install time, and then nothing.
//
// It deliberately has no alarms, no tab listeners and no navigation hooks. An
// extension that watched browsing in the background would be a different and
// much larger thing to trust.

importScripts("config.js");

/**
 * A copy downloaded from Jarvis › Record already knows this hub and carries a
 * token minted for it, so there is nothing to type in and the options page is
 * not worth opening. A copy loaded straight out of the repo knows neither, and
 * the options page is the only way to tell it.
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason !== "install") return;

  const { hubUrl, token } = self.JARVIS_RECORD_CONFIG ?? {};
  if (hubUrl && token) {
    await chrome.storage.local.set({ hubUrl: hubUrl.replace(/\/+$/, ""), token });
    return;
  }
  chrome.runtime.openOptionsPage();
});
