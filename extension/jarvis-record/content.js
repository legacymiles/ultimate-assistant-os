// ---------------------------------------------------------------------------
// The part that runs inside the website.
//
// Injected on demand, only when the owner clicks the extension's button on a
// page. It is not a persistent content script and there is no match pattern
// that runs it everywhere: nothing on any page is read until it is asked for.
//
// Two jobs, and the second one is where the bodies are buried:
//
//   scan()  — describe every field on the page, and find the label a HUMAN
//             would read next to it. Labels are attached four different ways
//             in the wild and three of them are not `for=`.
//
//   fill()  — put values in. Setting `input.value` directly is the obvious way
//             and it is wrong on any React, Vue or Angular form: the framework
//             holds its own copy of the state, never sees the assignment, and
//             overwrites your value on the next render. Everything types
//             beautifully and then submits blank. The native setter plus an
//             `input` event is what makes the framework believe a person did
//             it. This is the single most important function in the extension.
// ---------------------------------------------------------------------------

(() => {
  const SKIP_TYPES = new Set([
    "password", "hidden", "submit", "button", "image", "reset", "file", "search",
  ]);

  /** A stable-enough handle for one field, for this page load only. */
  let counter = 0;
  const refs = new Map();

  function labelFor(el) {
    // 1. A real <label for="...">, or one wrapped around the field.
    if (el.id) {
      const byFor = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (byFor?.innerText?.trim()) return byFor.innerText.trim();
    }
    const wrapping = el.closest("label");
    if (wrapping?.innerText?.trim()) return wrapping.innerText.trim();

    // 2. aria-label / aria-labelledby, which is how most component libraries
    //    label a field that has no visible <label> element.
    const aria = el.getAttribute("aria-label");
    if (aria?.trim()) return aria.trim();
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.innerText?.trim() ?? "")
        .filter(Boolean)
        .join(" ");
      if (text) return text;
    }

    // 3. The nearest text that belongs to THIS field and no other. Crude, and
    //    the only thing that works on the table-based forms that state benefit
    //    portals are still built from.
    //
    //    Two guards, both learned by getting it wrong. A container holding more
    //    than one field cannot be labelling any one of them — without that
    //    check, an empty input at the end of a form is handed the entire form's
    //    text as its label. And on a table layout the label is not in the
    //    field's own cell, it is in the cell BEFORE it.
    const cell = el.closest("td, th");
    if (cell) {
      const prior = cell.previousElementSibling;
      if (prior && !prior.querySelector("input, select, textarea")) {
        const text = (prior.innerText ?? "").replace(/\s+/g, " ").trim();
        if (text && text.length < 160) return text;
      }
      // Some portals put the label above the field in the row above.
      const row = cell.closest("tr");
      const priorRow = row?.previousElementSibling;
      if (priorRow && !priorRow.querySelector("input, select, textarea")) {
        const text = (priorRow.innerText ?? "").replace(/\s+/g, " ").trim();
        if (text && text.length < 160) return text;
      }
    }

    let node = el.parentElement;
    for (let up = 0; node && up < 4; up += 1, node = node.parentElement) {
      if (node.querySelectorAll("input, select, textarea").length !== 1) break;
      const clone = node.cloneNode(true);
      clone.querySelectorAll("input, select, textarea, script, style, button").forEach((n) => n.remove());
      const text = (clone.innerText ?? "").replace(/\s+/g, " ").trim();
      if (text && text.length < 160) return text;
    }
    return "";
  }

  function visible(el) {
    if (el.disabled) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    // offsetParent is null for display:none and for position:fixed elements;
    // the rect check covers the fixed case without excluding it wrongly.
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function fields() {
    counter = 0;
    refs.clear();
    const out = [];

    for (const el of document.querySelectorAll("input, select, textarea")) {
      const type = (el.type ?? "text").toLowerCase();
      if (SKIP_TYPES.has(type)) continue;
      if (!visible(el)) continue;
      // A radio or checkbox describes one OPTION, not one field; its group's
      // name is the field, and its checked state is the value.
      const ref = `f${++counter}`;
      refs.set(ref, el);

      out.push({
        ref,
        name: el.name ?? "",
        id: el.id ?? "",
        autocomplete: el.getAttribute("autocomplete") ?? "",
        label: labelFor(el),
        placeholder: el.placeholder ?? "",
        type,
        value: readValue(el),
      });
    }
    return out;
  }

  function readValue(el) {
    if (el.type === "checkbox") return el.checked ? "Yes" : "";
    if (el.type === "radio") return el.checked ? (el.value || "Yes") : "";
    if (el.tagName === "SELECT") {
      const opt = el.selectedOptions?.[0];
      // An unchosen select is empty, not "Choose one". Its placeholder option
      // carries an empty value, which is how it is told apart from a real
      // answer — otherwise every untouched dropdown on the page is captured as
      // the word "Select".
      if (!opt || !(opt.value ?? "").trim()) return "";
      // The visible text, not the value: a state dropdown submits "AZ" but the
      // record should hold what a person would write.
      return (opt.text ?? "").trim();
    }
    return (el.value ?? "").trim();
  }

  /**
   * Set a value the way a person would, so frameworks notice.
   *
   * React tracks the last value it wrote on the DOM node itself and skips the
   * change event when `value` is assigned directly. Going through the
   * prototype's native setter bypasses React's own property descriptor, and
   * the dispatched `input` event then reaches its synthetic handler.
   */
  function setValue(el, value) {
    const proto = el.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : el.tagName === "SELECT"
        ? window.HTMLSelectElement.prototype
        : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;

    el.focus();
    if (setter) setter.call(el, value);
    else el.value = value;

    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
  }

  /** Pick the option whose text or value matches, loosely. Selects are picky. */
  function selectOption(el, value) {
    const want = value.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!want) return false;
    for (const opt of el.options) {
      const text = (opt.text ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const val = (opt.value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
      if (text === want || val === want) {
        el.value = opt.value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    }
    for (const opt of el.options) {
      const text = (opt.text ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
      if (text && (text.startsWith(want) || want.startsWith(text))) {
        el.value = opt.value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    }
    return false;
  }

  function fill(plan) {
    const filled = [];
    const failed = [];

    for (const [ref, value] of Object.entries(plan)) {
      const el = refs.get(ref);
      if (!el || !value) continue;
      try {
        if (el.tagName === "SELECT") {
          if (selectOption(el, value)) filled.push(ref);
          else failed.push({ ref, label: labelFor(el), value });
          continue;
        }
        if (el.type === "checkbox") {
          const on = /^(yes|true|y|1|on)$/i.test(value);
          if (el.checked !== on) el.click();
          filled.push(ref);
          continue;
        }
        if (el.type === "radio") continue; // Needs the group, not one button.

        setValue(el, value);
        // Trust nothing: confirm the framework actually kept it.
        if ((el.value ?? "").trim()) filled.push(ref);
        else failed.push({ ref, label: labelFor(el), value });
      } catch {
        failed.push({ ref, label: labelFor(el), value });
      }
    }

    // A brief outline on what was touched, so the owner can see the extent of
    // it at a glance rather than hunting the page for changes.
    for (const ref of filled) {
      const el = refs.get(ref);
      if (!el) continue;
      const previous = el.style.outline;
      el.style.outline = "2px solid #6366f1";
      setTimeout(() => {
        el.style.outline = previous;
      }, 2500);
    }

    return { filled: filled.length, failed };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type === "scan") {
      reply({ fields: fields(), site: location.hostname, href: location.href, title: document.title });
      return true;
    }
    if (msg?.type === "fill") {
      // The refs the popup holds came from its own scan, and the page may have
      // re-rendered since; rescanning first keeps them pointing at real nodes.
      fields();
      reply(fill(msg.plan ?? {}));
      return true;
    }
    return false;
  });

  // Answers the popup's "is the content script already here?" ping.
  return true;
})();
