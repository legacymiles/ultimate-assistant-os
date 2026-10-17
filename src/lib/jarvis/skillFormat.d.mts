// Types for skillFormat.mjs — the shared skill format (server + Node script).

export declare const SKILL_TEXT_EXT: string[];
export declare const SKILL_FILE_MAX: number;
export declare const SKILL_TOTAL_MAX: number;

export type SkillFiles = Record<string, string>;

export declare function validSkillName(name: unknown): name is string;
export declare function validRefPath(rel: unknown): rel is string;
export declare function normalizeFiles(files: unknown): SkillFiles;
export declare function hashSkill(body: string, files: unknown): string;
export declare function skillSize(body: string, files: unknown): number;
export declare function skillDescription(body: string): string;
export declare function readSkillDir(
  dir: string,
  skipped?: string[],
): Promise<{ body: string; files: SkillFiles; hash: string } | null>;
