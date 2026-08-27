"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/icons";

function UnlockForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/apps/projects-timeline";

  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/timeline-unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.status === 401) {
        setError("Wrong password.");
        return;
      }
      if (!res.ok) {
        setError("Something went wrong. Try again.");
        return;
      }
      // Full reload so the middleware sees the new cookie.
      window.location.href = next;
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="w-full max-w-sm rounded-2xl border border-line bg-panel p-6 shadow-2xl"
    >
      <div className="mb-5 flex flex-col items-center text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand text-white">
          <Icon.Layers width={24} height={24} />
        </div>
        <h1 className="mt-3 text-xl font-bold text-ink">Projects Timeline</h1>
        <p className="mt-1 text-xs text-ink-faint">This is a private workspace.</p>
      </div>

      <label className="mb-4 block">
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-faint">
          Password
        </span>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
      </label>

      {error && <p className="mb-3 text-xs text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={busy || !password}
        className="w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-2 disabled:opacity-50"
      >
        {busy ? "Unlocking…" : "Unlock workspace"}
      </button>

      <Link
        href="/"
        className="mt-4 block text-center text-xs text-ink-faint underline-offset-2 hover:text-ink hover:underline"
      >
        ← Back to hub
      </Link>
    </form>
  );
}

export default function TimelineUnlockPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <Suspense fallback={null}>
        <UnlockForm />
      </Suspense>
    </div>
  );
}
