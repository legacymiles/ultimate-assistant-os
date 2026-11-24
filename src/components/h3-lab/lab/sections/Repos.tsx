"use client";

// Repository Research — repos the owner or the agent looked at, what they
// offer, how well they fit this install, and what to do with them. Nothing is
// installed from here.

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Plus, Trash2 } from "lucide-react";
import type { RepoRow } from "@/lib/h3-lab/model";
import type { SectionProps } from "../sections";
import { Chip, Empty, Panel, SectionHead, when, type Tone } from "../ui";

const RECS: RepoRow["recommendation"][] = ["integrate", "adapt", "learn", "review", "skip"];
const INTEGRATIONS: RepoRow["integration"][] = ["in-use", "techniques-learned", "approval-needed", "not-integrated", "rejected"];

const compatTone = (c: RepoRow["compatibility"]): Tone => (c === "good" ? "good" : c === "partial" ? "warn" : c === "poor" ? "bad" : undefined);
const recTone = (r: RepoRow["recommendation"]): Tone => (r === "integrate" ? "good" : r === "adapt" ? "amber" : r === "learn" ? "cyan" : r === "skip" ? "bad" : "warn");
const intTone = (i: RepoRow["integration"]): Tone =>
  i === "in-use" ? "good" : i === "techniques-learned" ? "cyan" : i === "approval-needed" ? "amber" : i === "rejected" ? "bad" : undefined;

const BLANK = { name: "", url: "", description: "", license: "", recommendation: "review" as RepoRow["recommendation"] };

export default function Repos({ lab }: SectionProps) {
  const s = lab.state;
  const [rec, setRec] = useState<"all" | RepoRow["recommendation"]>("all");
  const [integ, setInteg] = useState<"all" | RepoRow["integration"]>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(BLANK);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const rows = [...s.repos]
    .filter((r) => (rec === "all" || r.recommendation === rec) && (integ === "all" || r.integration === integ))
    .sort((a, b) => (b.reviewedAt ?? "").localeCompare(a.reviewedAt ?? "") || a.name.localeCompare(b.name));
  const needsOk = s.repos.filter((r) => r.integration === "approval-needed").length;

  const urlOk = /^https?:\/\/\S+$/.test(draft.url.trim());

  async function add() {
    const res = await lab.act(
      {
        action: "repo.save",
        repo: {
          name: draft.name.trim(),
          url: draft.url.trim(),
          description: draft.description.trim(),
          license: draft.license.trim(),
          recommendation: draft.recommendation,
          discoveredBy: "owner",
        },
      },
      "Add repository",
    );
    if (res) {
      setDraft(BLANK);
      setAdding(false);
    }
  }

  const update = (r: RepoRow, patch: Partial<RepoRow>) =>
    void lab.act({ action: "repo.save", repo: { id: r.id, name: r.name, url: r.url, ...patch } }, `Update ${r.name}`);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <SectionHead
        eyebrow="Repository Research"
        title="Repositories, and what they are worth here"
        lede="Open-source projects around MiniMax H3, WanGP and video evaluation — what each offers, how it fits this install, and what to do with it."
        actions={
          <button type="button" className="btn sm primary" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
            <Plus size={13} /> Add repository
          </button>
        }
      />

      <div className="notice">
        Nothing here is installed automatically. Rows marked <Chip tone="amber">approval-needed</Chip> need your OK before anything is installed.
        {needsOk ? <> <b>{needsOk}</b> waiting.</> : null}
      </div>

      {adding ? (
        <Panel title="Add repository">
          <form
            className="grid"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.name.trim() && urlOk) void add();
            }}
          >
            <label className="field">
              <span>Name</span>
              <input className="in" required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="owner/repo" />
            </label>
            <label className="field">
              <span>URL</span>
              <input className="in" required type="url" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://github.com/owner/repo" />
            </label>
            <label className="field">
              <span>License</span>
              <input className="in" value={draft.license} onChange={(e) => setDraft({ ...draft, license: e.target.value })} placeholder="MIT, Apache-2.0, GPL-3.0…" />
            </label>
            <label className="field">
              <span>Recommendation</span>
              <select className="in" value={draft.recommendation} onChange={(e) => setDraft({ ...draft, recommendation: e.target.value as RepoRow["recommendation"] })}>
                {RECS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>Description</span>
              <textarea className="in" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="What it does and why it matters for H3 prompting" />
            </label>
            <div className="row" style={{ gridColumn: "1 / -1" }}>
              <button type="submit" className="btn primary sm" disabled={!draft.name.trim() || !urlOk || !!lab.busy}>Save repository</button>
              <button type="button" className="btn ghost sm" onClick={() => { setAdding(false); setDraft(BLANK); }}>Cancel</button>
              {draft.url && !urlOk ? <span className="muted" style={{ fontSize: 12 }}>The URL must start with http:// or https://</span> : null}
            </div>
          </form>
        </Panel>
      ) : null}

      <Panel
        title="Repositories"
        meta={`${rows.length} of ${s.repos.length}`}
        actions={
          <span className="row" style={{ gap: 6 }}>
            <select className="in" style={{ width: "auto", minHeight: 26, padding: "2px 6px" }} aria-label="Filter by recommendation" value={rec} onChange={(e) => setRec(e.target.value as typeof rec)}>
              <option value="all">All recommendations</option>
              {RECS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <select className="in" style={{ width: "auto", minHeight: 26, padding: "2px 6px" }} aria-label="Filter by integration" value={integ} onChange={(e) => setInteg(e.target.value as typeof integ)}>
              <option value="all">All integration states</option>
              {INTEGRATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </span>
        }
        bodyClass="tbl-wrap"
      >
        {!s.repos.length ? (
          <div className="panel-body">
            <Empty title="No repositories recorded yet">
              Add one above, or let the agent&apos;s daily research pass find them — agent finds are marked so you can tell them apart.
            </Empty>
          </div>
        ) : !rows.length ? (
          <p className="muted panel-body" style={{ margin: 0 }}>No repository matches these filters.</p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th aria-label="Expand" />
                <th>Name</th>
                <th>Description</th>
                <th>Capabilities</th>
                <th>License</th>
                <th>Fit</th>
                <th>Integration</th>
                <th>Recommend</th>
                <th>Reviewed</th>
                <th>Found by</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOpen = open === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr className="clickable" aria-selected={isOpen} onClick={() => setOpen(isOpen ? null : r.id)}>
                      <td>
                        <button type="button" className="btn ghost sm" aria-expanded={isOpen} aria-label={`${isOpen ? "Collapse" : "Expand"} ${r.name}`} onClick={(e) => { e.stopPropagation(); setOpen(isOpen ? null : r.id); }}>
                          {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        </button>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <a href={r.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "var(--ink)", textDecoration: "none", borderBottom: "1px solid var(--line-2)" }}>
                          {r.name}
                        </a>{" "}
                        <ExternalLink size={11} className="muted" aria-hidden />
                      </td>
                      <td className="dim" style={{ minWidth: 220, maxWidth: 360 }}>
                        <span style={{ display: "-webkit-box", WebkitLineClamp: isOpen ? undefined : 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{r.description}</span>
                      </td>
                      <td>
                        <span className="row" style={{ gap: 4, minWidth: 160 }}>
                          {r.capabilities.slice(0, isOpen ? undefined : 3).map((c) => <Chip key={c}>{c}</Chip>)}
                          {!isOpen && r.capabilities.length > 3 ? <span className="muted mono" style={{ fontSize: 11 }}>+{r.capabilities.length - 3}</span> : null}
                        </span>
                      </td>
                      <td className="mono" style={{ whiteSpace: "nowrap", fontSize: 11.5 }}>{r.license || "—"}</td>
                      <td><Chip tone={compatTone(r.compatibility)}>{r.compatibility}</Chip></td>
                      <td><Chip tone={intTone(r.integration)}>{r.integration}</Chip></td>
                      <td><Chip tone={recTone(r.recommendation)}>{r.recommendation}</Chip></td>
                      <td className="mono muted" style={{ whiteSpace: "nowrap" }}>{r.reviewedAt ? r.reviewedAt.slice(0, 10) : "—"}</td>
                      <td>{r.discoveredBy === "agent" ? <Chip tone="cyan">found by agent</Chip> : <span className="muted">{r.discoveredBy}</span>}</td>
                    </tr>
                    {isOpen ? (
                      <tr>
                        <td />
                        <td colSpan={9} style={{ background: "var(--panel-2)" }}>
                          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, padding: "4px 0 6px" }}>
                            <div>
                              <span className="eyebrow">Notes</span>
                              <p className="dim" style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{r.notes || <span className="muted">No notes.</span>}</p>
                            </div>
                            <div>
                              <span className="eyebrow">Reusable</span>
                              {r.reusable.length ? (
                                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }} className="dim">
                                  {r.reusable.map((x) => <li key={x}>{x}</li>)}
                                </ul>
                              ) : (
                                <p className="muted" style={{ margin: "4px 0 0" }}>Nothing listed.</p>
                              )}
                            </div>
                            <div>
                              <span className="eyebrow">Compatibility</span>
                              <p className="dim" style={{ margin: "4px 0 0" }}>{r.compatibilityNote || <span className="muted">No note.</span>}</p>
                            </div>
                          </div>
                          <div className="row" style={{ marginTop: 10, gap: 8 }}>
                            <label className="row" style={{ gap: 6 }}>
                              <span className="eyebrow">Integration</span>
                              <select className="in" style={{ width: "auto", minHeight: 26, padding: "2px 6px" }} value={r.integration} onChange={(e) => update(r, { integration: e.target.value as RepoRow["integration"] })}>
                                {INTEGRATIONS.map((x) => <option key={x} value={x}>{x}</option>)}
                              </select>
                            </label>
                            <label className="row" style={{ gap: 6 }}>
                              <span className="eyebrow">Recommend</span>
                              <select className="in" style={{ width: "auto", minHeight: 26, padding: "2px 6px" }} value={r.recommendation} onChange={(e) => update(r, { recommendation: e.target.value as RepoRow["recommendation"] })}>
                                {RECS.map((x) => <option key={x} value={x}>{x}</option>)}
                              </select>
                            </label>
                            <span className="muted mono" style={{ fontSize: 11 }}>{r.reviewedAt ? `reviewed ${when(r.reviewedAt)}` : "not reviewed"}</span>
                            <span style={{ flex: 1 }} />
                            {confirmDelete === r.id ? (
                              <span className="row" style={{ gap: 6 }}>
                                <span className="dim">Remove {r.name} from this list?</span>
                                <button type="button" className="btn danger sm" disabled={!!lab.busy} onClick={() => { void lab.act({ action: "repo.delete", id: r.id }, `Remove ${r.name}`); setConfirmDelete(null); setOpen(null); }}>
                                  Remove
                                </button>
                                <button type="button" className="btn ghost sm" onClick={() => setConfirmDelete(null)}>Keep</button>
                              </span>
                            ) : (
                              <button type="button" className="btn danger sm" onClick={() => setConfirmDelete(r.id)}>
                                <Trash2 size={12} /> Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
