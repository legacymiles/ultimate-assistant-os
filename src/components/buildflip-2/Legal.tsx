export function LegalDoc({
  title,
  updated,
  intro,
  sections,
}: {
  title: string;
  updated: string;
  intro: string;
  sections: { heading: string; body: string[] }[];
}) {
  return (
    <article>
      <h1 className="text-[clamp(1.625rem,5vw,2.25rem)] font-semibold tracking-[-0.035em]">
        {title}
      </h1>
      <p className="num mt-2 text-[12px] text-[var(--ink-4)]">Last updated {updated}</p>
      <p className="mt-4 text-[14.5px] leading-relaxed text-[var(--ink-2)]">{intro}</p>

      <div className="mt-7 space-y-6">
        {sections.map((s) => (
          <section key={s.heading}>
            <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-[var(--ink)]">
              {s.heading}
            </h2>
            <div className="mt-2 space-y-2.5">
              {s.body.map((p, i) => (
                <p key={i} className="text-[13.5px] leading-relaxed text-[var(--ink-2)]">
                  {p}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-9 border-t border-[var(--line-soft)] pt-5 text-[12.5px] leading-relaxed text-[var(--ink-3)]">
        Questions about any of this? Email{" "}
        <a
          href="mailto:hello@buildflip.app"
          className="text-[var(--accent)] underline underline-offset-2"
        >
          hello@buildflip.app
        </a>{" "}
        and a person will answer.
      </p>
    </article>
  );
}
