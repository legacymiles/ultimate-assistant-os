// ---------------------------------------------------------------------------
// The Board — the starting shape, and nothing else.
//
// A new board arrives with sections and no records. That is deliberate: the
// board is the user's own list, and 95 tools someone else picked is a pile to
// prune before it is ever a library. The sections are worth shipping because
// they are just filing — an empty "AI › Video" costs nothing and gives the
// first record somewhere to land.
//
// Group colours are NOT stored here. `groupHue` in types.ts derives a hue from
// the group's name, so a section keeps its colour whether it came from this
// list or was typed in by hand five minutes ago.
//
// Adding a group or a category in the app writes it straight to the board's
// own tree, so nothing here has to be edited to make room for one.
// ---------------------------------------------------------------------------

/** Group → its categories, in the order they should read down the sidebar. */
export const SEED_TREE: Record<string, string[]> = {
  AI: ["LLM", "Image", "Video", "Music", "Voice", "Agent Coding", "3D", "Tools"],
  Dev: ["Editors", "Platforms", "Backend", "Infra", "Utilities"],
  Design: ["UI Design", "3D", "Vector", "Diagrams"],
  Productivity: ["Notes", "Launchers", "Sync"],
  Media: ["Video Editing", "Capture", "Audio Editing"],
  Security: ["Passwords", "Networking"],
  Trading: ["Terminals", "Charting", "Marketplaces"],
};
