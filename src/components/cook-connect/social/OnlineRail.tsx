"use client";

// Who is around, in the Play rail. Presence only — the full directory is
// Explore, and this is just enough to know whether opening a table is worth it.

import { useCallback, useEffect, useState } from "react";
import { useCook } from "../CookConnect";
import type { Profile } from "@/lib/cook-connect/types";
import { Avatar, Button, Panel, SectionHead, cx } from "../ui";

export function OnlineRail() {
  const { sb, userId, navigate, onlineIds } = useCook();
  const [people, setPeople] = useState<Profile[]>([]);

  const refresh = useCallback(async () => {
    const { data } = await sb.from("profiles").select("*").order("display_name");
    setPeople(((data ?? []) as Profile[]).filter((p) => p.id !== userId));
  }, [sb, userId]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const online = people.filter((p) => onlineIds.has(p.id));
  const shown = online.length > 0 ? online : people.slice(0, 6);

  return (
    <Panel>
      <SectionHead
        title={online.length > 0 ? "Online now" : "Members"}
        count={online.length > 0 ? online.length : undefined}
        action={
          people.length > 0 ? (
            <Button variant="ghost" onClick={() => navigate({ page: "explore" })}>
              Explore
            </Button>
          ) : undefined
        }
      />

      {shown.length === 0 ? (
        <p className="px-3 py-4 text-[12px] leading-relaxed text-[var(--cc-ink-muted)]">
          Nobody else has joined yet. The computer will still play you at either game, and anyone
          who signs up later shows up here.
        </p>
      ) : (
        <ul>
          {shown.map((p, i) => (
            <li key={p.id} className={cx("cc-row px-3 py-2", i > 0 && "border-t border-[var(--cc-line-soft)]")}>
              <button
                type="button"
                onClick={() => navigate({ page: "profile", userId: p.id })}
                className="flex w-full items-center gap-2.5 text-left"
              >
                <Avatar id={p.id} name={p.display_name} url={p.avatar_url} size={26} online={onlineIds.has(p.id)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold">{p.display_name}</span>
                  <span className="block truncate text-[11px] text-[var(--cc-ink-faint)]">
                    {p.city ?? `@${p.handle}`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
