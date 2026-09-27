import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { TECHNIQUE_IDS } from "./technique-vocabulary";

export const trainingExampleSchema = z
  .object({
    id: z.string().trim().min(1),
    question: z.string().trim().min(1),
    answer_choices: z.record(z.string(), z.string().trim().min(1)),
    correct_answer: z.string().trim().min(1),
    strategy_name: z.string().trim().min(1),
    // The vocabulary technique this example teaches; free-form names are rejected.
    techniqueId: z.enum(TECHNIQUE_IDS),
    trigger_pattern: z.string().trim().min(1),
    desmos_steps: z.array(z.string().trim().min(1)).min(1),
    why_preferred: z.string().trim().min(1),
    needs_review: z.boolean(),
  })
  .strict();

const trainingBatchSchema = z.array(trainingExampleSchema).min(1);

export type TrainingExample = z.infer<typeof trainingExampleSchema>;

export type LoadedTrainingExamples = {
  files: string[];
  exampleCount: number;
  skippedReviewCount: number;
  prompt: string;
};

export class TrainingBatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrainingBatchError";
  }
}

const defaultTrainingDirectory = path.join(
  process.cwd(),
  "src/content/training-batches",
);

function promptSafeSteps(steps: string[]) {
  return steps.map((step) =>
    step.replace(/\b([A-Za-z])_(\d+)\b/g, "$1_{$2}"),
  );
}

export async function loadTrainingExamples(
  directory = defaultTrainingDirectory,
): Promise<LoadedTrainingExamples> {
  let files: string[];
  try {
    files = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    throw new TrainingBatchError(
      `Could not read the training-batches directory: ${String(error)}`,
    );
  }

  const contents = await Promise.all(
    files.map(async (file) => ({
      file,
      content: await readFile(path.join(directory, file), "utf8"),
    })),
  );

  const seenIds = new Map<string, string>();
  const reviewedExamples: Array<
    TrainingExample & { source_batch: string }
  > = [];
  let exampleCount = 0;
  let skippedReviewCount = 0;

  for (const { file, content } of contents) {
    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch (error) {
      throw new TrainingBatchError(
        `${file} is not valid JSON: ${String(error)}`,
      );
    }

    const parsed = trainingBatchSchema.safeParse(data);
    if (!parsed.success) {
      throw new TrainingBatchError(
        `${file} does not match the training batch schema: ${z.prettifyError(parsed.error)}`,
      );
    }

    for (const example of parsed.data) {
      const previousFile = seenIds.get(example.id);
      if (previousFile) {
        throw new TrainingBatchError(
          `Training example id ${example.id} appears in both ${previousFile} and ${file}.`,
        );
      }
      seenIds.set(example.id, file);
      exampleCount += 1;

      if (example.needs_review) {
        skippedReviewCount += 1;
        continue;
      }

      reviewedExamples.push({
        source_batch: file,
        ...example,
        desmos_steps: promptSafeSteps(example.desmos_steps),
      });
    }
  }

  return {
    files,
    exampleCount,
    skippedReviewCount,
    prompt: JSON.stringify(reviewedExamples, null, 2),
  };
}
