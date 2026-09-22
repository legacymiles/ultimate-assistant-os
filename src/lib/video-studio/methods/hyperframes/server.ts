import "server-only";
import type { Capability } from "../../types";
import { nodeInstalled, requirement, rollUp, skillInstalled } from "../../server/detect";
import { runnerInfo } from "../../server/store";
import type { MethodServer } from "../../server/types";

async function detect(uid: string): Promise<Capability> {
  const [node, skill, runner] = await Promise.all([nodeInstalled(), skillInstalled("hyperframes"), runnerInfo(uid)]);
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
        "Node.js 22+",
        "install",
        "node",
        node,
        "HyperFrames needs Node 22 or newer on the machine that runs the runner.",
      ),
      requirement(
        "skill",
        "HyperFrames skills",
        "install",
        "~/.claude/skills/hyperframes*",
        skill,
        "npx skills add heygen-com/hyperframes",
      ),
      requirement(
        "cloud",
        "HeyGen cloud rendering",
        "api-key",
        "HYPERFRAMES_API_KEY",
        Boolean((process.env.HYPERFRAMES_API_KEY ?? "").trim()),
        "Optional — only needed to render on HeyGen's cloud instead of locally.",
        true,
      ),
    ],
    "HyperFrames renders on your PC through the studio runner.",
  );
}

export const server: MethodServer = { id: "hyperframes", detect };
