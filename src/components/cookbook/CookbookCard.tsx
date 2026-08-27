"use client";

import type { Profile } from "./social";

interface Props {
  cookbook: { id: string; name: string; description: string | null; owner_id: string };
  author?: Profile;
  cover?: string | null;
  recipeCount?: number;
  starCount: number;
  starred: boolean;
  canStar: boolean;
  rank?: number;
  onOpen: () => void;
  onStar: () => void;
  onAuthor?: () => void;
}

export function CookbookCard({
  cookbook, author, cover, recipeCount = 0, starCount, starred, canStar, rank, onOpen, onStar, onAuthor,
}: Props) {
  const initials = author?.display_name ? author.display_name.slice(0, 2).toUpperCase() : "??";

  return (
    <div className="group relative overflow-hidden rounded-xl border border-line bg-panel transition-all hover:border-[#e67e22]/30 hover:shadow-lg">
      {typeof rank === "number" && (
        <div className={`absolute left-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold shadow ${
          rank === 1 ? "bg-[#f4c430] text-black" : rank === 2 ? "bg-[#c0c0c0] text-black" : rank === 3 ? "bg-[#cd7f32] text-white" : "bg-elevated text-ink-muted"
        }`}>
          {rank}
        </div>
      )}

      <button onClick={onOpen} className="block w-full text-left">
        {cover ? (
          <img src={cover} alt={cookbook.name} className="h-36 w-full object-cover" />
        ) : (
          <div className="flex h-36 w-full items-center justify-center bg-elevated"><BookIcon /></div>
        )}
      </button>

      <div className="p-4">
        <button onClick={onOpen} className="block w-full text-left">
          <h3 className="font-semibold group-hover:text-[#e67e22] transition-colors" style={{ fontFamily: "Georgia, serif" }}>
            {cookbook.name}
          </h3>
          {cookbook.description && <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{cookbook.description}</p>}
        </button>

        <div className="mt-3 flex items-center justify-between">
          <button
            onClick={onAuthor}
            className="flex items-center gap-2 text-xs text-ink-muted hover:text-ink"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#e67e22]/10 text-[10px] font-semibold text-[#e67e22]">{initials}</span>
            <span>{author?.display_name || "Unknown"}</span>
          </button>

          <div className="flex items-center gap-3">
            <span className="text-xs text-ink-faint">{recipeCount} recipes</span>
            <button
              onClick={onStar}
              disabled={!canStar}
              className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium transition-colors ${
                starred ? "bg-[#f4c430]/15 text-[#f4c430]" : "bg-elevated text-ink-muted hover:text-ink"
              } ${!canStar ? "cursor-default" : ""}`}
            >
              <StarIcon filled={starred} /> {starCount}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BookIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#e67e22" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8 opacity-40"><path d="M12 7v14" /><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" /></svg>;
}

function StarIcon({ filled }: { filled: boolean }) {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={filled ? "#f4c430" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.29a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" /></svg>;
}
