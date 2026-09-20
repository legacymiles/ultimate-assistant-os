import type { MethodMeta } from "../../types";

export const meta: MethodMeta = {
  id: "blender",
  name: "Blender",
  tagline: "Custom 3D animation, modeling, procedural scenes, simulations, assets",
  description:
    "Full authoring control over geometry, materials, physics and every rendered frame. The route " +
    "when the shot needs an asset that does not exist yet, a simulation, or a look a real-time " +
    "renderer will not give you.",
  strengths: [
    "Modeling and procedural generation",
    "Materials, lighting and Cycles rendering",
    "Character animation and Mixamo retargeting",
    "Physics simulations",
    "Product turntables and camera moves",
  ],
  workflowType: "3d-render",
  transport: "agent",
  skill: "blender-studio",
  companionSkills: [
    "blender-turntable",
    "blender-slow-zoom",
    "blender-crane-shot",
    "blender-polyhaven-studio-setup",
    "blender-product-polish",
    "blender-image-to-3d",
    "blender-toolkit",
  ],
  inputs: {
    referenceImages: true,
    firstFrame: false,
    audio: true,
    note: "A product photo can become the 3D model itself (Meshy, via blender-image-to-3d). Existing .blend/.glb files can be imported instead.",
  },
  output: { format: "mp4", resolution: "1920×1080 @ 24fps default, any resolution", perSceneRerender: true },
  hue: [26, 46],
  docsUrl: "https://docs.blender.org/manual/en/latest/",
};
