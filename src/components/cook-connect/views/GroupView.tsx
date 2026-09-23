"use client";

// One group: who is in it, its conversation, and its video room. Only members
// can read or post — the database enforces that, not just this screen.

import { useCallback, useEffect, useState } from "react";
import { useCook } from "../CookConnect";
import { Columns } from "../Columns";
import { joinGroup, leaveGroup, loadGroup } from "@/lib/cook-connect/groups";
import { loadProfiles, type ProfileMap } from "@/lib/cook-connect/social";
import { rooms, type Group, type GroupMember } from "@/lib/cook-connect/types";
import { Avatar, Button, EmptyState, Loading, Panel, SectionHead, Tag, cx, relativeTime } from "../ui";
import { PeopleIcon } from "../icons";
import { ChatPanel } from "../play/ChatPanel";
import { VideoPanel } from "../play/VideoPanel";

export function GroupView({ groupId }: { groupId: string }) {
  const { sb, userId, navigate, notify, onlineIds } = useCook();
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [profiles, setProfiles] = useState<ProfileMap>({});
  const [joined, setJoined] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await loadGroup(sb, groupId, userId);
    setGroup(result.group);
    setMembers(result.members);
    setJoined(result.joined);
    setProfiles(await loadProfiles(sb, result.members.map((m) => m.user_id)));
    setLoading(false);
  }, [sb, groupId, userId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <Columns><Loading label="Opening the group" /></Columns>;

  if (!group) {
    return (
      <Columns>
        <Panel>
          <EmptyState
            title="That group is gone"
            body="It was closed, or the link was wrong."
            action={<Button variant="primary" onClick={() => navigate({ page: "explore" })}>Back to Explore</Button>}
          />
        </Panel>
      </Columns>
    );
  }

  const toggle = async () => {
    if (!userId) return;
    setBusy(true);
    if (joined) {
      await leaveGroup(sb, groupId, userId);
      notify(`You left ${group.name}.`);
    } else {
      const error = await joinGroup(sb, groupId, userId);
      if (error) { notify(`Couldn't join: ${error.message}`); setBusy(false); return; }
      notify(`You're in ${group.name}.`);
    }
    setBusy(false);
    await load();
  };

  const accent = `hsl(${group.hue} 62% 58%)`;

  return (
    <Columns
      rail={
        <>
          <Panel>
            <SectionHead title="Members" count={members.length} />
            {members.length === 0 ? (
              <p className="px-3 py-4 text-[12px] leading-relaxed text-[var(--cc-ink-muted)]">
                Nobody has joined yet. Be the first and the conversation starts with you.
              </p>
            ) : (
              <ul>
                {members.map((m, i) => {
                  const p = profiles[m.user_id];
                  return (
                    <li key={m.id} className={cx("cc-row px-3 py-2", i > 0 && "border-t border-[var(--cc-line-soft)]")}>
                      <button
                        type="button"
                        onClick={() => navigate({ page: "profile", userId: m.user_id })}
                        className="flex w-full items-center gap-2.5 text-left"
                      >
                        <Avatar
                          id={m.user_id}
                          name={p?.display_name ?? "Member"}
                          url={p?.avatar_url}
                          size={26}
                          online={onlineIds.has(m.user_id)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-[12px] font-semibold">
                              {m.user_id === userId ? "You" : p?.display_name ?? "Member"}
                            </span>
                            {m.user_id === group.created_by && <Tag>Started it</Tag>}
                          </span>
                          {relativeTime(m.joined_at) && (
                            <span className="block truncate text-[11px] text-[var(--cc-ink-faint)]">
                              joined {relativeTime(m.joined_at)}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          {joined && <VideoPanel
              room={rooms.group(groupId)}
              title="Group video"
              invitation="Talk face to face with the group."
            />}
        </>
      }
    >
      <Panel className="mb-4 p-4" >
        <div className="flex flex-wrap items-start gap-4">
          <span
            aria-hidden="true"
            className="h-12 w-12 shrink-0 rounded-xl"
            style={{ background: `linear-gradient(145deg, hsl(${group.hue} 55% 42%), hsl(${(group.hue + 40) % 360} 50% 26%))` }}
          />
          <div className="min-w-[220px] flex-1">
            <h1 className="text-[20px] font-bold leading-tight tracking-tight">{group.name}</h1>
            {group.description && (
              <p className="mt-1.5 max-w-[60ch] text-[13px] leading-relaxed text-[var(--cc-ink-muted)]">
                {group.description}
              </p>
            )}
            <p className="mt-2 text-[12px] text-[var(--cc-ink-faint)]">
              <span className="cc-num">{members.length}</span> member{members.length === 1 ? "" : "s"}
              {" · started "}{relativeTime(group.created_at)}
            </p>
          </div>
          <Button
            variant={joined ? "secondary" : "primary"}
            disabled={busy}
            onClick={() => void toggle()}
            style={joined ? undefined : { background: accent, borderColor: "transparent", color: "#14100a" }}
          >
            {joined ? "Leave group" : "Join group"}
          </Button>
        </div>
      </Panel>

      {joined ? (
        <ChatPanel
          room={rooms.group(groupId)}
          title={`${group.name} chat`}
          height="h-[420px]"
          placeholder={`Say something to ${group.name}…`}
        />
      ) : (
        <Panel>
          <SectionHead title="Group chat" />
          <EmptyState
            icon={<PeopleIcon size={26} />}
            title="Members only"
            body="Join the group to read the conversation and post in it. Only members can see what's said here."
            action={
              <Button variant="primary" disabled={busy} onClick={() => void toggle()}>
                Join {group.name}
              </Button>
            }
          />
        </Panel>
      )}
    </Columns>
  );
}
