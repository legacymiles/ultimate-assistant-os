"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, Message } from "../types";
import { loadProfiles } from "../social";
import { sounds } from "../sounds";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Backend = any;

const MAX_MESSAGES = 200;

/**
 * One chat room. Rooms are plain strings ("lounge", "match:<id>", "dm:a:b"),
 * so the lounge, a table and a direct message are the same code path.
 */
export function useMessages(sb: Backend, userId: string | null, room: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Names are fetched once per author and reused for every later message.
  const names = useRef<Record<string, { name: string; avatar: string | null }>>({});

  const decorate = useCallback((m: Message): ChatMessage => {
    const p = names.current[m.user_id];
    return { ...m, display_name: p?.name ?? "Member", avatar_url: p?.avatar ?? null };
  }, []);

  const learnNames = useCallback(async (ids: string[]) => {
    const missing = [...new Set(ids)].filter((id) => !names.current[id]);
    if (!missing.length) return;
    const profiles = await loadProfiles(sb, missing);
    for (const id of missing) {
      const p = profiles[id];
      names.current[id] = { name: p?.display_name ?? "Member", avatar: p?.avatar_url ?? null };
    }
  }, [sb]);

  const load = useCallback(async () => {
    if (!room) { setLoading(false); return; }
    setLoading(true);
    const { data, error: err } = await sb
      .from("messages").select("*").eq("room", room)
      .order("created_at", { ascending: false }).limit(MAX_MESSAGES);
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setError(null);
    const rows = ((data ?? []) as Message[]).slice().reverse();
    await learnNames(rows.map((m) => m.user_id));
    setMessages(rows.map(decorate));
    setLoading(false);
  }, [sb, room, decorate, learnNames]);

  useEffect(() => { setMessages([]); void load(); }, [load]);

  useEffect(() => {
    if (!room) return;
    const channel = sb
      .channel(`chat:${room}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "cook", table: "messages", filter: `room=eq.${room}` },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (payload: any) => {
          const msg = payload.new as Message;
          await learnNames([msg.user_id]);
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            // Drop our own optimistic copy if this is the echo of it.
            const withoutTemp = prev.filter(
              (m) => !(m.id.startsWith("tmp-") && m.user_id === msg.user_id && m.content === msg.content),
            );
            return [...withoutTemp, decorate(msg)].slice(-MAX_MESSAGES);
          });
          if (msg.user_id !== userId) sounds.chatMessage();
        },
      )
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }, [sb, room, userId, decorate, learnNames]);

  const send = useCallback(async (content: string) => {
    const text = content.trim();
    if (!userId || !room || !text) return;
    await learnNames([userId]);
    const temp = decorate({
      id: `tmp-${Date.now()}`, room, user_id: userId, content: text, created_at: new Date().toISOString(),
    });
    setMessages((prev) => [...prev, temp]);

    const { data, error: err } = await sb.from("messages")
      .insert({ room, user_id: userId, content: text }).select("*").single();
    if (err) {
      setMessages((prev) => prev.filter((m) => m.id !== temp.id));
      setError(`Message not sent: ${err.message}`);
      return;
    }
    const saved = data as Message;
    setMessages((prev) =>
      prev.some((m) => m.id === saved.id)
        ? prev.filter((m) => m.id !== temp.id)
        : prev.map((m) => (m.id === temp.id ? decorate(saved) : m)),
    );
  }, [sb, userId, room, decorate, learnNames]);

  return { messages, send, loading, error };
}
