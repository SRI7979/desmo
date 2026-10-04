/**
 * A deterministic, offline rubric for explanation quality, used by the eval
 * harness (and its tests) to compare prompt versions. It does not reject
 * anything in production: a heuristic grader that rejected valid teaching
 * would turn good solves into extra model calls. Each check mirrors the
 * explanation structure PHILOSOPHY.md asks for: THE IDEA, then per row what
 * the question supplied, what the row does, and why it helps, then READ THE
 * RESULT naming exactly what to look at.
 */
import type { Solution } from "./solver-schema";

/** Terms a first-time student may not know; each needs a plain-words gloss nearby. */
export const JARGON = [
  "proportional",
  "coefficient",
  "coefficients",
  "discriminant",
  "regression",
  "residual",
  "rmse",
  "parameter",
  "identity",
  "coincident",
  "asymptote",
  "extraneous",
  "collinear",
  "polynomial",
  "factor theorem",
  "vertex form",
  "standard form",
  "domain",
] as const;

/** A sentence that explains the term it uses. */
const GLOSS = /\b(?:means?|meaning|which is|that is|in other words|is (?:just|simply)|tells (?:you|us)|stands for|so that|because)\b|:\s|\u2014/i;

export type RubricCheck = { id: string; passed: boolean; detail: string };
export type RubricScore = { score: number; checks: RubricCheck[]; unexplainedJargon: string[] };

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
}

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Jargon used in a sentence that does not also explain it, and is not explained anywhere earlier. */
export function unexplainedJargon(texts: readonly string[]): string[] {
  const explained = new Set<string>();
  const missing = new Set<string>();
  for (const sentence of texts.flatMap(sentences)) {
    const lower = sentence.toLowerCase();
    for (const term of JARGON) {
      if (!new RegExp(`\\b${term}\\b`).test(lower)) continue;
      if (GLOSS.test(sentence) || /\(([^()]{6,})\)/.test(sentence)) explained.add(term);
      else if (!explained.has(term)) missing.add(term);
    }
  }
  return [...missing].filter((term) => !explained.has(term));
}

function numbersIn(text: string): string[] {
  return text.match(/-?\d+(?:\.\d+)?/g) ?? [];
}

/**
 * Scores one explained solution in [0, 1] as the share of applicable checks
 * it passes. A needs_clarification solution scores 1 with no checks.
 */
export function scoreExplanation(solution: Solution, question = solution.question): RubricScore {
  if (solution.status !== "solved") return { score: 1, checks: [], unexplainedJargon: [] };
  const checks: RubricCheck[] = [];
  const rows = solution.expressions;
  const nonTrivial = rows.length >= 2 || solution.steps.length >= 2;
  const why = solution.why.trim();
  const ideaSentences = sentences(why).length;
  checks.push({
    id: "idea",
    passed: nonTrivial ? ideaSentences >= 2 && words(why) >= 20 : words(why) >= 8,
    detail: `${ideaSentences} sentence(s), ${words(why)} words in THE IDEA`,
  });
  if (rows.length > 0) {
    const thin = rows.flatMap((row, index) => (words(row.purpose) < 10 ? [index + 1] : []));
    checks.push({ id: "row-depth", passed: thin.length === 0, detail: thin.length ? `thin purposes on line(s) ${thin.join(", ")}` : "every row explained" });
    const questionNumbers = new Set(numbersIn(question));
    const grounded = rows.filter((row) =>
      /\b(?:question|given|problem|stated|table|choices?|points?|from line|line \d|the equation|the graph)\b/i.test(row.purpose) ||
      numbersIn(row.purpose).some((number) => questionNumbers.has(number)),
    ).length;
    checks.push({
      id: "row-grounding",
      passed: grounded >= Math.ceil(rows.length / 2),
      detail: `${grounded}/${rows.length} purposes say where their information comes from`,
    });
    const readAnswer = solution.readAnswer ?? "";
    checks.push({
      id: "read-result",
      passed: /\b(?:line|row)\s*\d+\b|\bintersection\b|\bvertex\b|\bslider\b|\bintercept\b|\bpoint\b/i.test(readAnswer) && words(readAnswer) >= 8,
      detail: readAnswer ? `READ THE RESULT: ${words(readAnswer)} words` : "no READ THE RESULT",
    });
  } else {
    checks.push({
      id: "written-steps",
      passed: solution.steps.length >= 1 && solution.steps.every((step) => words(step) >= 6),
      detail: `${solution.steps.length} written step(s)`,
    });
  }
  const jargon = unexplainedJargon([why, ...rows.map((row) => row.purpose), solution.readAnswer ?? "", ...solution.steps]);
  checks.push({ id: "jargon", passed: jargon.length === 0, detail: jargon.length ? `unexplained: ${jargon.join(", ")}` : "no unexplained jargon" });
  const prose = [why, ...rows.map((row) => row.purpose), solution.readAnswer ?? ""].join(" ");
  const sliderClaim = rows.some((row) => row.slider) && !rows.some((row) => /\\sim|~/.test(row.latex)) &&
    /\bDesmos\s+(?:found|solved|computed)\s+(?:the\s+)?(?:slider|parameter|value)\b/i.test(prose);
  checks.push({ id: "honest-slider", passed: !sliderClaim, detail: sliderClaim ? "claims Desmos found the slider value" : "ok" });
  const passed = checks.filter((check) => check.passed).length;
  return { score: checks.length ? passed / checks.length : 1, checks, unexplainedJargon: jargon };
}
