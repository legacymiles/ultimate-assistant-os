// The Financial Bible's funding knowledge base — one import for any UI.
// Notes this was built from (lesson by lesson) live in ./notes/*.md.
export * from "./types";
export { LENDERS, lenderById } from "./lenders";
export { CHEAT_SHEETS, TIPS, MISTAKES, SEQUENCES, SCRIPTS, LEFT_OUT, RESOURCES } from "./playbook";
export { LESSONS } from "./lessons";

export const COURSES = {
  "6ff": { title: "6FF Mastery (Start Here)", lessons: 124 },
  secrets: { title: "Funding Secrets Bundle", lessons: 35 },
  corp: { title: "Corporate Credit Secrets", lessons: 19 },
  webinar: { title: "Webinar Mastery", lessons: 48 },
} as const;

/** When the course was read. Bank rules drift; the UI shows this date. */
export const READ_ON = "2026-10-15";
