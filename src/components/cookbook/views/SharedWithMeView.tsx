"use client";

import { useState, useEffect } from "react";
import { useCookbook } from "../CookbookGenie";

interface Share {
  id: string;
  cookbooks: { id: string; name: string } | null;
}

export function SharedWithMeView() {
  const { sb, user, navigate } = useCookbook();
  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    sb.from("cookbook_shares")
      .select("id, cookbooks(id, name)")
      .or(`shared_with_user_id.eq.${user.id},shared_with_email.eq.${user.email}`)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setShares((data as any) || []);
        setLoading(false);
      });
  }, [sb, user]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold" style={{ fontFamily: "Georgia, serif" }}>Shared With Me</h1>
        <p className="mt-1 text-ink-muted">Cookbooks others have shared with you</p>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-40 animate-pulse rounded-xl bg-elevated" />)}
        </div>
      ) : shares.length > 0 ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {shares.filter((s) => s.cookbooks).map((s) => (
            <button
              key={s.id}
              onClick={() => navigate({ page: "cookbook", id: s.cookbooks!.id })}
              className="group rounded-xl border border-line bg-panel p-5 text-left transition-all hover:border-[#e67e22]/30 hover:shadow-lg"
            >
              <div className="mb-4 flex items-center gap-2">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#e67e22]/10"><BookIcon /></div>
                <span className="rounded-full bg-elevated px-2 py-0.5 text-xs font-medium text-ink-muted">View &amp; Copy</span>
              </div>
              <h3 className="text-lg font-semibold group-hover:text-[#e67e22] transition-colors" style={{ fontFamily: "Georgia, serif" }}>
                {s.cookbooks!.name}
              </h3>
            </button>
          ))}
        </div>
      ) : (
        <div className="py-20 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#e67e22]/10"><UsersIcon /></div>
          <h2 className="mb-2 text-xl font-semibold" style={{ fontFamily: "Georgia, serif" }}>Nothing shared yet</h2>
          <p className="text-ink-muted">When someone shares a cookbook with you, it&apos;ll appear here</p>
        </div>
      )}
    </div>
  );
}

function BookIcon() { return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#e67e22" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6"><path d="M12 7v14" /><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" /></svg>; }
function UsersIcon() { return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#e67e22" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>; }
