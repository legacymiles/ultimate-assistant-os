// ---------------------------------------------------------------------------
// Where a photo can be filed.
//
// The photo pipeline already routed to three places: photo folders (by who is
// in the shot), the knowledge base, and the calendar. Those were a hardcoded
// union, so adding a fourth destination meant editing the type, the prompt, the
// queue and the commit path in four separate places.
//
// A Destination collapses that into ONE file per place. Critically, the vision
// prompt is BUILT from this list rather than written alongside it — so adding a
// destination cannot leave the model unaware of it, which is the failure mode a
// hand-maintained prompt has every time.
//
// `commit` runs CLIENT-SIDE on approval, in the same browser and origin as the
// target app, so it writes through that app's own store module. It must never
// touch another app's storage key directly: the store owns invariants (the
// ai-rankings tree, for one) that a raw write would silently break.
// ---------------------------------------------------------------------------

/** One field the vision model is asked to extract for a destination. */
export interface FieldSpec {
  name: string;
  /** JSON type, as written into the prompt's response shape. */
  type: string;
  /** What it means. Goes into the prompt verbatim, so write it for the model. */
  describe: string;
}

/** What the review queue shows before anything is written. */
export interface DestinationPreview {
  title: string;
  /** Human-readable target, e.g. "AI Rankings › Dev › Open Source". */
  where: string;
  lines: string[];
  /**
   * Set when the model inferred a key identifier rather than reading it.
   *
   * A guessed repo name written silently is worse than a flagged one, because
   * the board then looks correct and is not.
   */
  unverified?: string;
}

export interface Destination<F = Record<string, unknown>> {
  id: string;
  label: string;
  /** Catalog slug of the app this writes into; used to link the queue to it. */
  appSlug: string;
  /** Told to the vision model as the meaning of this route. */
  hint: string;
  fields: FieldSpec[];
  /** Hand validation, mirroring agent.ts. Return null to drop the proposal. */
  parse(raw: unknown): F | null;
  preview(fields: F): DestinationPreview;
  /** Write it. Runs on approve, in the browser. */
  commit(fields: F): Promise<void> | void;
  /**
   * The places that already exist inside this app — cookbook names, board
   * sections. Sent to the agent so "my desert cookbook" resolves to the
   * existing "Desserts" before the preview, instead of a near-duplicate.
   * Optional: an app with nowhere to choose from simply omits it.
   */
  places?(): Promise<string[]>;
}
