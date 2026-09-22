import type { MethodMeta } from "../../types";

export const meta: MethodMeta = {
  id: "remotion",
  name: "Remotion",
  tagline: "Motion graphics, diagrams, typography, charts, educational video",
  description:
    "Video written as React. Every frame is a deterministic function of time, so text, charts and " +
    "diagrams land exactly on the beat and re-render identically. The right engine when the video " +
    "has to explain something.",
  strengths: [
    "Typography and kinetic text",
    "Charts and data-driven animation",
    "Diagrams and explainer sequences",
    "Captions and transitions",
    "Reusable React components across videos",
  ],
  workflowType: "code-render",
  transport: "agent",
  skill: "remotion-best-practices",
  companionSkills: [
    "remotion-create",
    "remotion-markup",
    "remotion-captions",
    "remotion-studio",
    "remotion-render",
  ],
  inputs: {
    referenceImages: true,
    firstFrame: false,
    audio: true,
    note: "Images and audio are imported as project assets. Data (CSV/JSON) can be pasted into the brief notes and animated directly.",
  },
  output: { format: "mp4", resolution: "Up to 4K, any fps", perSceneRerender: true },
  hue: [212, 268],
  docsUrl: "https://www.remotion.dev/docs",
};
