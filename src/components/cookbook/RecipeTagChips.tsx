"use client";

interface Props {
  proteinTags?: string[];
  mealTypeTags?: string[];
  cuisineTags?: string[];
  size?: "sm" | "md";
  onTagClick?: (category: string, tag: string) => void;
  activeFilters?: { category: string; tag: string }[];
}

const COLORS = {
  protein: "bg-emerald-900/40 text-emerald-300",
  meal_type: "bg-orange-900/40 text-orange-300",
  cuisine: "bg-blue-900/40 text-blue-300",
};

export function RecipeTagChips({
  proteinTags = [],
  mealTypeTags = [],
  cuisineTags = [],
  size = "sm",
  onTagClick,
  activeFilters = [],
}: Props) {
  const isActive = (cat: string, tag: string) =>
    activeFilters.some((f) => f.category === cat && f.tag === tag);

  const cls = size === "sm" ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2.5 py-1";

  const chip = (tag: string, cat: string, color: string) => (
    <span
      key={`${cat}-${tag}`}
      onClick={(e) => { if (onTagClick) { e.preventDefault(); e.stopPropagation(); onTagClick(cat, tag); } }}
      className={`inline-flex items-center rounded-full font-medium transition-all ${cls} ${color} ${
        onTagClick ? "cursor-pointer hover:opacity-80" : ""
      } ${isActive(cat, tag) ? "ring-2 ring-offset-1 ring-ink/30" : ""}`}
    >
      {tag}
    </span>
  );

  if (!proteinTags.length && !mealTypeTags.length && !cuisineTags.length) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {proteinTags.map((t) => chip(t, "protein", COLORS.protein))}
      {mealTypeTags.map((t) => chip(t, "meal_type", COLORS.meal_type))}
      {cuisineTags.map((t) => chip(t, "cuisine", COLORS.cuisine))}
    </div>
  );
}
