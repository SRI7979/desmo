/**
 * Offline routing benchmark: the server's deterministic question detectors
 * (src/lib/strategy-selection.ts) against each case's hand-labeled routing.
 * These detectors decide hard rejections no model output can override (a
 * calculator method for a representation question, integer sampling of a
 * continuous domain, an unencoded integer parameter, a no-solution answer
 * without a distinct-lines check), so a miss lets a bad method through and a
 * false alarm rejects a good one. Free: no model calls.
 *
 *   npm run bench:routing [-- --json]
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadCases } from "./benchmark/load-cases";
import {
  continuousInterval,
  isIntegerFactorExtremumQuestion,
  isRepresentationQuestion,
  questionCondition,
  questionIntegerParameters,
} from "../src/lib/strategy-selection";

type Confusion = { tp: number; fp: number; fn: number; tn: number; misses: string[]; falseAlarms: string[] };

const empty = (): Confusion => ({ tp: 0, fp: 0, fn: 0, tn: 0, misses: [], falseAlarms: [] });

function tally(confusion: Confusion, id: string, expected: boolean, detected: boolean) {
  if (expected && detected) confusion.tp += 1;
  else if (!expected && detected) {
    confusion.fp += 1;
    confusion.falseAlarms.push(id);
  } else if (expected && !detected) {
    confusion.fn += 1;
    confusion.misses.push(id);
  } else confusion.tn += 1;
}

const ratio = (part: number, whole: number) => (whole ? Number((part / whole).toFixed(3)) : null);

const cases = await loadCases();
const detectors: Record<string, Confusion> = {
  representation: empty(),
  "no-solution condition": empty(),
  "integer parameters (exact set)": empty(),
  "continuous interval": empty(),
  "integer-factor extremum": empty(),
};
for (const item of cases) {
  const question = item.problem;
  tally(detectors.representation, item.id, item.routing.representation, isRepresentationQuestion(question));
  // Infinitely-many questions are left to the model by design (see questionCondition).
  tally(detectors["no-solution condition"], item.id, item.routing.condition === "no-solution", questionCondition(question) === "no-solution");
  const expected = [...item.routing.integerParameters].sort().join(",");
  const detected = questionIntegerParameters(question).map((parameter) => parameter.name).sort().join(",");
  // Positive class: the question restricts some parameter to integers; a hit needs the exact set.
  if (expected || detected) tally(detectors["integer parameters (exact set)"], `${item.id} [${expected || "-"} vs ${detected || "-"}]`, Boolean(expected), expected === detected && Boolean(detected));
  else tally(detectors["integer parameters (exact set)"], item.id, false, false);
  tally(detectors["continuous interval"], item.id, item.routing.continuousInterval, continuousInterval(question) !== null);
  tally(detectors["integer-factor extremum"], item.id, item.routing.integerFactorExtremum, isIntegerFactorExtremumQuestion(question));
}

const summary = Object.fromEntries(
  Object.entries(detectors).map(([name, c]) => [
    name,
    {
      positives: c.tp + c.fn,
      precision: ratio(c.tp, c.tp + c.fp),
      recall: ratio(c.tp, c.tp + c.fn),
      accuracy: ratio(c.tp + c.tn, c.tp + c.tn + c.fp + c.fn),
      misses: c.misses,
      falseAlarms: c.falseAlarms,
    },
  ]),
);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ cases: cases.length, detectors: summary }, null, 2));
} else {
  const lines = [`Routing detectors over ${cases.length} cases`, "", "| Detector | Positives | Precision | Recall | Accuracy |", "|---|---|---|---|---|"];
  for (const [name, row] of Object.entries(summary)) lines.push(`| ${name} | ${row.positives} | ${row.precision ?? "—"} | ${row.recall ?? "—"} | ${row.accuracy} |`);
  for (const [name, row] of Object.entries(summary)) {
    if (row.misses.length) lines.push("", `${name} misses: ${row.misses.join("; ")}`);
    if (row.falseAlarms.length) lines.push("", `${name} false alarms: ${row.falseAlarms.join("; ")}`);
  }
  console.log(lines.join("\n"));
  const out = process.argv.find((arg) => arg.startsWith("--out="))?.slice(6);
  if (out) {
    await mkdir(path.join(process.cwd(), "evals/reports"), { recursive: true });
    await writeFile(path.join(process.cwd(), "evals/reports", `routing-${out}.md`), `# Routing benchmark: ${out}\n\n${lines.join("\n")}\n`);
  }
}
