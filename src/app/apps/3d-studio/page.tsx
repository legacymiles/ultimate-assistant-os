import { Studio3D } from "@/components/studio3d/Studio3D";

export const metadata = {
  title: "3D Studio Video Creator · Ultimate Assistant OS",
  description:
    "An AI animation director: describe a video and it writes the story, storyboards every shot, routes motion to Mixamo, Cascadeur and Blender, previews an animatic, and renders the film in Blender on your PC.",
};

export default function Page() {
  return <Studio3D />;
}
