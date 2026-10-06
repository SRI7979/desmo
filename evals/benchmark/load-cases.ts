import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { loadGoldSolutions, type GoldSolution } from "../../src/lib/gold-solutions";
import { benchmarkCaseSchema, type CaseGroup, type LoadedCase, type ScorableCase } from "./case-schema";

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

export type CaseFilter = { only?: string[]; group?: Exclude<CaseGroup, "gold"> | "all"; includePrivate?: boolean };

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

/**
 * One gold solution as a scored case: its technique is the gold label and its
 * answer the expected one. A lettered answer is scored as that choice's text.
 */
export function goldCase(solution: GoldSolution): ScorableCase {
  const entries = Object.entries(solution.answer_choices);
  const choices = entries.length ? entries.map(([, text]) => text) : null;
  const lettered = solution.answer_choices[solution.correct_answer];
  return {
    id: `gold/${solution.id}`,
    group: "gold",
    labelProvenance: "human_verified_gold",
    problem: solution.question,
    choices,
    correctAnswer: lettered ?? solution.correct_answer,
    gold: [solution.techniqueId],
    acceptable: [],
    bad: [],
  };
}

/**
 * The gold solutions as benchmark cases (npm run bench:solver -- <label>
 * --group=gold). Never mixed into the default run: the solver sees them in its
 * prompt, so they show the standard is followed, not that it generalizes.
 */
export async function loadGoldCases(only: string[] = []): Promise<ScorableCase[]> {
  const { solutions } = await loadGoldSolutions();
  return solutions
    .map(goldCase)
    .filter((item) => !only.length || only.some((prefix) => item.id.startsWith(prefix) || item.id.startsWith(`gold/${prefix}`)));
}
