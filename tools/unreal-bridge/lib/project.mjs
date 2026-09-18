import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { projectsRoot, templatesDir } from "./paths.mjs";
import { templateFor } from "./templates.mjs";
import { upsert } from "./registry.mjs";

// Plugins every Game Creator project needs on top of what its template enables.
// ModelContextProtocol is Epic's MCP server; AllToolsets pulls in every editor
// toolset it serves (Blueprints, actors, materials, UMG, Niagara, ...), and the
// rest are what those Python toolsets import.
export const REQUIRED_PLUGINS = [
  "PythonScriptPlugin",
  "EditorScriptingUtilities",
  "ToolsetRegistry",
  "ModelContextProtocol",
  "AllToolsets",
];

/**
 * "My cool game!" -> "MyCoolGame". Unreal project names must be a valid C++
 * identifier-ish token, and long names make packaged paths hit MAX_PATH.
 */
export function safeProjectName(name) {
  const words = String(name ?? "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let out = words.map((w) => w[0].toUpperCase() + w.slice(1)).join("");
  if (!out) out = "Game";
  if (/^[0-9]/.test(out)) out = `G${out}`;
  return out.slice(0, 20);
}

export function buildUproject({ description = "", templatePlugins = [] } = {}) {
  const plugins = [];
  const seen = new Set();
  for (const p of templatePlugins) {
    if (!p?.Name || seen.has(p.Name)) continue;
    seen.add(p.Name);
    plugins.push(p);
  }
  // Editor-only on purpose. ModelContextProtocol has a Runtime module, so
  // enabling it for every target makes Unreal treat a Blueprint project as one
  // that needs a compiled game build, and packaging then fails asking for the
  // .NET Framework SDK and a C++ toolchain. The shipped game never needs any of
  // these plugins; the template's own ModelingToolsEditorMode uses the same
  // TargetAllowList for the same reason.
  for (const name of REQUIRED_PLUGINS) {
    let entry = plugins.find((p) => p.Name === name);
    if (!entry) {
      entry = { Name: name };
      plugins.push(entry);
      seen.add(name);
    }
    entry.Enabled = true;
    entry.TargetAllowList = ["Editor"];
  }
  return {
    FileVersion: 3,
    EngineAssociation: "5.8",
    Category: "",
    Description: description,
    Plugins: plugins,
  };
}

/**
 * The shared content packs a template depends on, from its TemplateDefs.ini.
 *
 * Engine templates keep their character, input actions and level-prototyping
 * meshes in Templates/TemplateResources and list them as SharedContentPacks.
 * The new-project wizard copies them in; a plain folder copy does not, and the
 * template's own Blueprints then fail to compile (missing skeleton, null input
 * actions) — which makes Play-In-Editor stop on a modal dialog.
 *
 * Only top-level lines count. Packs named inside `Variants=(...)` belong to
 * optional variants and are skipped.
 */
export function parseSharedContentPacks(ini) {
  const packs = [];
  for (const line of String(ini ?? "").split(/\r?\n/)) {
    const m = /^\s*SharedContentPacks\s*=\s*\(\s*MountName\s*=\s*"([^"]+)"\s*,\s*DetailLevels\s*=\s*\(([^)]*)\)\s*\)/i.exec(line);
    if (!m) continue;
    const levels = m[2].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean);
    packs.push({ mount: m[1], levels: levels.length ? levels : ["Standard"] });
  }
  return packs;
}

/**
 * A template's optional variants (the new-project wizard's "Variant" drop-down),
 * each with the extra shared packs it copies in, e.g. FirstPerson "ArenaShooter"
 * adds the Weapons and Variant_Shooter packs.
 */
export function parseVariants(ini) {
  const variants = [];
  for (const line of String(ini ?? "").split(/\r?\n/)) {
    if (!/^\s*Variants\s*=/.test(line)) continue;
    const name = /Name\s*=\s*"([^"]+)"/.exec(line)?.[1];
    if (!name) continue;
    const packs = [];
    for (const m of line.matchAll(/\(\s*DetailLevels\s*=\s*\(([^)]*)\)\s*,\s*MountName\s*=\s*"([^"]+)"\s*\)/g)) {
      const levels = m[1].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean);
      packs.push({ mount: m[2], levels: levels.length ? levels : ["Standard"] });
    }
    variants.push({ name, packs });
  }
  return variants;
}

async function readTemplateDefs(folder) {
  try {
    return await fs.readFile(path.join(templatesDir(), folder, "Config", "TemplateDefs.ini"), "utf8");
  } catch {
    return "";
  }
}

/**
 * fs.cp filter that leaves out `excluded` sub-folders of a pack's Content, and
 * any external actor/object package that references one of them (a level
 * actor whose class lives in an excluded folder would fail to load).
 */
export function packFilter(contentRoot, mount, excluded = []) {
  if (!excluded.length) return undefined;
  const norm = (p) => p.split(path.sep).join("/");
  const refs = excluded.map((e) => `/Game/${mount}/${e.replace(/^\/+|\/+$/g, "")}`);
  const dirs = excluded.map((e) => norm(path.join(contentRoot, e)).toLowerCase());
  return async (src) => {
    const s = norm(src).toLowerCase();
    if (dirs.some((d) => s === d || s.startsWith(`${d}/`))) return false;
    if (/__external(actors|objects)__/i.test(s) && /\.uasset$/i.test(s)) {
      const bytes = await fs.readFile(src);
      if (refs.some((r) => bytes.includes(r))) return false;
    }
    return true;
  };
}

async function copySharedPacks(folder, projectDir, variant, exclude = {}) {
  const ini = await readTemplateDefs(folder);
  if (!ini) return [];
  const packs = parseSharedContentPacks(ini);
  if (variant) {
    const v = parseVariants(ini).find((x) => x.name.toLowerCase() === variant.toLowerCase());
    if (!v) {
      const names = parseVariants(ini).map((x) => x.name);
      throw new Error(`Template has no variant "${variant}". Variants: ${names.join(", ") || "none"}`);
    }
    for (const p of v.packs) if (!packs.some((q) => q.mount === p.mount)) packs.push(p);
  }
  const copied = [];
  for (const pack of packs) {
    // Prefer the listed detail level, then fall back to the other one.
    const order = [...pack.levels, "High", "Standard"].filter((v, i, a) => a.indexOf(v) === i);
    let done = false;
    for (const level of order) {
      const src = path.join(templatesDir(), "TemplateResources", level, pack.mount, "Content");
      try {
        await fs.access(src);
      } catch {
        continue;
      }
      const filter = packFilter(src, pack.mount, exclude[pack.mount]);
      await fs.cp(src, path.join(projectDir, "Content", pack.mount), { recursive: true, filter });
      // Variant levels keep their actors in one-file-per-actor packages next to
      // Content (__ExternalActors__/<Level>). They belong under
      // Content/__ExternalActors__/<Mount>/<Level>; without them the level
      // loads empty — no floor, no walls, no spawn points.
      for (const ext of ["__ExternalActors__", "__ExternalObjects__"]) {
        const extSrc = path.join(templatesDir(), "TemplateResources", level, pack.mount, ext);
        try {
          await fs.access(extSrc);
        } catch {
          continue;
        }
        await fs.cp(extSrc, path.join(projectDir, "Content", ext, pack.mount), { recursive: true, filter });
      }
      copied.push(`${pack.mount} (${level})`);
      done = true;
      break;
    }
    if (!done) throw new Error(`Template pack "${pack.mount}" is missing from TemplateResources`);
  }
  return copied;
}

/** Point the editor and the packaged game at a variant's own level. */
export function withStartupMap(engineIni, map) {
  const pkg = `${map}.${map.split("/").pop()}`;
  let out = String(engineIni ?? "");
  let found = false;
  out = out.replace(/^(\s*(?:GameDefaultMap|EditorStartupMap)\s*=).*$/gim, (_, key) => {
    found = true;
    return `${key}${pkg}`;
  });
  if (!found) {
    out += `${out.endsWith("\n") || !out ? "" : "\n"}[/Script/EngineSettings.GameMapsSettings]\nGameDefaultMap=${pkg}\nEditorStartupMap=${pkg}\n`;
  }
  return out;
}

async function setStartupMap(projectDir, map) {
  const file = path.join(projectDir, "Config", "DefaultEngine.ini");
  let ini = "";
  try {
    ini = await fs.readFile(file, "utf8");
  } catch {
    /* no ini yet */
  }
  await fs.writeFile(file, withStartupMap(ini, map), "utf8");
}

async function readTemplatePlugins(folder) {
  try {
    const raw = await fs.readFile(path.join(templatesDir(), folder, `${folder}.uproject`), "utf8");
    return JSON.parse(raw).Plugins ?? [];
  } catch {
    return [];
  }
}

async function isNonEmptyDir(dir) {
  try {
    return (await fs.readdir(dir)).length > 0;
  } catch {
    return false;
  }
}

/** A name that is free under the projects root: Name, Name2, Name3, ... */
async function freeName(base) {
  for (let i = 1; i < 100; i++) {
    const candidate = i === 1 ? base : `${base.slice(0, 18)}${i}`;
    if (!(await isNonEmptyDir(path.join(projectsRoot(), candidate)))) return candidate;
  }
  throw new Error(`No free project folder for "${base}"`);
}

/**
 * Create a playable-from-the-start project from an engine template.
 *
 * Copies the template's Config and Content (the template's own .uproject and
 * TemplateDefs.ini are not part of a real project), writes a .uproject with
 * the MCP plugins on, makes the GameCreator/ folder the builder watches, and
 * records the game in the registry.
 */
export async function createProject({ name, template = "FirstPerson", variant, id, description = "" }) {
  const t = templateFor(template);
  const v = variant ? t.variants?.[variant] : null;
  if (variant && !v) {
    throw new Error(`Template ${template} has no variant "${variant}". Variants: ${Object.keys(t.variants ?? {}).join(", ") || "none"}`);
  }
  const src = path.join(templatesDir(), t.folder);
  try {
    await fs.access(src);
  } catch {
    throw new Error(`Engine template not found at ${src}`);
  }

  const projectName = await freeName(safeProjectName(name));
  const projectDir = path.join(projectsRoot(), projectName);
  await fs.mkdir(projectDir, { recursive: true });

  for (const sub of ["Config", "Content"]) {
    try {
      await fs.cp(path.join(src, sub), path.join(projectDir, sub), { recursive: true });
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }
  await fs.rm(path.join(projectDir, "Config", "TemplateDefs.ini"), { force: true });
  await fs.rm(path.join(projectDir, "Config", "config.ini"), { force: true });
  const packs = await copySharedPacks(t.folder, projectDir, v?.wizardName, v?.exclude);
  const map = v?.map ?? t.map;
  if (v) await setStartupMap(projectDir, map);

  const uproject = path.join(projectDir, `${projectName}.uproject`);
  const doc = buildUproject({ description, templatePlugins: await readTemplatePlugins(t.folder) });
  await fs.writeFile(uproject, JSON.stringify(doc, null, "\t"), "utf8");

  await fs.mkdir(path.join(projectDir, "GameCreator", "shots"), { recursive: true });

  const entry = await upsert({
    id: id || randomUUID(),
    name: projectName,
    template,
    variant: variant ?? null,
    map,
    projectDir,
    uproject,
    createdAt: new Date().toISOString(),
  });
  return { ...entry, contentPacks: packs };
}
