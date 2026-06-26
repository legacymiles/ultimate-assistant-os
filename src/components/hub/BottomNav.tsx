"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "../icons";

const ITEMS = [
  { href: "/", label: "Home", icon: "Home" as const },
  { href: "/?focus=search", label: "Search", icon: "Search" as const },
  { href: "/?focus=cats", label: "Categories", icon: "Layers" as const },
  { href: "/favorites", label: "Favorites", icon: "Star" as const },
  { href: "/settings", label: "Settings", icon: "Settings" as const },
];

export function BottomNav() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas/85 px-2 pb-[max(env(safe-area-inset-bottom),0.4rem)] pt-1.5 backdrop-blur-md">
      <ul className="mx-auto flex max-w-md items-stretch justify-between">
        {ITEMS.map((it) => {
          const active =
            it.href === "/" ? path === "/" : path === it.href.split("?")[0];
          const IconComp = Icon[it.icon];
          return (
            <li key={it.href} className="flex-1">
              <Link
                href={it.href}
                className={
                  "flex flex-col items-center gap-0.5 rounded-lg px-2 py-1.5 text-[10px] font-medium transition " +
                  (active ? "text-ink" : "text-ink-faint hover:text-ink-muted")
                }
              >
                <IconComp width={20} height={20} />
                <span>{it.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
