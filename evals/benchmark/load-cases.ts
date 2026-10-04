import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { benchmarkCaseSchema, type CaseGroup, type LoadedCase } from "./case-schema";

/** Committed cases. */
export const PUBLIC_CASES_DIR = path.join(process.cwd(), "evals/problems");
/**
 * Gitignored cases for material that must not be committed or republished
 * (Bedrock Prep problems a user adds by hand for local benchmarking).
 */
export const PRIVATE_CASES_DIR = path.join(process.cwd(), "evals/private");

export class CaseValidationError extends Error {}

async function loadDirectory(directory: string, isPrivate: boolean): Promise<LoadedCase[]> {
  if (!existsSync(directory)) return [];
  const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
  const problems: string[] = [];
  const cases: LoadedCase[] = [];
  for (const file of files) {
    const id = file.replace(/\.json$/, "");
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(path.join(directory, file), "utf8"));
    } catch (error) {
      problems.push(`${file}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    const parsed = benchmarkCaseSchema.safeParse(raw);
    if (!parsed.success) {
      problems.push(`${file}: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(case)"}: ${issue.message}`).join("; ")}`);
      continue;
    }
    cases.push({ ...parsed.data, id: isPrivate ? `private/${id}` : id, private: isPrivate });
  }
  if (problems.length) throw new CaseValidationError(`Invalid benchmark cases:\n${problems.join("\n")}`);
  return cases;
}

export type CaseFilter = { only?: string[]; group?: CaseGroup | "all"; includePrivate?: boolean };

/** Every valid case, public then private, filtered; throws listing every invalid file. */
export async function loadCases(filter: CaseFilter = {}): Promise<LoadedCase[]> {
  const cases = [
    ...(await loadDirectory(PUBLIC_CASES_DIR, false)),
    ...(filter.includePrivate === false ? [] : await loadDirectory(PRIVATE_CASES_DIR, true)),
  ];
  const ids = new Set<string>();
  for (const item of cases) {
    if (ids.has(item.id)) throw new CaseValidationError(`Duplicate case id ${item.id}`);
    ids.add(item.id);
  }
  return cases.filter(
    (item) =>
      (!filter.group || filter.group === "all" || item.group === filter.group) &&
      (!filter.only?.length || filter.only.some((prefix) => item.id.startsWith(prefix) || item.id.startsWith(`private/${prefix}`))),
  );
}
