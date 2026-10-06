import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { TECHNIQUE_IDS } from "./technique-vocabulary";

/**
 * The gold solutions: problems with the Desmos solution a human tutor
 * considers the standard to teach. They lead the candidates prompt and run in
 * the benchmark as their own group. Agent-written examples do not belong here.
 */
export const goldSolutionSchema = z
  .object({
    id: z.string().trim().min(1),
    question: z.string().trim().min(1),
    answer_choices: z.record(z.string(), z.string().trim().min(1)),
    correct_answer: z.string().trim().min(1),
    strategy_name: z.string().trim().min(1),
    // The vocabulary technique this solution teaches; free-form names are rejected.
    techniqueId: z.enum(TECHNIQUE_IDS),
    trigger_pattern: z.string().trim().min(1),
    desmos_steps: z.array(z.string().trim().min(1)).min(1),
    why_preferred: z.string().trim().min(1),
    // A draft not yet ready to teach: kept in the folder, left out of the prompt and the benchmark.
    needs_review: z.boolean(),
  })
  .strict();

const goldFileSchema = z.array(goldSolutionSchema).min(1);

export type GoldSolution = z.infer<typeof goldSolutionSchema>;

export type LoadedGoldSolutions = {
  files: string[];
  solutionCount: number;
  skippedReviewCount: number;
  /** Every reviewed solution, in file order. */
  solutions: GoldSolution[];
  prompt: string;
};

export class GoldSolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoldSolutionError";
  }
}

export const GOLD_SOLUTIONS_DIRECTORY = path.join(process.cwd(), "src/content/gold-solutions");

function promptSafeSteps(steps: string[]) {
  return steps.map((step) =>
    step.replace(/\b([A-Za-z])_(\d+)\b/g, "$1_{$2}"),
  );
}

export async function loadGoldSolutions(
  directory = GOLD_SOLUTIONS_DIRECTORY,
): Promise<LoadedGoldSolutions> {
  let files: string[];
  try {
    files = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    throw new GoldSolutionError(
      `Could not read the gold-solutions directory: ${String(error)}`,
    );
  }

  const contents = await Promise.all(
    files.map(async (file) => ({
      file,
      content: await readFile(path.join(directory, file), "utf8"),
    })),
  );

  const seenIds = new Map<string, string>();
  const solutions: GoldSolution[] = [];
  const promptSolutions: Array<GoldSolution & { source_file: string }> = [];
  let solutionCount = 0;
  let skippedReviewCount = 0;

  for (const { file, content } of contents) {
    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch (error) {
      throw new GoldSolutionError(
        `${file} is not valid JSON: ${String(error)}`,
      );
    }

    const parsed = goldFileSchema.safeParse(data);
    if (!parsed.success) {
      throw new GoldSolutionError(
        `${file} does not match the gold solution schema: ${z.prettifyError(parsed.error)}`,
      );
    }

    for (const solution of parsed.data) {
      const previousFile = seenIds.get(solution.id);
      if (previousFile) {
        throw new GoldSolutionError(
          `Gold solution id ${solution.id} appears in both ${previousFile} and ${file}.`,
        );
      }
      seenIds.set(solution.id, file);
      solutionCount += 1;

      if (solution.needs_review) {
        skippedReviewCount += 1;
        continue;
      }

      solutions.push(solution);
      promptSolutions.push({
        source_file: file,
        ...solution,
        desmos_steps: promptSafeSteps(solution.desmos_steps),
      });
    }
  }

  return {
    files,
    solutionCount,
    skippedReviewCount,
    solutions,
    prompt: JSON.stringify(promptSolutions, null, 2),
  };
}
