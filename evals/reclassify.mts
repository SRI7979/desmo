// One-off: recompute pooled metrics from already-captured run data using the
// current answerMatches()/classifiers, without spending more API calls.
import { readFile } from "node:fs/promises";
import { answerMatches, classify } from "./classifiers";
import type { Solution } from "../src/lib/solver-schema";

async function main() {
  const files = process.argv.slice(2);

  let totalRuns = 0,
    correct = 0,
    forbidden = 0,
    methodMatchable = 0,
    methodMatched = 0;
  const worstCase = new Map<string, boolean>();
  const problemCache = new Map<string, { correctAnswer: string }>();

  for (const file of files) {
    const data = JSON.parse(await readFile(file, "utf8"));
    for (const job of data.fullResults) {
      const r = job.result;
      totalRuns += 1;
      if (!problemCache.has(job.id)) {
        problemCache.set(job.id, JSON.parse(await readFile(`evals/problems/${job.id}.json`, "utf8")));
      }
      const problem = problemCache.get(job.id)!;
      const isForbidden = !r.ok || r.forbidden;
      const isCorrect = r.ok && answerMatches(r.answer, problem.correctAnswer);
      if (r.ok && r.solution) {
        methodMatchable += 1;
        const solution = { ...r.solution, answer: r.answer, trick: r.trick } as Solution;
        if (classify(job.id, solution).intendedOrAcceptable) methodMatched += 1;
      }
      if (isCorrect) correct += 1;
      if (isForbidden) forbidden += 1;
      if (isForbidden) worstCase.set(job.id, true);
      else if (!worstCase.has(job.id)) worstCase.set(job.id, false);
    }
  }

  console.log("totalRuns", totalRuns);
  console.log("answerMatch (pooled, fixed parser):", ((correct / totalRuns) * 100).toFixed(1));
  console.log("forbiddenHit (pooled):", ((forbidden / totalRuns) * 100).toFixed(1));
  console.log(
    "methodMatch (only runs with stored solution data, n=" + methodMatchable + "):",
    ((methodMatched / methodMatchable) * 100).toFixed(1),
  );
  const problemIds = [...worstCase.keys()];
  const hits = [...worstCase.values()].filter(Boolean).length;
  console.log("worstCase (pooled):", ((hits / problemIds.length) * 100).toFixed(1), `(${hits}/${problemIds.length})`);
}

main();
