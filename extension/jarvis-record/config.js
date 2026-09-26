// Where this copy of the extension was born.
//
// Downloading the extension from Jarvis › Record writes this file for you: the
// hub's address and a fresh token, already paired. background.js copies them
// into storage the moment Chrome installs the folder, so the options page never
// has to be opened and a token never has to be pasted anywhere.
//
// Loaded by the service worker with importScripts and by the popup as a plain
// script, which is why it hangs off `self` rather than exporting anything.
self.JARVIS_RECORD_CONFIG = {
  hubUrl: "",
  token: "",
};
