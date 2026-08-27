"use client";

import { useState } from "react";
import { useCookbook } from "../CookbookGenie";

export function NewCookbookView() {
  const { sb, user, navigate } = useCookbook();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [privacy, setPrivacy] = useState<"public" | "private">("public");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !name.trim()) return;
    setLoading(true);
    setError(null);
    const { data, error: err } = await sb
      .from("cookbooks")
      .insert({ owner_id: user.id, name: name.trim(), description: description.trim() || null, privacy })
      .select()
      .single();
    setLoading(false);
    if (err) {
      setError(err.message);
    } else {
      navigate({ page: "cookbook", id: data.id });
    }
  };

  return (
    <div className="mx-auto max-w-lg">
      <button onClick={() => navigate({ page: "dashboard" })} className="mb-6 inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink">
        <ArrowLeftIcon /> Back to cookbooks
      </button>

      <div className="mb-8 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#e67e22]/10">
          <BookIcon />
        </div>
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: "Georgia, serif" }}>New Cookbook</h1>
          <p className="text-sm text-ink-muted">Create a new recipe collection</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400">{error}</div>
      )}

      <form onSubmit={handleCreate} className="space-y-5">
        <div>
          <label className="mb-1 block text-sm font-medium">Cookbook name</label>
          <input
            placeholder="e.g. Weeknight Dinners, High Protein Meals"
            value={name} onChange={(e) => setName(e.target.value)} required
            className="w-full rounded-lg border border-line bg-elevated px-3 py-2.5 text-ink placeholder:text-ink-faint focus:border-[#e67e22] focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Description (optional)</label>
          <textarea
            placeholder="What kind of recipes will this cookbook contain?"
            value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
            className="w-full rounded-lg border border-line bg-elevated px-3 py-2.5 text-ink placeholder:text-ink-faint focus:border-[#e67e22] focus:outline-none resize-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Privacy</label>
          <select
            value={privacy} onChange={(e) => setPrivacy(e.target.value as any)}
            className="w-full rounded-lg border border-line bg-elevated px-3 py-2.5 text-ink focus:border-[#e67e22] focus:outline-none"
          >
            <option value="public">Public — Discoverable, others can star it</option>
            <option value="private">Private — Only you can see it</option>
          </select>
        </div>
        <button type="submit" disabled={loading || !name.trim()}
          className="w-full rounded-lg bg-[#e67e22] px-4 py-2.5 font-medium text-white hover:bg-[#d35400] disabled:opacity-50 transition-colors">
          {loading ? "Creating..." : "Create Cookbook"}
        </button>
      </form>
    </div>
  );
}

function ArrowLeftIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></svg>;
}

function BookIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#e67e22" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6"><path d="M12 7v14" /><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" /></svg>;
}
