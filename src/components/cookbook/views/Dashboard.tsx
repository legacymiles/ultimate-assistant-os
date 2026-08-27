"use client";

import { useState, useEffect } from "react";
import { useCookbook } from "../CookbookGenie";

interface Cookbook {
  id: string;
  name: string;
  description: string | null;
  updated_at: string;
}

export function Dashboard() {
  const { sb, user, navigate } = useCookbook();
  const [cookbooks, setCookbooks] = useState<Cookbook[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    sb.from("cookbooks")
      .select("id, name, description, updated_at")
      .eq("owner_id", user.id)
      .order("updated_at", { ascending: false })
      .then(({ data }) => {
        setCookbooks(data || []);
        setLoading(false);
      });
  }, [sb, user]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" style={{ fontFamily: "Georgia, serif" }}>My Cookbooks</h1>
          <p className="mt-1 text-ink-muted">Your personal recipe collections</p>
        </div>
        <button
          onClick={() => navigate({ page: "new-cookbook" })}
          className="flex items-center gap-2 rounded-lg bg-[#e67e22] px-4 py-2 text-sm font-medium text-white hover:bg-[#d35400] transition-colors"
        >
          <PlusIcon /> New Cookbook
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-xl bg-elevated" />
          ))}
        </div>
      ) : cookbooks.length > 0 ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {cookbooks.map((cb) => (
            <button
              key={cb.id}
              onClick={() => navigate({ page: "cookbook", id: cb.id })}
              className="group rounded-xl border border-line bg-panel p-5 text-left transition-all hover:border-[#e67e22]/30 hover:shadow-lg"
            >
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-[#e67e22]/10">
                <BookIcon />
              </div>
              <h3 className="text-lg font-semibold group-hover:text-[#e67e22] transition-colors" style={{ fontFamily: "Georgia, serif" }}>
                {cb.name}
              </h3>
              {cb.description && (
                <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{cb.description}</p>
              )}
              <p className="mt-3 text-xs text-ink-faint">
                Updated {new Date(cb.updated_at).toLocaleDateString()}
              </p>
            </button>
          ))}
        </div>
      ) : (
        <div className="py-20 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#e67e22]/10">
            <BookIcon large />
          </div>
          <h2 className="mb-2 text-xl font-semibold" style={{ fontFamily: "Georgia, serif" }}>No cookbooks yet</h2>
          <p className="mb-6 text-ink-muted">Create your first cookbook to start collecting recipes</p>
          <button
            onClick={() => navigate({ page: "new-cookbook" })}
            className="inline-flex items-center gap-2 rounded-lg bg-[#e67e22] px-4 py-2 text-sm font-medium text-white hover:bg-[#d35400]"
          >
            <PlusIcon /> Create your first cookbook
          </button>
        </div>
      )}
    </div>
  );
}

function PlusIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M5 12h14" /><path d="M12 5v14" /></svg>;
}

function BookIcon({ large }: { large?: boolean }) {
  const s = large ? "h-8 w-8" : "h-6 w-6";
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#e67e22" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={s}><path d="M12 7v14" /><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" /></svg>;
}
