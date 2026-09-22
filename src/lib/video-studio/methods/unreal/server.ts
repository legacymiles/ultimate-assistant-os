import "server-only";
import type { Capability } from "../../types";
import {
  mcpRegistered,
  processRunning,
  requirement,
  rollUp,
  skillInstalled,
  unrealInstalled,
} from "../../server/detect";
import { runnerInfo } from "../../server/store";
import type { MethodServer } from "../../server/types";

async function detect(uid: string): Promise<Capability> {
  const [engine, epicMcp, filmMcp, skill, runner, live] = await Promise.all([
    unrealInstalled(),
    mcpRegistered("unreal"),
    mcpRegistered("unrealmcp"),
    skillInstalled("unreal-cinematics"),
    runnerInfo(uid),
    processRunning("UnrealEditor.exe"),
  ]);
  return rollUp(
    [
      requirement(
        "runner",
        "Studio runner",
        "runner",
        "tools/video-studio-runner",
        runner.online,
        runner.hasToken
          ? "Start it on your PC: npm run runner in tools/video-studio-runner."
          : "Connect your PC from Integrations to get a runner token.",
      ),
      requirement(
        "engine",
        "Unreal Engine",
        "install",
        "C:\\Program Files\\Epic Games\\UE_5.x",
        engine,
        "Install Unreal Engine 5.7+ from the Epic Games Launcher.",
      ),
      requirement(
        "mcp-unreal",
        "Epic's Unreal MCP",
        "mcp",
        "unreal",
        epicMcp,
        "Registered in Claude Code — it handles projects, assets, PIE and packaging.",
      ),
      requirement(
        "mcp-cinematic",
        "Cinematic bridge (Sequencer + Movie Render Queue)",
        "mcp",
        "unrealmcp",
        filmMcp,
        "Set it up once — see the Setup section of the unreal-cinematics skill. Without it there is no render path.",
      ),
      requirement(
        "skill",
        "unreal-cinematics skill",
        "install",
        "~/.claude/skills/unreal-cinematics",
        skill,
        "Installed with the Video Studio Arena skills.",
      ),
      requirement(
        "live",
        "Unreal Editor running",
        "service",
        "UnrealEditor.exe",
        live,
        "Open your project in the editor. The bridge drives a live editor, so it has to be open — and that project needs Python Editor Script Plugin + Enable Remote Execution switched on.",
      ),
      requirement(
        "gpu",
        "A GPU that can render",
        "gpu",
        "local",
        true,
        "Movie Render Queue renders on the runner PC's GPU.",
        true,
      ),
    ],
    "Unreal renders on your PC through the studio runner.",
  );
}

export const server: MethodServer = { id: "unreal", detect };
