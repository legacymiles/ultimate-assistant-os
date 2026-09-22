import type { MethodMeta } from "../../types";

export const meta: MethodMeta = {
  id: "hyperframes",
  name: "HyperFrames",
  tagline: "AI-directed creative motion graphics and programmatic visual scenes",
  description:
    "HTML, CSS and seekable animation compiled to a deterministic MP4. Built for agents: one paused " +
    "timeline, a registry of ~400 ready blocks and effects, and a lint/preview/render loop that " +
    "catches a broken composition before it renders.",
  strengths: [
    "Creative motion graphics and cinematic graphic compositions",
    "Programmatic visual scenes from HTML/CSS",
    "Registry blocks: glitch, CRT, grain, charts, maps, confetti",
    "Transitions and kinetic typography",
    "Slideshows and interactive decks",
  ],
  workflowType: "code-render",
  transport: "agent",
  skill: "hyperframes",
  companionSkills: [
    "hyperframes-core",
    "hyperframes-animation",
    "hyperframes-registry",
    "hyperframes-cli",
    "media-use",
  ],
  inputs: {
    referenceImages: true,
    firstFrame: false,
    audio: true,
    note: "Images, video, audio and Figma frames all import. `media-use` can source or generate music, SFX and voiceover when you supply none.",
  },
  output: { format: "mp4", resolution: "Up to 4K, deterministic", perSceneRerender: true },
  hue: [286, 330],
  docsUrl: "https://hyperframes.heygen.com/introduction",
};
