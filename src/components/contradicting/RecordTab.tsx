"use client";

import { useMemo, useState } from "react";
import { isKeyPoint, search, stamp, type Line } from "@/lib/contradicting/engine";
import type { RecordView } from "./useRecord";
import type { Act } from "./Onboard";

/** Everything on the record: search it, name unknown voices, open any conversation. */
export function RecordTab({ view, act }: { view: RecordView; act: Act }) {
  const { doc } = view;
  const [q, setQ] = useState("");
  const [who, setWho] = useState<string>("");
  const [keyOnly, setKeyOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(doc.convos[0]?.id ?? null);

  const hits = useMemo(() => (q.trim() ? search(doc, q, who || null) : []), [doc, q, who]);
  const convos = useMemo(() => [...doc.convos].sort((a, b) => b.lastAt.localeCompare(a.lastAt)), [doc.convos]);

  const name = (id: string | null) => {
    const p = id ? doc.people.find((x) => x.id === id) : undefined;
    return p ? (p.isMe ? "You" : p.name) : "Who's this?";
  };
  const hue = (id: string | null) => doc.people.find((x) => x.id === id)?.hue ?? 0;
  const linesOf = (convoId: string) =>
    doc.lines
      .filter((l) => l.convoId === convoId)
      .filter((l) => (who ? l.personId === who : true))
      .filter((l) => (keyOnly ? isKeyPoint(l.text) : true))
      .sort((a, b) => a.at.localeCompare(b.at));

  return (
    <section className="cx-stack">
      {view.unnamed.length > 0 && (
        <div className="cx-unnamed">
          <p className="cx-kicker">Who&apos;s this? · voices waiting for a name (kept 2 days)</p>
          {view.unnamed.map((u) => (
            <div key={`${u.convoId}|${u.label}`} className="cx-unnamed-row">
              <q>{u.sample}</q>
              <span className="cx-muted small">{u.count} {u.count === 1 ? "line" : "lines"}</span>
              <div className="cx-chips">
                {doc.people.map((p) => (
                  <button
                    key={p.id}
                    style={{ ["--hue" as string]: p.hue }}
                    onClick={() => act({ action: "speaker.assign", convoId: u.convoId, label: u.label, personId: p.id })}
                  >
                    {p.isMe ? "Me" : p.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="cx-filters">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search everything said… “car payment”" aria-label="Search the record" />
        <div className="cx-chips">
          <button className={!who ? "on" : ""} onClick={() => setWho("")}>
            Everyone
          </button>
          {doc.people.map((p) => (
            <button key={p.id} className={who === p.id ? "on" : ""} style={{ ["--hue" as string]: p.hue }} onClick={() => setWho(p.id)}>
              {p.isMe ? "Me" : p.name}
            </button>
          ))}
          <button className={keyOnly ? "on" : ""} onClick={() => setKeyOnly((v) => !v)} title="Promises, always/never, name-calling">
            ★ Key points
          </button>
        </div>
      </div>

      {q.trim() ? (
        <ol className="cx-lines">
          {hits.length === 0 && <li className="cx-muted">Nobody said that on the record.</li>}
          {hits.map((l) => (
            <LineRow key={l.id} l={l} name={name(l.personId)} hue={hue(l.personId)} tz={doc.settings.tz} full />
          ))}
        </ol>
      ) : (
        <ol className="cx-convos">
          {convos.length === 0 && <li className="cx-muted">Nothing recorded yet. Connect the recorder in Setup, or type a line on Receipts.</li>}
          {convos.map((c) => {
            const ls = linesOf(c.id);
            const open = openId === c.id;
            return (
              <li key={c.id} className={open ? "open" : ""}>
                <button className="cx-convo-head" onClick={() => setOpenId(open ? null : c.id)} aria-expanded={open}>
                  <span className="cx-time">{stamp(c.startedAt, doc.settings.tz)}</span>
                  <b>{c.title || ls[0]?.text.slice(0, 60) || "Conversation"}</b>
                  <span className="cx-muted small">{ls.length} {ls.length === 1 ? "line" : "lines"}</span>
                </button>
                {open && (
                  <div className="cx-convo-body">
                    {c.overview && <p className="cx-overview">{c.overview}</p>}
                    {c.points && c.points.length > 0 && (
                      <ul className="cx-points">
                        {c.points.map((pt, i) => (
                          <li key={i}>{pt}</li>
                        ))}
                      </ul>
                    )}
                    <ol className="cx-lines">
                      {ls.map((l) => (
                        <LineRow key={l.id} l={l} name={name(l.personId)} hue={hue(l.personId)} tz={doc.settings.tz} />
                      ))}
                    </ol>
                    <button
                      className="cx-ghost danger"
                      onClick={() => {
                        if (confirm("Delete this whole conversation from the record?")) act({ action: "convo.delete", id: c.id });
                      }}
                    >
                      Delete conversation
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function LineRow({ l, name, hue, tz, full }: { l: Line; name: string; hue: number; tz: string; full?: boolean }) {
  const s = stamp(l.at, tz);
  return (
    <li className={`cx-line${isKeyPoint(l.text) ? " key" : ""}${l.personId ? "" : " unknown"}`} style={{ ["--hue" as string]: hue }}>
      <span className="cx-who">{name}</span>
      <span className="cx-time">{full ? s : s.split(" ").slice(0, 2).join(" ")}</span>
      <p>{l.text}</p>
    </li>
  );
}
