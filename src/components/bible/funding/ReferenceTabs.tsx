"use client";

import { useMemo, useState } from "react";
import {
  CHEAT_SHEETS,
  COURSES,
  LEFT_OUT,
  LESSONS,
  MISTAKES,
  RESOURCES,
  SCRIPTS,
  SEQUENCES,
  TIPS,
  type CourseId,
  type Tip,
} from "@/lib/seed-content/financial-bible";

const hl = (focus: string | null, id: string) => (focus === id ? "true" : undefined);

export function CheatsTab({ focus }: { focus: string | null }) {
  return (
    <div className="fund-cheats">
      {CHEAT_SHEETS.map((c) => (
        <article key={c.id} className="bible-sheet fund-cheat" data-kb={c.id} data-hl={hl(focus, c.id)}>
          <div className="bible-sheet-body">
            <h2>{c.title}</h2>
            <p className="fund-use">{c.use}</p>
            <dl>
              {c.rows.map((r) => (
                <div key={r.k}>
                  <dt>{r.k}</dt>
                  <dd>{r.v}</dd>
                </div>
              ))}
            </dl>
            <p className="fund-src">From {c.src.join(", ")}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

const AREAS: { id: Tip["area"] | "all"; label: string }[] = [
  { id: "all", label: "All plays" },
  { id: "credit", label: "Credit secrets" },
  { id: "bank", label: "Banking plays" },
  { id: "biz", label: "Business hacks" },
  { id: "sales", label: "Getting clients" },
  { id: "ops", label: "Running the business" },
];

export function PlaysTab({ focus }: { focus: string | null }) {
  const [area, setArea] = useState<Tip["area"] | "all">("all");
  const tips = TIPS.filter((t) => area === "all" || t.area === area);
  return (
    <div className="fund-plays">
      <section>
        <h2 className="fund-h2">Sequences</h2>
        <div className="fund-seqs">
          {SEQUENCES.map((s) => (
            <article key={s.id} className="fund-seq" data-kb={s.id} data-hl={hl(focus, s.id)}>
              <h3>{s.title}</h3>
              <p className="fund-use">For: {s.fits}</p>
              <ol>
                {s.steps.map((x) => (
                  <li key={x.title}>
                    <b>{x.title}.</b> {x.detail}
                  </li>
                ))}
              </ol>
              <p className="fund-src">From {s.src.join(", ")}</p>
            </article>
          ))}
        </div>
      </section>
      <section>
        <h2 className="fund-h2">Plays</h2>
        <div className="bible-choice fund-areas" role="radiogroup" aria-label="Kind of play">
          {AREAS.map((a) => (
            <label key={a.id}>
              <input type="radio" name="area" checked={area === a.id} onChange={() => setArea(a.id)} />
              {a.label}
            </label>
          ))}
        </div>
        <ul className="fund-tips">
          {tips.map((t) => (
            <li key={t.id} data-kb={t.id} data-hl={hl(focus, t.id)}>
              <b>{t.title}</b>
              <p>{t.body}</p>
              <span className="fund-src">{t.src.join(", ")}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function MistakesTab({ focus }: { focus: string | null }) {
  return (
    <div>
      <div className="bible-table-wrap">
        <table className="bible-table fund-static">
          <thead>
            <tr>
              <th>Mistake</th>
              <th>What it costs</th>
              <th>Do this instead</th>
            </tr>
          </thead>
          <tbody>
            {MISTAKES.map((m) => (
              <tr key={m.id} data-kb={m.id} data-hl={hl(focus, m.id)}>
                <td className="bible-idea-title">{m.title}</td>
                <td>{m.cost}</td>
                <td>{m.fix}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="fund-h2">Left out on purpose</h2>
      <p className="fund-lede">
        The course also teaches these. They work by telling a lender something that isn&rsquo;t true, which is what gets
        accounts closed, approvals clawed back and brokers charged — so they&rsquo;re not in this playbook.
      </p>
      <ul className="fund-left">
        {LEFT_OUT.map((x) => (
          <li key={x.id} data-kb={x.id} data-hl={hl(focus, x.id)}>
            <b>{x.what}</b> {x.why} <span className="fund-src">{x.src.join(", ")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ScriptsTab({ focus }: { focus: string | null }) {
  return (
    <div className="fund-scripts">
      {SCRIPTS.map((s) => (
        <article key={s.id} className="bible-sheet fund-cheat" data-kb={s.id} data-hl={hl(focus, s.id)}>
          <div className="bible-sheet-body">
            <h2>{s.title}</h2>
            <p className="fund-use">{s.use}</p>
            <ol className="fund-script">
              {s.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ol>
          </div>
        </article>
      ))}
      <section className="fund-resources">
        <h2 className="fund-h2">Course documents</h2>
        <ul>
          {RESOURCES.map((r) => (
            <li key={r.id}>
              {r.url ? (
                <a href={r.url} target="_blank" rel="noreferrer">
                  {r.title}
                </a>
              ) : (
                <b>{r.title}</b>
              )}{" "}
              <span>{r.note}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function LessonsTab({ focus }: { focus: string | null }) {
  const [course, setCourse] = useState<CourseId | "all">("all");
  const [videoOnly, setVideoOnly] = useState(false);
  const rows = useMemo(
    () => LESSONS.filter((l) => (course === "all" || l.course === course) && (!videoOnly || !l.written)),
    [course, videoOnly],
  );
  const unwritten = LESSONS.filter((l) => !l.written).length;

  return (
    <div>
      <p className="fund-lede">
        Every lesson in the four courses. {unwritten} of {LESSONS.length} had no written notes — their content is only in
        the video, so those are the ones worth watching.
      </p>
      <div className="fund-filter-row">
        <div className="bible-choice" role="radiogroup" aria-label="Course">
          <label>
            <input type="radio" name="course" checked={course === "all"} onChange={() => setCourse("all")} />
            All courses
          </label>
          {(Object.keys(COURSES) as CourseId[]).map((c) => (
            <label key={c}>
              <input type="radio" name="course" checked={course === c} onChange={() => setCourse(c)} />
              {COURSES[c].title}
            </label>
          ))}
        </div>
        <label className="fund-check">
          <input type="checkbox" checked={videoOnly} onChange={(e) => setVideoOnly(e.target.checked)} /> Only video-only lessons
        </label>
      </div>
      <div className="bible-table-wrap">
        <table className="bible-table fund-static">
          <thead>
            <tr>
              <th>#</th>
              <th>Lesson</th>
              <th>Module</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => {
              const id = `${l.course}-${l.n}`;
              return (
                <tr key={id} data-kb={id} data-hl={hl(focus, id)}>
                  <td className="bible-num bible-muted">
                    {course === "all" ? `${l.course.toUpperCase()} ` : ""}
                    {l.n}
                  </td>
                  <td>
                    <div className="bible-idea-title">{l.title}</div>
                    {(l.links?.length || l.files?.length) && (
                      <div className="fund-lesson-links">
                        {l.links?.map((u) => (
                          <a key={u} href={u} target="_blank" rel="noreferrer">
                            {new URL(u).hostname.replace("www.", "")}
                          </a>
                        ))}
                        {l.files?.map((f) => (
                          <span key={f}>{f}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="bible-muted">{l.module}</td>
                  <td>{l.written ? "Captured" : <span className="fund-video">Watch</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
