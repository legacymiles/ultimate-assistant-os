// ---------------------------------------------------------------------------
// queue CLI — the 24/7 Queue from a terminal on the PC or VPS, acting as the
// owner (JARVIS_MCP_USER_ID). Bundled with the worker to dist/cli.mjs.
//
//   node dist/cli.mjs list
//   node dist/cli.mjs command "Find the newest MT4 bots and evaluate them"
//   node dist/cli.mjs get <task id>
//   node dist/cli.mjs ensure-mt4      file the permanent MT4 discovery workflow once
// ---------------------------------------------------------------------------

import { queueDb, queueDbConfigured, NO_DB_MESSAGE } from "../server/db";
import { runCommand } from "../server/command";
import { createTask, getTask, listEvents, listTasks } from "../server/store";
import { executorFor } from "../executors/registry";

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!queueDbConfigured()) throw new Error(NO_DB_MESSAGE);
  const uid = process.env.JARVIS_MCP_USER_ID || process.env.QUEUE_OWNER_ID;
  if (!uid) throw new Error("Set JARVIS_MCP_USER_ID (the owner's account id).");
  const db = queueDb();
  switch (cmd) {
    case "list": {
      for (const t of await listTasks(db, uid, 100)) {
        console.log(`${t.id}  ${t.status.padEnd(16)} ${t.kind.padEnd(10)} ${String(t.progress).padStart(3)}%  ${t.executor.padEnd(14)} ${t.title}`);
      }
      return;
    }
    case "get": {
      const t = await getTask(db, uid, rest[0] ?? "");
      if (!t) throw new Error("No such task.");
      console.log(JSON.stringify(t, null, 2));
      for (const e of (await listEvents(db, t.id, 40)).reverse()) console.log(`${e.at} [${e.level}] ${e.message}`);
      return;
    }
    case "command": {
      const r = await runCommand(db, uid, rest.join(" "), { from: "cli" });
      console.log(r.reply);
      for (const t of r.created) console.log(`+ ${t.id} ${t.kind} ${t.executor} — ${t.title}`);
      for (const t of r.acted) console.log(`~ ${t.id} ${t.status} — ${t.title}`);
      return;
    }
    case "ensure-mt4": {
      const existing = (await listTasks(db, uid, 300)).find(
        (t) => t.executor === "mt4-discovery" && !["cancelled", "failed"].includes(t.status),
      );
      if (existing) {
        console.log(`Already running: ${existing.id} (${existing.status})`);
        return;
      }
      const ex = executorFor("mt4-discovery")!;
      const config = {
        telegramChannels: (process.env.MT4_TELEGRAM_CHANNELS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      };
      const t = await createTask(db, uid, {
        title: "MT4 Bot Discovery & Evaluation",
        description:
          "Continuously discovers newly published MT4/MT5 Expert Advisors from public Telegram channels, GitHub and the web; records source and developer; " +
          "collects source files (never runs them); statically analyses strategy, risk management, repainting and unsafe code; scores and ranks; " +
          "de-duplicates versions; keeps a searchable library; notifies on especially interesting bots. Never connects anything to a trading account.",
        instruction: "Create a permanent autonomous task connected to my Trading Studio that continuously discovers and evaluates new MT4 trading bots.",
        app: "trading-studio",
        executor: ex.id,
        agent: ex.agent,
        kind: "continuous",
        schedule: { everyMinutes: 360 },
        priority: 3,
        config,
        needs: ex.needs,
        created_by: "jarvis",
        steps: ex.initialSteps?.(config),
      });
      console.log(`Filed ${t.id} — ${t.title}`);
      return;
    }
    default:
      console.log("usage: cli.mjs list | get <id> | command <text> | ensure-mt4");
  }
}

void main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
