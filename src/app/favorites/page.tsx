import Link from "next/link";
import { BottomNav } from "@/components/hub/BottomNav";
import { Icon } from "@/components/icons";

export const metadata = { title: "Favorites · Ultimate Assistant OS" };

export default function FavoritesPage() {
  return (
    <>
      <div className="mx-auto w-full max-w-3xl px-4 pb-28 pt-10 text-center sm:px-6">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-panel-2 text-ink-faint">
          <Icon.Star width={26} height={26} />
        </div>
        <h1 className="mt-4 text-xl font-bold text-ink">No favorites yet</h1>
        <p className="mx-auto mt-1 max-w-sm text-sm text-ink-muted">
          Star projects from their detail page to pin them here for quick access.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-2"
        >
          Browse projects
        </Link>
      </div>
      <BottomNav />
    </>
  );
}
