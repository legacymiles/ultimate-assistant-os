// ---------------------------------------------------------------------------
// Jarvis password capture — page side.
//
// Two jobs: notice a login being submitted, and fill a login on request.
//
// The rule at the top of this file is the important one. This script must never
// run on a local address, because the hub's own vault screen is served from
// localhost and its password field is the master password. Capturing that would
// put the key to everything inside the thing it protects.
// ---------------------------------------------------------------------------

(() => {
  const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|::1|0\.0\.0\.0)$/i;
  if (LOCAL.test(location.hostname) || /\.local$/i.test(location.hostname)) return;

  /** Only fields a person could actually type into. */
  const visible = (el) => {
    if (!el || el.disabled || el.readOnly) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  };

  const passwordFields = (root) =>
    [...root.querySelectorAll('input[type="password"]')].filter(visible);

  /** The username box that belongs to a password box. */
  function usernameFor(pw) {
    const form = pw.form || pw.closest("form") || document;
    const inputs = [...form.querySelectorAll("input")].filter(visible);

    const explicit = inputs.find(
      (i) => i !== pw && /username|email/i.test(i.getAttribute("autocomplete") || ""),
    );
    if (explicit) return explicit;

    const typed = inputs.find((i) => i !== pw && /^(text|email|tel)$/i.test(i.type) && i.value.trim());
    if (typed) return typed;

    // Fall back to the nearest text input that comes before the password box,
    // which is how almost every login form is laid out.
    const before = inputs.filter((i) => i !== pw && i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING);
    return before.filter((i) => /^(text|email|tel)$/i.test(i.type)).pop() || null;
  }

  // Avoid capturing the same thing repeatedly when a page re-fires submit.
  let lastSignature = "";
  let lastAt = 0;

  function captureFrom(pw) {
    if (!pw || !visible(pw)) return;
    const password = pw.value;
    if (!password) return;

    const user = usernameFor(pw);
    const username = user ? user.value.trim() : "";
    const signature = `${location.host}|${username}|${password.length}|${password.slice(0, 2)}`;
    // A double submit is one login, not two.
    if (signature === lastSignature && Date.now() - lastAt < 4000) return;
    lastSignature = signature;
    lastAt = Date.now();

    const form = pw.form || pw.closest("form");
    chrome.runtime.sendMessage({
      type: "capture",
      payload: {
        url: form?.action && form.action !== location.href ? form.action : location.href,
        username,
        password,
        formAction: form?.action || "",
      },
    });
  }

  // 1. A real form submit. Capture phase, so a page that stops propagation
  //    cannot stop us seeing it.
  document.addEventListener(
    "submit",
    (e) => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;
      const pw = passwordFields(form).pop();
      if (pw) captureFrom(pw);
    },
    true,
  );

  // 2. Sites that never submit a form — they run fetch on a button click.
  document.addEventListener(
    "click",
    (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const button = t.closest('button, input[type="submit"], [role="button"], a');
      if (!button) return;
      const scope = button.form || button.closest("form") || document;
      const pw = passwordFields(scope).pop();
      if (pw && pw.value) {
        // Give the page a tick to finish its own handler, then read again.
        setTimeout(() => captureFrom(pw), 0);
      }
    },
    true,
  );

  // 3. Enter in a password field submits on most sites without a click event.
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Enter") return;
      const t = e.target;
      if (!(t instanceof HTMLInputElement) || t.type !== "password") return;
      setTimeout(() => captureFrom(t), 0);
    },
    true,
  );

  // --- filling -------------------------------------------------------------

  /**
   * Set a value the way a framework will notice.
   *
   * React (and Vue) track the property descriptor on the prototype, so a plain
   * `el.value = x` updates the DOM and leaves the framework's state empty — the
   * field looks filled and submits blank. The native setter plus explicit
   * events is the only version that works on both kinds of page.
   */
  function setValue(el, value) {
    if (!el) return false;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    el.focus();
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type === "fill") {
      const pw = passwordFields(document).pop();
      if (!pw) return reply({ ok: false, error: "no password field on this page" });
      const user = usernameFor(pw);
      const filledUser = user && msg.username ? setValue(user, msg.username) : false;
      const filledPass = setValue(pw, msg.password);
      return reply({ ok: Boolean(filledPass), filledUser });
    }
    if (msg?.type === "ping") return reply({ ok: true, hasLogin: passwordFields(document).length > 0 });
    return undefined;
  });
})();
