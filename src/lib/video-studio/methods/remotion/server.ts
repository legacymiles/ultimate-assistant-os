import "server-only";
import type { Capability } from "../../types";
import { nodeInstalled, requirement, rollUp, skillInstalled } from "../../server/detect";
import { runnerInfo } from "../../server/store";
import type { MethodServer } from "../../server/types";

async function detect(uid: string): Promise<Capability> {
  const [node, skill, runner] = await Promise.all([nodeInstalled(), skillInstalled("remotion-best-practices"), runnerInfo(uid)]);
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
        "node",
        "Node.js",
        "install",
        "node",
        node,
        "Install Node 18+ on the machine that runs the runner.",
      ),
      requirement(
        "skill",
        "Remotion skills",
        "install",
        "~/.claude/skills/remotion-*",
        skill,
        "npx skills add remotion-dev/skills",
      ),
      requirement(
        "chromium",
        "Chrome Headless Shell",
        "install",
        "downloaded on first render",
        true,
        "Remotion downloads it automatically the first time it renders.",
        true,
      ),
    ],
    "Remotion renders on your PC through the studio runner.",
  );
}

export const server: MethodServer = { id: "remotion", detect };
