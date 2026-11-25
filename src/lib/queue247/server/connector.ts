import "server-only";

// ---------------------------------------------------------------------------
// The 24/7 Queue through the jarvis-memory connector (task_* tools), so a
// Claude Code session on the PC or VPS, or claude.ai, sees and steers the same
// tasks the owner sees on the board. Plain text out, like every connector tool.
// The tool definitions live with the others in src/lib/jarvis/mcpProtocol.ts.
// ---------------------------------------------------------------------------

import { queueDb, queueDbConfigured, NO_DB_MESSAGE } from "./db";
import { runCommand } from "./command";
import { getTask, listEvents, listFindings, listTasks } from "./store";
import { bucketOf, BUCKET_LABEL, BUCKET_ORDER, STATUS_LABEL } from "../engine";


export async function runTaskTool(uid: string, name: string, args: Record<string, unknown>, client: string): Promise<string> {
  if (!queueDbConfigured()) return NO_DB_MESSAGE;
  const db = queueDb();
  const now = new Date();
  switch (name) {
    case "task_list": {
      const tasks = await listTasks(db, uid, 200);
      const shown = args.all ? tasks : tasks.filter((t) => t.status !== "completed" && t.status !== "cancelled");
      if (!shown.length) return "The 24/7 Queue is empty.";
      const out: string[] = [];
      for (const b of BUCKET_ORDER) {
        const rows = shown.filter((t) => bucketOf(t, now) === b);
        if (!rows.length) continue;
        out.push(`${BUCKET_LABEL[b]} (${rows.length}):`);
        for (const t of rows.slice(0, 25)) {
          out.push(
            `- ${t.id} · ${t.title} · ${STATUS_LABEL[t.status]} · ${t.kind} · ${t.agent}${t.app ? ` · ${t.app}` : ""} · ${t.progress}%` +
              (t.current_step ? ` · ${t.current_step}` : "") +
              (t.question ? `\n  waiting on: ${t.question}` : "") +
              (t.next_run_at && t.status === "scheduled" ? `\n  next run ${t.next_run_at.slice(0, 16).replace("T", " ")} UTC` : "") +
              (t.last_error ? `\n  last error: ${t.last_error}` : ""),
          );
        }
      }
      return out.join("\n");
    }
    case "task_get": {
      const t = await getTask(db, uid, String(args.id ?? ""));
      if (!t) return "No such task.";
      const [events, findings] = await Promise.all([listEvents(db, t.id, 25), listFindings(db, uid, { taskId: t.id, limit: 10, order: "score" })]);
      return [
        `${t.title} — ${STATUS_LABEL[t.status]} (${t.kind}, ${t.agent}${t.app ? `, app ${t.app}` : ""}), ${t.progress}%`,
        `Instruction: ${t.instruction}`,
        `Config: ${JSON.stringify(t.config)}`,
        `Schedule: ${JSON.stringify(t.schedule)} · next ${t.next_run_at ?? "—"} · ✓${t.success_count} ✗${t.failure_count}`,
        t.steps.length ? `Steps:\n${t.steps.map((s) => `  [${s.state}] ${s.label}${s.note ? ` — ${s.note}` : ""}`).join("\n")}` : "",
        t.result_summary ? `Last result: ${t.result_summary}` : "",
        t.question ? `Waiting on the owner: ${t.question}` : "",
        `Recent log:\n${events.map((e) => `  ${e.at.slice(0, 16).replace("T", " ")} [${e.level}] ${e.message}`).join("\n")}`,
        findings.length ? `Top findings:\n${findings.map((f) => `  ${f.score ?? "-"} · ${f.title}${f.url ? ` — ${f.url}` : ""}`).join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "task_command": {
      const text = String(args.text ?? "").trim();
      if (!text) return "Say what the queue should do.";
      const r = await runCommand(db, uid, text, { taskId: typeof args.task_id === "string" ? args.task_id : null, from: client.slice(0, 40) || "connector" });
      const lines = [r.reply];
      for (const t of r.created) lines.push(`+ ${t.id} · ${t.title} (${t.kind}, ${t.executor})`);
      for (const t of r.acted) lines.push(`~ ${t.id} · ${t.title} → ${STATUS_LABEL[t.status]}`);
      return lines.join("\n");
    }
    default:
      return `Unknown tool ${name}.`;
  }
}
