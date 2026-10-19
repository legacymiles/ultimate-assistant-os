/*
 * Jarvis error reporter for client sites.
 *
 * Add one line before </body> on any site you build:
 *
 *   <script src="https://ultimate-assistant-os.vercel.app/jarvis-errors.js" data-site="barber-shop" defer></script>
 *
 * data-site is the name the crash shows under in Jarvis › Deck › Site errors.
 * Sends uncaught errors and unhandled promise rejections — the message, the
 * stack and the page path only (no query string, no cookies, no form data).
 * Each distinct message is sent at most once every 30 s per visitor, and the
 * script never throws, so it cannot break the site it watches.
 */
(function () {
  try {
    var me = document.currentScript;
    var site = (me && me.getAttribute("data-site")) || location.hostname || "client-site";
    var origin = me && me.src ? new URL(me.src).origin : "https://ultimate-assistant-os.vercel.app";
    var endpoint = origin + "/api/site-errors/report";
    var recent = {};

    function send(err, kind) {
      try {
        var e = err instanceof Error ? err : new Error(typeof err === "string" ? err : "Unknown error");
        var message = String(e.message || e.name || "Unknown error").slice(0, 500);
        var now = Date.now();
        if (recent[message] && recent[message] > now - 30000) return;
        recent[message] = now;
        var body = JSON.stringify({
          site: site,
          kind: kind,
          message: message,
          stack: String(e.stack || "").slice(0, 4000),
          url: location.hostname + location.pathname,
        });
        var blob = new Blob([body], { type: "text/plain" });
        if (!(navigator.sendBeacon && navigator.sendBeacon(endpoint, blob))) {
          fetch(endpoint, { method: "POST", body: body, keepalive: true, mode: "cors" }).catch(function () {});
        }
      } catch (_) {}
    }

    window.addEventListener("error", function (ev) {
      send(ev.error || ev.message, "error");
    });
    window.addEventListener("unhandledrejection", function (ev) {
      send(ev.reason, "rejection");
    });
  } catch (_) {}
})();
