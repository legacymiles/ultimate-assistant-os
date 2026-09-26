// The service worker exists so the extension has somewhere to open its options
// page from the popup, and so a future version has a home. It deliberately
// does nothing on its own: no alarms, no tab listeners, no navigation hooks.
// An extension that watched browsing in the background would be a different
// and much larger thing to trust.

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});
