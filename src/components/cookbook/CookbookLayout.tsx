"use client";

import { useState } from "react";
import { useCookbook } from "./CookbookGenie";

const NAV = [
  { key: "dashboard", label: "My Cookbooks", icon: BookOpenIcon },
  { key: "discover", label: "Discover", icon: CompassIcon },
  { key: "leaderboard", label: "Leaderboards", icon: TrophyIcon },
  { key: "favorites", label: "Favorite Places", icon: MapPinIcon },
  { key: "shared", label: "Shared With Me", icon: UsersIcon },
] as const;

interface Props {
  currentPage: string;
  children: React.ReactNode;
}

export function CookbookLayout({ currentPage, children }: Props) {
  const { profile, user, isLocal, navigate, signOut } = useCookbook();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const initials = profile?.display_name
    ? profile.display_name.slice(0, 2).toUpperCase()
    : "??";

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas text-ink">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-panel md:flex">
        <SidebarContent
          currentPage={currentPage}
          navigate={navigate}
          onClose={() => setSidebarOpen(false)}
          mobile={false}
        />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setSidebarOpen(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <aside
            className="absolute left-0 top-0 h-full w-64 border-r border-line bg-panel shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <SidebarContent
              currentPage={currentPage}
              navigate={(r) => { navigate(r); setSidebarOpen(false); }}
              onClose={() => setSidebarOpen(false)}
              mobile
            />
          </aside>
        </div>
      )}

      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-panel/80 px-4 py-2.5 backdrop-blur-sm">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-ink-muted hover:text-ink md:hidden">
            <MenuIcon />
          </button>
          {isLocal && (
            <span className="hidden items-center gap-1.5 rounded-full border border-[#e67e22]/30 bg-[#e67e22]/10 px-2.5 py-1 text-xs font-medium text-[#e67e22] sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-[#e67e22]" /> Local demo
            </span>
          )}
          <div className="flex-1" />

          {/* User menu */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e67e22]/10 text-xs font-semibold text-[#e67e22]"
            >
              {initials}
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-10 z-50 w-48 rounded-lg border border-line bg-panel shadow-xl">
                  <div className="border-b border-line px-3 py-2">
                    <p className="text-sm font-medium">{profile?.display_name || "User"}</p>
                    {profile?.username && <p className="text-xs text-ink-muted">@{profile.username}</p>}
                  </div>
                  <button
                    onClick={() => { if (user) navigate({ page: "profile", userId: user.id }); setMenuOpen(false); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-ink-muted hover:bg-elevated hover:text-ink"
                  >
                    <UserIcon /> My profile
                  </button>
                  <button
                    onClick={() => { signOut(); setMenuOpen(false); }}
                    className="flex w-full items-center gap-2 border-t border-line px-3 py-2 text-sm text-red-400 hover:bg-elevated"
                  >
                    <LogOutIcon /> Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

function SidebarContent({
  currentPage,
  navigate,
  onClose,
  mobile,
}: {
  currentPage: string;
  navigate: (r: any) => void;
  onClose: () => void;
  mobile: boolean;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-line px-5 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#e67e22]">
          <ChefHatSmall />
        </div>
        <span className="text-lg font-bold" style={{ fontFamily: "Georgia, serif" }}>
          Cookbook Genie
        </span>
        {mobile && (
          <button onClick={onClose} className="ml-auto text-ink-muted hover:text-ink">
            <XIcon />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {NAV.map((item) => {
          const active = currentPage === item.key;
          return (
            <button
              key={item.key}
              onClick={() => navigate({ page: item.key })}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-[#e67e22]/10 text-[#e67e22]"
                  : "text-ink-muted hover:bg-elevated hover:text-ink"
              }`}
            >
              <item.icon />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-line p-3">
        <button
          onClick={() => navigate({ page: "new-cookbook" })}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#e67e22] px-3 py-2.5 text-sm font-medium text-white hover:bg-[#d35400] transition-colors"
        >
          <PlusIcon /> New Cookbook
        </button>
      </div>
    </div>
  );
}

/* ── Inline SVG icons ─────────────────────────────────────────────── */

function ChefHatSmall() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M17 21a1 1 0 0 0 1-1v-5.35c0-.457.316-.844.727-1.041a4 4 0 0 0-2.646-7.544 6 6 0 0 0-11.162 0A4 4 0 0 0 2.32 14.58c.46.217.68.593.68 1.06V20a1 1 0 0 0 1 1z" />
      <path d="M6 17h12" />
    </svg>
  );
}

function BookOpenIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M12 7v14" /><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function MapPinIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" /><circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M5 12h14" /><path d="M12 5v14" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <line x1="4" x2="20" y1="12" y2="12" /><line x1="4" x2="20" y1="6" y2="6" /><line x1="4" x2="20" y1="18" y2="18" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M18 6 6 18" /><path d="m6 6 12 12" />
    </svg>
  );
}

function LogOutIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" x2="9" y1="12" y2="12" />
    </svg>
  );
}

function CompassIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <circle cx="12" cy="12" r="10" /><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </svg>
  );
}

function TrophyIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  );
}
