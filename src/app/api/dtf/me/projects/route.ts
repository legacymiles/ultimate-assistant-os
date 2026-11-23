import { errorResponse, HttpError, requireUser } from "@/lib/dtf/server/access";
import { listProjects, putProject } from "@/lib/dtf/server/store";
import { cleanProject, InvalidProject } from "@/lib/dtf/server/validate";

export const dynamic = "force-dynamic";

/** The signed-in customer's saved designs, newest first. */
export async function GET() {
  try {
    const user = await requireUser();
    const projects = await listProjects(user.id);
    return Response.json({ projects });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Save (create or replace) one design. Images not uploaded yet are left out of the server copy. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const text = await req.text();
    if (text.length > 1_500_000) throw new HttpError(413, "That design is too large to save. Remove a layer or two.");
    let project;
    try {
      project = cleanProject(JSON.parse(text).project, false);
    } catch (e) {
      throw new HttpError(400, e instanceof InvalidProject ? e.message : "That design couldn't be read.");
    }
    const existing = await listProjects(user.id);
    if (!existing.some((p) => p.id === project.id) && existing.length >= 200) {
      throw new HttpError(409, "You have 200 saved designs — delete one to save another.");
    }
    const prev = existing.find((p) => p.id === project.id);
    if (prev) project.createdAt = prev.createdAt;
    await putProject(user.id, project);
    return Response.json({ project });
  } catch (e) {
    return errorResponse(e);
  }
}
