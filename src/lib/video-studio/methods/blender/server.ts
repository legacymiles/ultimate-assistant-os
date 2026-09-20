import "server-only";
import type { Capability } from "../../types";
import {
  blenderInstalled,
  ffmpegAvailable,
  hasEnv,
  mcpRegistered,
  portListening,
  requirement,
  rollUp,
  skillInstalled,
} from "../../server/detect";
import { runnerInfo } from "../../server/store";
import type { MethodServer } from "../../server/types";

/** The port the MCP addon's socket listens on inside a running Blender. */
const ADDON_PORT = Number(process.env.BLENDER_MCP_PORT || 9876);

async function detect(uid: string): Promise<Capability> {
  const [app, mcp, skill, runner, ffmpeg, live] = await Promise.all([
    blenderInstalled(),
    mcpRegistered("blender"),
    skillInstalled("blender-studio"),
    runnerInfo(uid),
    ffmpegAvailable(),
    portListening(ADDON_PORT),
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
        "app",
        "Blender",
        "install",
        "blender (PATH or BLENDER_PATH)",
        app,
        "Install Blender 4.0+ from blender.org, or set BLENDER_PATH to the executable.",
      ),
      requirement(
        "mcp",
        "Blender MCP addon",
        "mcp",
        "blender",
        mcp,
        "Registered in Claude Code. Install the addon with: uvx blender-mcp install-addon",
      ),
      requirement(
        "live",
        "Blender running",
        "service",
        `127.0.0.1:${ADDON_PORT}`,
        live,
        "Open Blender — the addon starts its server by itself. The render happens inside a live Blender, so it has to be open.",
      ),
      requirement(
        "skill",
        "blender-studio skills",
        "install",
        "~/.claude/skills/blender-*",
        skill,
        "Installed with the Video Studio Arena skills.",
      ),
      requirement(
        "meshy",
        "Meshy API (photo → 3D model)",
        "api-key",
        "MESHY_API_KEY",
        hasEnv("MESHY_API_KEY"),
        "Optional — only needed to turn a photo into a 3D model.",
        true,
      ),
      requirement(
        "ffmpeg",
        "ffmpeg",
        "install",
        "ffmpeg",
        ffmpeg,
        "Transcodes the ProRes render to MP4. Without it, Blender must be told to write MP4 directly.",
        true,
      ),
    ],
    "Blender renders on your PC through the studio runner.",
  );
}

export const server: MethodServer = { id: "blender", detect };
