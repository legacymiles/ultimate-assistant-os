import type { MethodMeta } from "../../types";

export const meta: MethodMeta = {
  id: "h3",
  name: "H3",
  tagline: "Cinematic AI-generated footage, dramatic shots, realistic sequences",
  description:
    "MiniMax H3 generates finished footage from an optimised shot prompt. The only method here that " +
    "renders on the server rather than on your PC — it needs no local install, and it is the fastest " +
    "route to a photoreal shot nobody has to model.",
  strengths: [
    "Photoreal and stylised cinematic footage",
    "Camera movement and atmosphere",
    "Dramatic shots and visual storytelling",
    "Image references and first-frame continuation",
    "No local install — renders from a deployed host",
  ],
  workflowType: "hosted-model",
  transport: "server",
  skill: "h3-scroll-world",
  companionSkills: ["higgsfield-models", "smart-shot"],
  inputs: {
    referenceImages: true,
    firstFrame: true,
    audio: false,
    note: "H3 takes either reference images or a first frame, not both. A first frame chained from the previous scene's last frame is what makes consecutive shots continuous.",
  },
  output: { format: "mp4", resolution: "768P or 2K, ~6–15s per shot", perSceneRerender: true },
  hue: [340, 18],
  docsUrl: "https://www.minimax.io/",
};
