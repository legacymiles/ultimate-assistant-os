import { SkillsLibrary } from "@/components/skills/SkillsLibrary";

export const metadata = {
  title: "Skills Library · Ultimate Assistant OS",
  description:
    "A private, searchable library of your skill prompts. Save any markdown skill with a title and quick overview, then find and copy the full prompt in one click.",
};

export default function Page() {
  return <SkillsLibrary />;
}
