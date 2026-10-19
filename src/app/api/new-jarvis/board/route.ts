import { NextResponse } from "next/server";
import { callerIsMember } from "@/lib/recall/lists/session";

// ---------------------------------------------------------------------------
// Send to board — file a card for super-board.
//
// Creates a GitHub issue in Felix / super-board ticket format and, when a
// Project is configured, adds it to the board in BACKLOG. Nothing builds until
// the owner drags it to Ready, and every merge waits for the owner
// (human_approves_merge: true in .claude/super-board/configs).
//
// Env (Vercel):
//   JARVIS_GITHUB_TOKEN    fine-grained token: Issues read/write on the repo,
//                          Projects read/write on the account
//   JARVIS_BOARD_REPO      owner/repo, default legacymiles/ultimate-assistant-os
//   JARVIS_BOARD_PROJECT   the Project number (scripts/super-board-setup.ps1 prints it)
// Missing token: a plain-English notice, never a 500.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";

const GH = "https://api.github.com";

function config() {
  const token = process.env.JARVIS_GITHUB_TOKEN || "";
  const repo = process.env.JARVIS_BOARD_REPO || "legacymiles/ultimate-assistant-os";
  const project = Number(process.env.JARVIS_BOARD_PROJECT || 0) || 0;
  return { token, repo, project };
}

const headers = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
  "User-Agent": "jarvis-board",
});

async function gql<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${GH}/graphql`, { method: "POST", headers: headers(token), body: JSON.stringify({ query, variables }) });
  const data = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (!res.ok || data.errors?.length) throw new Error(data.errors?.[0]?.message || `GitHub said ${res.status}`);
  return data.data as T;
}

interface ProjectInfo {
  id: string;
  status?: { id: string; backlog?: string };
}

/** The Project's id, its Status field, and that field's Backlog option. */
async function projectInfo(token: string, owner: string, number: number): Promise<ProjectInfo | null> {
  const q = `query($owner:String!,$n:Int!){
    user(login:$owner){ projectV2(number:$n){ id field(name:"Status"){ ... on ProjectV2SingleSelectField { id options { id name } } } } }
  }`;
  const d = await gql<{ user?: { projectV2?: { id: string; field?: { id: string; options: { id: string; name: string }[] } } } }>(token, q, { owner, n: number });
  const p = d.user?.projectV2;
  if (!p) return null;
  const backlog = p.field?.options.find((o) => o.name.toLowerCase() === "backlog")?.id;
  return { id: p.id, status: p.field ? { id: p.field.id, backlog } : undefined };
}

export async function GET() {
  const { token, repo, project } = config();
  return NextResponse.json({ configured: Boolean(token), repo, project });
}

export async function POST(req: Request) {
  if (await callerIsMember()) {
    return NextResponse.json({ error: "This part of Jarvis is not shared." }, { status: 403 });
  }
  const { token, repo, project } = config();
  if (!token) {
    return NextResponse.json(
      {
        error:
          "The board isn't connected yet. Run scripts\\super-board-setup.ps1 on your PC once — it makes the board and prints the two values to add in Vercel (JARVIS_GITHUB_TOKEN and JARVIS_BOARD_PROJECT).",
      },
      { status: 503 },
    );
  }

  let title = "";
  let body = "";
  let labels: string[] = [];
  try {
    const b = (await req.json()) as { title?: unknown; body?: unknown; labels?: unknown };
    title = typeof b.title === "string" ? b.title.trim().slice(0, 120) : "";
    body = typeof b.body === "string" ? b.body.slice(0, 60_000) : "";
    labels = Array.isArray(b.labels) ? b.labels.filter((l): l is string => typeof l === "string").map((l) => l.slice(0, 40)).slice(0, 8) : [];
  } catch {
    return NextResponse.json({ error: "That request didn't come through properly. Try again." }, { status: 400 });
  }
  if (!title || !body) return NextResponse.json({ error: "A card needs a title and a description." }, { status: 400 });

  try {
    const res = await fetch(`${GH}/repos/${repo}/issues`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ title, body: `${body}\n\n---\n_Filed from Jarvis (Felix brief). Lands in Backlog — move it to Ready to build._`, labels }),
    });
    const issue = (await res.json()) as { number?: number; html_url?: string; node_id?: string; message?: string };
    if (!res.ok || !issue.number) {
      const why = res.status === 401 || res.status === 403 ? "GitHub didn't accept the token — make a new one with Issues read/write on the repo." : issue.message || `GitHub said ${res.status}.`;
      return NextResponse.json({ error: `Couldn't file the card. ${why}` }, { status: 502 });
    }

    let onBoard = false;
    let notice: string | undefined;
    if (project && issue.node_id) {
      try {
        const info = await projectInfo(token, repo.split("/")[0], project);
        if (!info) throw new Error(`no Project number ${project}`);
        const added = await gql<{ addProjectV2ItemById: { item: { id: string } } }>(
          token,
          `mutation($p:ID!,$c:ID!){ addProjectV2ItemById(input:{projectId:$p,contentId:$c}){ item { id } } }`,
          { p: info.id, c: issue.node_id },
        );
        if (info.status?.backlog) {
          await gql(
            token,
            `mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){ updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){ projectV2Item { id } } }`,
            { p: info.id, i: added.addProjectV2ItemById.item.id, f: info.status.id, o: info.status.backlog },
          );
        }
        onBoard = true;
      } catch (err) {
        console.error("[board] add to project failed:", err);
        notice = "The issue was filed, but it couldn't be put on the board — check the token has Projects read/write.";
      }
    } else if (!project) {
      notice = "Filed as an issue. Add JARVIS_BOARD_PROJECT in Vercel to drop new cards straight onto the board.";
    }
    return NextResponse.json({ number: issue.number, url: issue.html_url, onBoard, notice });
  } catch (err) {
    console.error("[board] failed:", err);
    return NextResponse.json({ error: "Couldn't reach GitHub just now. Try again in a minute." }, { status: 502 });
  }
}
