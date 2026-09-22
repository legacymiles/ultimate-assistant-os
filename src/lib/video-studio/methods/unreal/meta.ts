import type { MethodMeta } from "../../types";

export const meta: MethodMeta = {
  id: "unreal",
  name: "Unreal Engine",
  tagline: "3D cinematic animation, characters, environments, camera work, VFX",
  description:
    "A real-time engine driven through Sequencer and Movie Render Queue. The route when the same " +
    "character and set have to look identical in shot 1 and shot 9 — authored content, deterministic " +
    "re-renders, no generative drift.",
  strengths: [
    "3D scenes, environments and characters",
    "Cinematic cameras, lenses and depth of field",
    "Sequencer shot authoring with sub-sequences",
    "Lighting (Lumen) and Niagara VFX",
    "Movie Render Queue — deterministic, re-renderable",
  ],
  workflowType: "engine-render",
  transport: "agent",
  skill: "unreal-cinematics",
  companionSkills: ["unreal-game-builder"],
  inputs: {
    referenceImages: true,
    firstFrame: false,
    audio: true,
    note: "References guide set dressing and look. Assets come from Fab/Quixel/Poly Haven via the engine, not from the upload.",
  },
  output: { format: "mp4", resolution: "Up to 4K, any fps", perSceneRerender: true },
  hue: [196, 232],
  docsUrl: "https://dev.epicgames.com/documentation/en-us/unreal-engine/cinematics-and-movie-making-in-unreal-engine",
};
