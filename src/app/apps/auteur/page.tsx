import { AuteurStudio } from "@/components/auteur/AuteurStudio";

export const metadata = {
  title: "Auteur · Ultimate Assistant OS",
  description:
    "An AI film studio for MiniMax H3. Describe the film, pick a template and a genre, add references, and the AI Director plans the story, casts it, boards the shots and writes every H3 prompt.",
};

export default function Page() {
  return <AuteurStudio />;
}
