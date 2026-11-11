"use client";

import { useRef, useState } from "react";
import { Icon } from "../icons";
import { avatarToDataUrl, profileInitials } from "@/lib/recall/profiles";
import type { Profile } from "@/lib/recall/types";

interface Props {
  profile: Pick<Profile, "displayName" | "avatar" | "kind">;
  size?: number;
  editable?: boolean;
  onChange?: (avatar: string) => void;
  onError?: (message: string) => void;
  className?: string;
}

/**
 * The profile image. A person and a business get different tints so a wall of
 * avatars reads at a glance, and an upload is centre-cropped to a square before
 * it ever touches localStorage.
 */
export function ProfileAvatar({ profile, size = 56, editable, onChange, onError, className }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function choose(file: File | undefined) {
    if (!file || !onChange) return;
    setBusy(true);
    try {
      const data = await avatarToDataUrl(file);
      onChange(data);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Could not use that image.");
    } finally {
      setBusy(false);
    }
  }

  const tint =
    profile.kind === "business"
      ? "from-amber-400/35 via-amber-500/10 to-transparent text-amber-100 ring-amber-400/30"
      : "from-brand/40 via-violet-500/10 to-transparent text-violet-100 ring-brand/30";

  return (
    <div className={"group/avatar relative shrink-0 " + (className ?? "")} style={{ width: size, height: size }}>
      <div
        className={
          "flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-gradient-to-br ring-1 " +
          tint
        }
      >
        {profile.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.avatar}
            alt={profile.displayName}
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <span
            className="font-semibold tracking-tight"
            style={{ fontSize: Math.max(11, Math.round(size * 0.32)) }}
          >
            {profileInitials(profile.displayName)}
          </span>
        )}
      </div>

      {editable && (
        <>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            title="Change profile photo"
            aria-label="Change profile photo"
            className="absolute inset-0 flex items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-[1px] transition group-hover/avatar:opacity-100 disabled:opacity-100"
          >
            {busy ? (
              <Icon.Refresh width={Math.max(12, size * 0.24)} height={Math.max(12, size * 0.24)} className="animate-spin" />
            ) : (
              <Icon.Upload width={Math.max(12, size * 0.24)} height={Math.max(12, size * 0.24)} />
            )}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*,.heic,.heif"
            hidden
            onChange={(e) => {
              void choose(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {/* Always visible: a hover-only control is unreachable on a phone,
              which is exactly where most profile photos come from. */}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            title="Change profile photo"
            aria-label="Change profile photo"
            className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full border border-line bg-brand text-white shadow transition hover:bg-brand-2 disabled:opacity-60"
          >
            <Icon.Upload width={11} height={11} />
          </button>
        </>
      )}
    </div>
  );
}
