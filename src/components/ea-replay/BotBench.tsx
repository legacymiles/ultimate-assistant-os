"use client";

// ---------------------------------------------------------------------------
// EA World › Replay › Bring a bot.
//
// Two ways in. Drop or paste an .mq4 and press "Port with AI" — the source is
// translated to a replay bot and the model says, in NOTES, what it could not
// carry over. Or write one by hand from the template. Either way you see the
// code before it runs, and it is checked before it can be saved.
//
// An .ex4 is refused with the reason: it is compiled machine code and nothing,
// AI included, can read the strategy out of it.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { CUSTOM_TEMPLATE, compileCustom, type CustomBot } from "@/lib/ea-replay/custom";

function newId() {
  return `bot-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function BotBench({
  bots,
  onSave,
  onUse,
  onClose,
}: {
  bots: CustomBot[];
  onSave: (next: CustomBot[]) => void;
  onUse: (id: string) => void;
  onClose: () => void;
}) {
  const [currentId, setCurrentId] = useState<string | null>(bots[0]?.id ?? null);
  const current = bots.find((b) => b.id === currentId) ?? null;
  const [name, setName] = useState(current?.name ?? "My bot");
  const [source, setSource] = useState(current?.source ?? CUSTOM_TEMPLATE);
  const [from, setFrom] = useState(current?.from ?? "hand");
  const [mq4, setMq4] = useState("");
  const [mq4Name, setMq4Name] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [over, setOver] = useState(false);

  // Picking a bot in the list loads it into the editor. Done here, not in an
  // effect on currentId, so a fresh port is never overwritten by the template.
  const select = (id: string | null) => {
    const b = bots.find((x) => x.id === id);
    setCurrentId(id);
    setName(b?.name ?? "My bot");
    setSource(b?.source ?? CUSTOM_TEMPLATE);
    setFrom(b?.from ?? "hand");
    setNotes("");
    setMsg(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const check = (): boolean => {
    try {
      const def = compileCustom({ id: "check", name, source, from, createdAt: 0 });
      def.create(Object.fromEntries(def.params.map((p) => [p.key, p.default])));
      setMsg({ ok: true, text: `Looks runnable: "${def.name}" with ${def.params.length} input${def.params.length === 1 ? "" : "s"}.` });
      return true;
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
      return false;
    }
  };

  const save = (andUse: boolean) => {
    if (!check()) return;
    const id = current?.id ?? newId();
    const bot: CustomBot = { id, name: name.trim() || "My bot", source, from, createdAt: current?.createdAt ?? Date.now() };
    const next = current ? bots.map((b) => (b.id === id ? bot : b)) : [...bots, bot];
    onSave(next);
    setCurrentId(id);
    if (andUse) onUse(id);
  };

  const remove = () => {
    if (!current) return;
    onSave(bots.filter((b) => b.id !== current.id));
    select(null);
  };

  const readFile = async (file: File) => {
    const buf = new Uint8Array(await file.arrayBuffer());
    if (file.name.toLowerCase().endsWith(".ex4") || (buf[0] === 0x45 && buf[1] === 0x58)) {
      setMsg({ ok: false, text: "That is a compiled .ex4. Nothing can read the strategy out of machine code — the .mq4 source is needed. If you only have the .ex4, describe how it trades and write the bot from the template." });
      return;
    }
    // MetaEditor saves UTF-16 or Windows-1252 depending on build; try both.
    let text = new TextDecoder("utf-8").decode(buf);
    if (buf[0] === 0xff && buf[1] === 0xfe) text = new TextDecoder("utf-16le").decode(buf);
    else if (text.includes("�")) text = new TextDecoder("windows-1252").decode(buf);
    setMq4(text);
    setMq4Name(file.name);
    setMsg(null);
  };

  const port = async () => {
    if (!mq4.trim()) {
      setMsg({ ok: false, text: "Drop an .mq4 file or paste its source first." });
      return;
    }
    setBusy(true);
    setMsg(null);
    setNotes("");
    try {
      const res = await fetch("/api/ea-replay/port", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: mq4, fileName: mq4Name }),
      });
      const body = await res.json().catch(() => ({}));
      if (body.code) {
        setCurrentId(null);
        setSource(body.code);
        setFrom(mq4Name || "pasted .mq4");
        const m = String(body.code).match(/name:\s*["'`]([^"'`]+)/);
        setName(m ? m[1] : mq4Name.replace(/\.mq4$/i, "") || "Ported EA");
      }
      if (!res.ok) {
        setMsg({ ok: false, text: body.error ?? `Port failed (${res.status})` });
      } else {
        setNotes(body.notes ?? "");
        setMsg({ ok: true, text: "Ported. Read it, check it, then save — nothing runs until you do." });
      }
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Port failed" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rpl-modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rpl-modal" role="dialog" aria-modal="true" aria-label="Bring a bot">
        <header>
          <h2>Bring a bot</h2>
          <button className="rpl-btn" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="rpl-modal-body">
          <nav className="rpl-botlist" aria-label="Your bots">
            <button className="rpl-botitem" aria-current={currentId === null} onClick={() => select(null)}>
              <span>
                New bot
                <small>from an .mq4 or by hand</small>
              </span>
            </button>
            {bots.map((b) => (
              <button key={b.id} className="rpl-botitem" aria-current={b.id === currentId} onClick={() => select(b.id)}>
                <span>
                  {b.name}
                  <small>{b.from === "hand" ? "written by hand" : `ported from ${b.from}`}</small>
                </span>
              </button>
            ))}
          </nav>

          <div className="rpl-editor">
            <div
              className="rpl-drop"
              data-over={over}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void readFile(f);
              }}
            >
              <div className="rpl-row" style={{ marginBottom: 6 }}>
                <strong style={{ color: "var(--rpl-ink)", fontWeight: 600 }}>Port an EA</strong>
                <span>Drop an .mq4 here, choose one, or paste the source below.</span>
                <label className="rpl-btn">
                  Choose .mq4…
                  <input type="file" accept=".mq4,.mqh,.txt,.ex4" hidden onChange={(e) => e.target.files?.[0] && void readFile(e.target.files[0])} />
                </label>
              </div>
              <textarea
                value={mq4}
                onChange={(e) => setMq4(e.target.value)}
                placeholder={"//+------------------------------------------------------------------+\n//| paste the .mq4 source here"}
                style={{ minHeight: 90 }}
                aria-label="MQL4 source"
              />
              <div className="rpl-row" style={{ marginTop: 6 }}>
                <button className="rpl-btn rpl-btn--primary" onClick={() => void port()} disabled={busy || !mq4.trim()}>
                  {busy ? "Porting…" : "Port with AI"}
                </button>
                {mq4Name && <span className="faint">{mq4Name}</span>}
              </div>
            </div>

            <div style={{ display: "grid", gap: 6, minHeight: 0 }}>
              <div className="rpl-row">
                <label className="rpl-field" style={{ flex: 1 }}>
                  <span>Name</span>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
                </label>
              </div>
              <textarea value={source} onChange={(e) => setSource(e.target.value)} spellCheck={false} aria-label="Bot source" />
              {notes && (
                <div className="rpl-notes">
                  <strong>What the port could not carry over</strong>
                  {"\n"}
                  {notes}
                </div>
              )}
            </div>

            {msg && <div className={msg.ok ? "rpl-notes" : "rpl-crash"}>{msg.text}</div>}
          </div>
        </div>
        <footer>
          {current && (
            <button className="rpl-btn" onClick={remove} style={{ marginRight: "auto" }}>
              Delete bot
            </button>
          )}
          <button className="rpl-btn" onClick={check}>
            Check
          </button>
          <button className="rpl-btn" onClick={() => save(false)}>
            Save
          </button>
          <button className="rpl-btn rpl-btn--primary" onClick={() => save(true)}>
            Save and replay it
          </button>
        </footer>
      </div>
    </div>
  );
}
