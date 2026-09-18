import { homedir } from "node:os";
import path from "node:path";

// Every path is resolved when asked for, not at import, so tests (and a user
// with a second engine install) can redirect them through the environment.

export function engineDir() {
  return process.env.UE_ENGINE_DIR || "C:\\Program Files\\Epic Games\\UE_5.8";
}

export function editorExe() {
  return path.join(engineDir(), "Engine", "Binaries", "Win64", "UnrealEditor.exe");
}

/** Console build of the editor, for commandlets (no window, output on stdout). */
export function editorCmdExe() {
  return path.join(engineDir(), "Engine", "Binaries", "Win64", "UnrealEditor-Cmd.exe");
}

export function runUat() {
  return path.join(engineDir(), "Engine", "Build", "BatchFiles", "RunUAT.bat");
}

export function templatesDir() {
  return path.join(engineDir(), "Templates");
}

/** Where every Game Creator project lives. */
export function projectsRoot() {
  return process.env.GC_PROJECTS_ROOT || path.join(homedir(), "Documents", "Unreal Projects");
}

/** Bridge + builder state: the game registry and the running-editor record. */
export function stateDir() {
  return path.join(projectsRoot(), ".game-creator");
}

export const DEFAULT_PORT = 8000;
