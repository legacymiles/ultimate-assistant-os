"use client";

import { useMemo, useState } from "react";
import { Icon } from "../icons";
import { ProfileAvatar } from "./ProfileAvatar";
import { folderPathString } from "@/lib/recall/store";
import {
  profileCompleteness,
  profileKindLabel,
  roleLabel,
} from "@/lib/recall/profiles";
import type { Profile, ProfileKind, ProfileRole, RecallData } from "@/lib/recall/types";

interface Props {
  data: RecallData;
  onOpenProfile: (id: string) => void;
  onAddProfile: (kind?: ProfileKind, role?: ProfileRole) => void;
  onOpenMemory: () => void;
  onOpenFolder: (folderId: string) => void;
}

type Filter = "all" | "people" | "business";

/**
 * The profiles home. One hero for you, then everyone and everything else.
 * The Add tile is deliberately an invitation to talk, not a form — that is the
 * difference between another CRM and Jarvis.
 */
export function ProfilesBoard({ data, onOpenProfile, onAddProfile, onOpenMemory, onOpenFolder }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const self = data.profiles.find((p) => p.kind === "person" && p.role === "self");
  const others = data.profiles.filter((p) => p.id !== self?.id);
  const people = others.filter((p) => p.kind === "person");
  const businesses = others.filter((p) => p.kind === "business");

  const visible = useMemo(() => {
    if (filter === "people") return people;
    if (filter === "business") return businesses;
    return others;
  }, [filter, others, people, businesses]);

  return (
    <div>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            <Icon.Users width={12} height={12} />
            People &amp; businesses
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Profiles</h1>
          <p className="mt-1 max-w-xl text-sm text-ink-muted">
            One card per person or business. Each one owns a folder and a place in your
            memory, so a birthday, a login and a renewal date all live together.
          </p>
        </div>
        <button
          onClick={() => onAddProfile()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-3.5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-2"
        >
          <Icon.Plus width={16} height={16} /> Add profile
        </button>
      </header>

      <button
        onClick={onOpenMemory}
        className="mb-5 flex w-full items-center gap-3 rounded-2xl border border-line bg-gradient-to-r from-brand/10 via-panel to-panel px-4 py-3 text-left transition hover:border-brand/40"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand/15 text-brand">
          <Icon.Network width={18} height={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold text-ink">
            Profiles are folders. Folders are memory.
          </span>
          <span className="block text-[11px] text-ink-muted">
            Open the memory map to see every profile, note, login and domain as one connected web.
          </span>
        </span>
        <span className="hidden shrink-0 items-center gap-1 text-[11px] font-medium text-brand sm:flex">
          Open map <Icon.ArrowRight width={12} height={12} />
        </span>
      </button>

      {/* You */}
      {self ? (
        <div className="mb-5 overflow-hidden rounded-2xl border border-brand/30 bg-gradient-to-br from-brand/20 via-panel to-panel">
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
            <ProfileAvatar profile={self} size={84} />
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-brand">
                <Icon.User width={12} height={12} /> My profile
              </div>
              <h2 className="truncate text-xl font-bold tracking-tight text-ink">{self.displayName}</h2>
              <p className="mt-0.5 line-clamp-1 text-xs text-ink-muted">
                {self.headline || "Add a photo and a few details so Jarvis knows whose profile this is."}
              </p>
              <Completeness profile={self} className="mt-2.5 max-w-xs" />
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                onClick={() => onOpenProfile(self.id)}
                className="rounded-xl bg-brand px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-2"
              >
                Open my profile
              </button>
              {self.folderId && (
                <button
                  onClick={() => onOpenFolder(self.folderId as string)}
                  className="inline-flex items-center gap-1 rounded-xl border border-line bg-panel/60 px-3 py-2 text-xs font-medium text-ink-muted transition hover:text-ink"
                >
                  <Icon.Folder width={12} height={12} /> Folder
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => onAddProfile("person", "self")}
          className="mb-5 flex w-full flex-col items-start gap-3 rounded-2xl border border-dashed border-brand/40 bg-brand/[0.06] p-5 text-left transition hover:border-brand hover:bg-brand/10 sm:flex-row sm:items-center"
        >
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-brand/30 bg-brand/15 text-brand">
            <Icon.User width={26} height={26} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold text-ink">Set up my profile</span>
            <span className="mt-1 block max-w-xl text-xs leading-relaxed text-ink-muted">
              Add your photo, then tell Jarvis what it should know. It starts with the fields that
              matter — legal name, birthday, SSN placeholder, phone, email — and asks about the rest.
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-brand px-3.5 py-2 text-xs font-semibold text-white">
            <Icon.Plus width={14} height={14} /> Create my profile
          </span>
        </button>
      )}

      {/* Filter */}
      {others.length > 0 && (
        <div className="mb-3 flex items-center gap-1.5">
          {(
            [
              ["all", `All (${others.length})`],
              ["people", `People (${people.length})`],
              ["business", `Businesses (${businesses.length})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={
                "rounded-full border px-3 py-1.5 text-xs font-medium transition " +
                (filter === id
                  ? "border-brand bg-brand text-white"
                  : "border-line bg-panel text-ink-muted hover:text-ink")
              }
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 && others.length === 0 ? (
        <div className="mt-2 rounded-2xl border border-dashed border-line bg-panel/40 px-6 py-14 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/15 text-brand">
            <Icon.Users width={22} height={22} />
          </div>
          <h2 className="text-base font-semibold text-ink">Who should Jarvis know?</h2>
          <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-ink-muted">
            Start with your son, a client, or a business you run. Press Add profile and tell Jarvis
            what you know; it will build the folder, the placeholders and the account slots.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button
              onClick={() => onAddProfile("person")}
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-2"
            >
              <Icon.User width={15} height={15} /> Add a person
            </button>
            <button
              onClick={() => onAddProfile("business")}
              className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-panel px-4 py-2.5 text-sm font-medium text-ink-muted transition hover:text-ink"
            >
              <Icon.Building width={15} height={15} /> Add a business
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((profile) => (
            <ProfileCard
              key={profile.id}
              profile={profile}
              folder={folderPathString(data.folders, profile.folderId)}
              onOpen={() => onOpenProfile(profile.id)}
            />
          ))}

          <div
            role="button"
            tabIndex={0}
            onClick={() => onAddProfile()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onAddProfile();
              }
            }}
            className="group flex min-h-[172px] cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-panel/30 px-4 text-center text-ink-faint transition hover:border-brand/50 hover:bg-brand/[0.04] hover:text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-panel text-ink-faint transition group-hover:border-brand/40 group-hover:text-brand">
              <Icon.Plus width={20} height={20} />
            </span>
            <span className="text-sm font-medium">Add profile</span>
            <span className="max-w-[200px] text-[11px] leading-relaxed text-ink-faint">
              Talk to Jarvis — it already knows some of it
            </span>
            <span className="mt-1 flex gap-1.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddProfile("person");
                }}
                className="rounded-full border border-line bg-panel px-2 py-0.5 text-[10px] hover:border-brand/40 hover:text-brand"
              >
                Person
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddProfile("business");
                }}
                className="rounded-full border border-line bg-panel px-2 py-0.5 text-[10px] hover:border-brand/40 hover:text-brand"
              >
                Business
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Completeness({ profile, className }: { profile: Profile; className?: string }) {
  const c = profileCompleteness(profile);
  return (
    <div className={className}>
      <div className="mb-1 flex items-center gap-2 text-[10px] text-ink-faint">
        <span className="font-medium tabular-nums text-ink-muted">
          {c.known}/{c.total} details
        </span>
        {c.missing.length > 0 && <span>· {c.missing.length} to add</span>}
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-canvas">
        <div
          className={"h-full rounded-full " + (c.pct >= 80 ? "bg-emerald-400" : "bg-brand")}
          style={{ width: `${c.pct}%` }}
        />
      </div>
    </div>
  );
}

function ProfileCard({
  profile,
  folder,
  onOpen,
}: {
  profile: Profile;
  folder: string;
  onOpen: () => void;
}) {
  const accent =
    profile.kind === "business"
      ? "hover:border-amber-400/40 hover:bg-amber-500/[0.04]"
      : "hover:border-brand/40 hover:bg-brand/[0.04]";
  return (
    <button
      onClick={onOpen}
      className={
        "group flex min-h-[172px] flex-col rounded-2xl border border-line bg-panel/60 p-4 text-left transition " +
        accent
      }
    >
      <div className="flex items-start gap-3">
        <ProfileAvatar profile={profile} size={50} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-ink">{profile.displayName}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <span
              className={
                "rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider " +
                (profile.kind === "business"
                  ? "bg-amber-400/15 text-amber-200"
                  : "bg-brand/15 text-brand")
              }
            >
              {profileKindLabel(profile.kind)}
            </span>
            {profile.role && (
              <span className="rounded-full bg-panel-2 px-1.5 py-0.5 text-[9px] font-medium text-ink-muted">
                {roleLabel(profile.role)}
              </span>
            )}
            {profile.accounts.length > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-400/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-200">
                <Icon.Wallet width={8} height={8} /> {profile.accounts.length}
              </span>
            )}
          </div>
        </div>
      </div>

      <p className="mt-2.5 line-clamp-2 min-h-[30px] text-[11px] leading-relaxed text-ink-muted">
        {profile.headline || profile.notes || `No description yet — open to add one.`}
      </p>

      <div className="mt-auto pt-2">
        <Completeness profile={profile} />
        <div className="mt-1.5 flex items-center gap-1 text-[10px] text-ink-faint">
          <Icon.Folder width={10} height={10} />
          <span className="truncate">{folder}</span>
          <span className="ml-auto shrink-0 text-ink-faint transition group-hover:text-ink">
            Open →
          </span>
        </div>
      </div>
    </button>
  );
}
