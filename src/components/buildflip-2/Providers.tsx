"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { AppStateProvider } from "./AppState";
import { cn, ease } from "@/lib/buildflip-2/ui";
import { loadLocal, reconcile, saveSynced } from "@/lib/sync/appState";
import "./buildflip.css";

/* ------------------------------------------------------------------- Theme */

type Theme = "dark" | "light" | "system";

/**
 * The theme pick, in the hub's cross-device store rather than this app's own
 * localStorage key. `appState.ts` still reads synchronously out of localStorage,
 * so there is no flash and offline is unchanged — it just also pushes the pick
 * to the signed-in user's `app_state` row, so choosing light on the laptop is
 * light on the phone too.
 */
const THEME_KEY = "buildflip-2:prefs:v1";

interface Prefs {
  theme: Theme;
}

const ThemeCtx = createContext<{
  theme: Theme;
  resolved: "dark" | "light";
  setTheme: (t: Theme) => void;
}>({ theme: "dark", resolved: "dark", setTheme: () => {} });

export const useTheme = () => useContext(ThemeCtx);

/**
 * Readable in both light and dark mode (U5), remembered across devices.
 *
 * The attribute goes on this app's OWN root, not on <html>: the hub is dark
 * everywhere and one app's light mode must not repaint the rest of it. That
 * root is rendered here so there is exactly one element carrying both the
 * `.bf2` token scope and the theme.
 */
function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");
  const [resolved, setResolved] = useState<"dark" | "light">("dark");

  const resolve = useCallback((t: Theme): "dark" | "light" => {
    if (t !== "system") return t;
    return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }, []);

  useEffect(() => {
    const stored = loadLocal<Prefs>(THEME_KEY, { theme: "dark" }).theme ?? "dark";
    setThemeState(stored);
    setResolved(resolve(stored));
    // Settle against the server once, then take whichever copy won.
    void reconcile(THEME_KEY).then(() => {
      const settled = loadLocal<Prefs>(THEME_KEY, { theme: stored }).theme ?? stored;
      setThemeState(settled);
      setResolved(resolve(settled));
    });
    const mq = window.matchMedia?.("(prefers-color-scheme: light)");
    const onChange = () => {
      if ((loadLocal<Prefs>(THEME_KEY, { theme: "dark" }).theme ?? "dark") === "system") {
        setResolved(resolve("system"));
      }
    };
    mq?.addEventListener?.("change", onChange);
    return () => mq?.removeEventListener?.("change", onChange);
  }, [resolve]);

  const setTheme = useCallback(
    (t: Theme) => {
      setThemeState(t);
      setResolved(resolve(t));
      saveSynced<Prefs>(THEME_KEY, { theme: t });
    },
    [resolve],
  );

  return (
    <ThemeCtx.Provider value={{ theme, resolved, setTheme }}>
      <div className="bf2 grain antialiased" data-bf-theme={resolved}>
        {children}
      </div>
    </ThemeCtx.Provider>
  );
}

/* ------------------------------------------------------------------ Toasts */

export interface Toast {
  id: string;
  tone: "info" | "success" | "error";
  message: string;
  action?: { label: string; onClick: () => void };
}

const ToastCtx = createContext<{
  toast: (t: Omit<Toast, "id">) => void;
}>({ toast: () => {} });

export const useToast = () => useContext(ToastCtx);

function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setItems((prev) => [...prev.filter((p) => p.message !== t.message), { ...t, id }]);
    setTimeout(() => setItems((prev) => prev.filter((p) => p.id !== id)), t.tone === "error" ? 9000 : 5000);
  }, []);

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[90] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end sm:px-6"
      >
        <AnimatePresence>
          {items.map((t) => {
            const Icon =
              t.tone === "success" ? CheckCircle2 : t.tone === "error" ? TriangleAlert : Info;
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 16, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{ duration: 0.3, ease }}
                className={cn(
                  "pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-[12px] border px-3.5 py-3 text-[13px] leading-relaxed shadow-[var(--shadow-pop)] backdrop-blur",
                  t.tone === "error"
                    ? "border-[color-mix(in_srgb,var(--loss)_40%,transparent)] bg-[color-mix(in_srgb,var(--loss)_14%,var(--surface))] text-[var(--ink)]"
                    : t.tone === "success"
                      ? "border-[color-mix(in_srgb,var(--profit)_40%,transparent)] bg-[color-mix(in_srgb,var(--profit)_12%,var(--surface))] text-[var(--ink)]"
                      : "border-[var(--line)] bg-[var(--surface)] text-[var(--ink)]",
                )}
              >
                <Icon
                  aria-hidden
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0",
                    t.tone === "error"
                      ? "text-[var(--loss)]"
                      : t.tone === "success"
                        ? "text-[var(--profit)]"
                        : "text-[var(--ink-3)]",
                  )}
                />
                <span className="min-w-0 flex-1">{t.message}</span>
                {t.action && (
                  <button
                    type="button"
                    onClick={() => {
                      t.action!.onClick();
                      setItems((prev) => prev.filter((p) => p.id !== t.id));
                    }}
                    className="shrink-0 rounded px-1.5 py-0.5 text-[12px] font-semibold text-[var(--accent)] underline-offset-2 hover:underline"
                  >
                    {t.action.label}
                  </button>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------------------------------------------------------- Crash reporting */
//
// There was a CrashReporter here listening for `error` and `unhandledrejection`
// and POSTing them to this app's own /api/log. The hub already does exactly
// that for every page, from `ErrorReporter` in its root layout, and the reports
// land in Jarvis › Work › Site errors where the owner actually looks (R2). A
// second listener on the same two events would file every browser crash twice,
// so this one is gone. Server-side failures still go through
// `src/lib/buildflip-2/log.ts` and still show on BuildFlip's own owner page.

/* ----------------------------------------------------------------- Compose */

export default function Providers({
  children,
  signedIn,
}: {
  children: React.ReactNode;
  signedIn: boolean;
}) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AppStateProvider initialSignedIn={signedIn}>
          {children}
        </AppStateProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
