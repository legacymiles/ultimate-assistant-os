# Jarvis Password Capture

Saves the logins you type into any site straight into your own Jarvis vault, and
fills them back. No cloud, no third party â€” it talks only to a local agent on
`127.0.0.1`.

## What it does

- **Captures** a login the moment you submit it (form submit, button click, or
  Enter in the password box â€” including sites that never use a real form).
- **Fills** a saved login on request from the popup.
- **Queues** captures when the agent is locked, then saves them on unlock.

## What it never does

- Never runs on `localhost` / `127.0.0.1` â€” the hub's vault screen is served
  there, and its password field is your master password. Capturing that would
  put the key to everything inside the thing it protects.
- Never sends anything off the machine.
- Never stores a password in the page, or in `chrome.storage` beyond the short
  queue described above.

---

## Install (one time, ~1 minute)

Chrome 137+ removed the `--load-extension` command-line switch, so this has to be
loaded by hand once:

1. Start the agent first (see below) so the extension has something to talk to.
2. In Chrome, open `chrome://extensions`
3. Turn on **Developer mode** (top right)
4. Click **Load unpacked**
5. Select the `extension/password-capture` folder (not `extension` itself)
6. Pin **Jarvis Password Capture** to the toolbar

> **Note:** the sibling `extension/jarvis-record` folder is a different, older extension (screen recording, hub-paired). Do not load it as this one.
>
> Repeat in each Chrome profile you actually log in with â€” each profile has its own
extension list.

## Run the agent

From the project root, in its own terminal window:

```
npm run passwords:agent
```

Leave it running. It prints the port and the token file path.

- The master password is typed **in the extension popup** and held in the agent's
  memory only â€” never written to disk.
- It locks itself after 30 minutes idle, and drops the key when you stop it.
- Closing the agent means capture falls back to a local queue and fill stops
  working until it is started again.

## Use

**Saving** is automatic. Unlock once, then log in anywhere as usual.

**Filling:** click the toolbar icon â†’ the saved login for the current site
appears â†’ **Fill**.

## The security model, briefly

| Concern | Answer |
|---|---|
| Can a website reach the agent? | No. It binds to 127.0.0.1 and answers CORS only for `chrome-extension://` origins, so a page's fetch is blocked by the browser. |
| Can another local program? | Only with the token, or by pretending to be the extension. Both are local-process attacks; anything running as you can also read the vault's ciphertext. |
| Where is the master password? | Typed into the popup, sent to the local agent over loopback, held in memory, never persisted. |
| Where is a captured password? | Sealed with the vault's data key before it is written. The map (Recall) keeps only site and username. |
| What if the agent is locked when a login is submitted? | It goes to a local queue and is sealed on next unlock. The queue is the one place a password sits in plaintext, briefly, by design â€” losing captures silently would be worse. |

## Limits

- **Chrome, Edge, Brave, Arc** â€” anything Chromium 121+ with extension support.
  Firefox would need a separate manifest and is not built.
- **No multi-step logins** (password-then-OTP pages) beyond the first step.
- **TOTP is not generated.** The 2FA type is recorded on the login, not the seed.
- **One machine.** The vault syncs; the agent does not.

