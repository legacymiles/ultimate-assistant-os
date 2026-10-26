import { redirect } from "next/navigation";

// Game Creator is now the Create section of Game Studio. Only the index moved:
// each game's own page still lives at /apps/game-creator/<id>.
export default function Page() {
  redirect("/apps/game-studio?section=create");
}
