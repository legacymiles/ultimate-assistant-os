"use client";

// ---------------------------------------------------------------------------
// EA World › Replay › Fingerprint the original.
//
// Black-box reverse engineering: a compiled EA cannot be read, but every trade
// it ever took can. Drop the statement or tester report the original wrote
// and this measures how it traded, then hands the numbers to HFT Secret v2 —
// each input with the measurement it came from, and "estimated" where the
// file could only hint at it.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { fingerprint, guessInstrument, parseMt4Report, suggestV2, type Fingerprint, type Suggestion } from "@/lib/ea-replay/statement";
import { instrumentById } from "@/lib/ea-replay/instruments";

const fmtHHMM = (x: number) => `${String(Math.floor(x / 100)).padStart(2, "0")}:${String(x % 100).padStart(2, "0")}`;

export function FingerprintPanel({
  onApply,
  onClose,
}: {
  onApply: (instrumentId: string | null, suggestions: Suggestion[]) => void;
  onClose: () => void;
}) {
  const [offset, setOffset] = useState(2);
  const [html, setHtml] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [fp, setFp] = useState<Fingerprint | null>(null);
  const [sugg, setSugg] = useState<Suggestion[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Re-measure whenever the file or the server offset changes — the offset moves every entry hour.
  useEffect(() => {
    if (!html) return;
    try {
      const rep = parseMt4Report(html, offset);
      if (!rep.trades.length) {
        setFp(null);
        setSugg([]);
        setErr("No closed buy/sell trades found. Use Account History › right-click › Save as Detailed Report, or the Strategy Tester's Report tab › Save as Report.");
        return;
      }
      const f = fingerprint(rep);
      const inst = instrumentById(guessInstrument(f.symbols) ?? "");
      setFp(f);
      setSugg(suggestV2(f, inst ? inst.point : 0.01));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That file could not be read");
    }
  }, [html, offset]);

  const read = async (f: File) => {
    const buf = new Uint8Array(await f.arrayBuffer());
    // MT4 writes reports as Windows-1252 or UTF-16; the numbers survive either way.
    let text = buf[0] === 0xff && buf[1] === 0xfe ? new TextDecoder("utf-16le").decode(buf) : new TextDecoder("windows-1252").decode(buf);
    if (!/<t[dr]/i.test(text)) text = new TextDecoder("utf-8").decode(buf);
    setFileName(f.name);
    setHtml(text);
  };

  const instId = fp ? guessInstrument(fp.symbols) : null;
  const maxHour = fp ? Math.max(1, ...fp.nyHours) : 1;

  return (
    <div className="rpl-modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rpl-modal" role="dialog" aria-modal="true" aria-label="Fingerprint the original EA">
        <header>
          <h2>Fingerprint the original</h2>
          <button className="rpl-btn" onClick={onClose}>
            Close
          </button>
        </header>
        <div style={{ overflow: "auto", padding: 14, display: "grid", gap: 12, alignContent: "start" }}>
          <p className="muted" style={{ margin: 0, maxWidth: "75ch" }}>
            A compiled .ex4 can&apos;t be read, but every trade it took can. Load a report the original EA wrote — an MT4 account statement
            (Account History › right-click › <b>Save as Detailed Report</b>) or a Strategy Tester report (Report tab › <b>Save as Report</b>).
            The tester report tells more: it logs every stop move and every pending order.
          </p>
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
              if (f) void read(f);
            }}
          >
            <div className="rpl-row">
              <label className="rpl-btn rpl-btn--primary">
                Choose report…
                <input type="file" accept=".htm,.html" hidden onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} />
              </label>
              <span>{fileName || "or drop the .htm here"}</span>
              <span style={{ marginLeft: "auto" }} className="rpl-row">
                <label htmlFor="fp-off">Broker server time = GMT +</label>
                <input id="fp-off" type="number" value={offset} style={{ width: 56 }} onChange={(e) => setOffset(Number(e.target.value))} />
                <span className="faint">(most brokers: 2 in winter, 3 in summer)</span>
              </span>
            </div>
          </div>

          {err && <div className="rpl-crash">{err}</div>}

          {fp && (
            <>
              <dl className="rpl-stats" style={{ borderRadius: 8, margin: 0 }}>
                {(
                  [
                    ["Source", fp.kind === "tester" ? "Strategy Tester report" : "Account statement", fp.symbols.join(", ") || "symbol not stated"],
                    ["Trades", String(fp.trades), `${fp.buys} buys · ${fp.sells} sells`],
                    ["Win rate", `${fp.winRate.toFixed(1)}%`, `net ${fp.net.toFixed(2)}`],
                    ["Hold time", `${fp.hold.median.toFixed(0)}s median`, `10% under ${fp.hold.p10.toFixed(0)}s · 10% over ${fp.hold.p90.toFixed(0)}s`],
                    ["Stop distance", fp.stopDist != null ? fp.stopDist.toFixed(2) : "—", "entry to first stop, price"],
                    ["Target", fp.targetDist != null ? fp.targetDist.toFixed(2) : "none", `${Math.round(fp.targetShare * 100)}% of trades had one`],
                    ["Median win / loss", `${(fp.medianWin || 0).toFixed(2)} / ${(fp.medianLoss || 0).toFixed(2)}`, "price moved, entry to exit"],
                    ["Trailed out in profit", String(fp.exits.trailedInProfit), `${fp.exits.sl} by stop · ${fp.exits.tp} by target · ${fp.exits.close} closed`],
                    ["Trail step", fp.trailStep != null ? fp.trailStep.toFixed(2) : "—", fp.kind === "tester" ? "median stop move" : "needs a tester report"],
                    [
                      "Stop orders",
                      fp.viaPendingShare != null ? `${Math.round(fp.viaPendingShare * 100)}% of entries` : "—",
                      fp.kind === "tester" ? `${fp.deletedPendings} deleted unfilled · ${fp.pendingModifies} dragged` : "needs a tester report",
                    ],
                    ["Busiest day", `${fp.maxTradesInADay} trades`, ""],
                    ["Window (NY)", fp.window ? `${fmtHHMM(fp.window.start)}–${fmtHHMM(fp.window.end)}` : "—", "5th–95th percentile of entries"],
                  ] as [string, string, string][]
                ).map(([k, v, sub]) => (
                  <div className="rpl-stat" key={k}>
                    <dt>{k}</dt>
                    <dd style={{ fontSize: 13 }}>{v}</dd>
                    {sub && <small>{sub}</small>}
                  </div>
                ))}
              </dl>

              <div>
                <div className="faint" style={{ fontSize: 10.5, marginBottom: 4 }}>
                  Entries by New York hour
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(24, 1fr)", gap: 2, alignItems: "end", height: 54 }} aria-label="Entries by New York hour">
                  {fp.nyHours.map((c, h) => (
                    <div key={h} title={`${h}:00 NY — ${c} trades`} style={{ height: `${Math.max(2, (c / maxHour) * 46)}px`, background: c ? "var(--rpl-head)" : "var(--rpl-line)", borderRadius: 2 }} />
                  ))}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(24, 1fr)", fontSize: 9.5 }} className="faint mono">
                  {fp.nyHours.map((_, h) => (
                    <span key={h} style={{ textAlign: "center" }}>
                      {h % 3 === 0 ? h : ""}
                    </span>
                  ))}
                </div>
              </div>

              <table className="rpl-table">
                <thead>
                  <tr>
                    <th>v2 input</th>
                    <th className="num">Value</th>
                    <th>From</th>
                    <th>How sure</th>
                  </tr>
                </thead>
                <tbody>
                  {sugg.map((s) => (
                    <tr key={s.key}>
                      <td className="mono">{s.key}</td>
                      <td className="num mono">{typeof s.value === "number" && s.key.endsWith("HHMM") ? fmtHHMM(s.value) : String(s.value)}</td>
                      <td className="muted" style={{ whiteSpace: "normal" }}>
                        {s.why}
                      </td>
                      <td className={s.confidence === "measured" ? "win" : "sell"}>{s.confidence}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="mono">EntryDistance</td>
                    <td className="num mono faint">unchanged</td>
                    <td className="muted" style={{ whiteSpace: "normal" }}>
                      How far from price the original parked its stop orders isn&apos;t in either report (they don&apos;t log the market price). Tune it in Replay
                      against the same day: the closer v2&apos;s fills land to the original&apos;s entry times, the closer you are.
                    </td>
                    <td className="faint">—</td>
                  </tr>
                </tbody>
              </table>
            </>
          )}
        </div>
        <footer>
          {instId && <span className="muted" style={{ marginRight: "auto" }}>Traded {instId} — Replay will switch to it.</span>}
          <button className="rpl-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="rpl-btn rpl-btn--primary" disabled={!sugg.length} onClick={() => onApply(instId, sugg)}>
            Apply to HFT Secret v2
          </button>
        </footer>
      </div>
    </div>
  );
}
