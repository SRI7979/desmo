/**
 * What a solve did with the curated strategy library, for development logs and
 * eval records only: never shown to students, never used to select.
 *
 * Call 1 must fill its `library` report (strategies whose trigger fits the
 * recognized structure, and why a matched one was skipped) before it writes
 * any candidate, and each candidate cites the numbered strategy it applies.
 * Independently, a few deterministic structure detectors read the
 * transcription for wording that points at a specific library technique
 * ("one solution can be written as (a+√b)/6", "is a factor of", "exactly one
 * point"). A detected technique that no candidate tried and no matched
 * strategy teaches is a library miss: the visible sign of a solve that went
 * to ordinary math without consulting the trick that fits.
 */
import type { AnswerChoice } from "./solver-schema";
import {
  continuousInterval,
  isIntegerFactorExtremumQuestion,
  isRepresentationQuestion,
  questionCondition,
  type CandidatesResponse,
  type MethodSelection,
} from "./strategy-selection";
import { getTechnique, isTechniqueId, TECHNIQUE_ANNOTATION, type TechniqueId } from "./technique-vocabulary";

export type LibraryStrategy = { number: number; title: string; techniques: TechniqueId[] };

/**
 * The numbered strategies of desmos-tricks.md with the techniques each one
 * teaches: its own tag, plus the tags of unnumbered sub-sections before the
 * next strategy (strategy 61 also teaches bracket and derivative regression).
 */
export function parseLibraryIndex(markdown: string): LibraryStrategy[] {
  const lines = markdown.split("\n");
  const strategies: LibraryStrategy[] = [];
  let current: LibraryStrategy | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^(\d+)\. (\S.*)$/);
    if (heading && Number(heading[1]) === strategies.length + 1 && TECHNIQUE_ANNOTATION.test(lines[index + 1] ?? "")) {
      current = { number: strategies.length + 1, title: heading[2].trim(), techniques: [] };
      strategies.push(current);
      continue;
    }
    const tag = lines[index].match(TECHNIQUE_ANNOTATION);
    if (tag && current && isTechniqueId(tag[1]) && !current.techniques.includes(tag[1])) current.techniques.push(tag[1]);
  }
  return strategies;
}

type Detector = { id: string; techniques: TechniqueId[]; test: (question: string, choices: AnswerChoice[] | null) => boolean };

const COORDINATE_PAIR = /\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)/g;
const coordinatePairs = (question: string) => question.match(COORDINATE_PAIR)?.length ?? 0;
const ROOT = String.raw`(?:\\sqrt|√|sqrt)`;
// Constants in a stated form, never the variable: x - √x = 6 is a radical equation, not a form.
const RADICAL_FORM = new RegExp(String.raw`\b[a-wz]\s*[+\-±]\s*(?:${ROOT}\s*[({]?\s*[a-wz]\b|[a-wz]\s*${ROOT})`, "i");
const STATED_FORM = /written (?:in the form |as )|\b(?:in|of) the form\b|\bwhere [a-z] and [a-z] are\b/i;
// A choice is symbolic when it has a one-letter variable once LaTeX commands are removed ("5 feet" is not).
const SINGLE_LETTER = /(?:^|[^a-z])[a-z](?:[^a-z]|$)/i;

/**
 * Wording that points at one library technique. Deliberately narrow: each
 * detector fires only on phrasing that leaves little doubt, because a noisy
 * detector would bury real library misses.
 */
export const STRUCTURE_DETECTORS: readonly Detector[] = [
  {
    // "One solution is (a+√b)/6": click the root, fit the unknown (strategy 78).
    id: "radical-form-root",
    techniques: ["parameter-regression"],
    test: (question) => /\b(?:solutions?|roots?|zeros?)\b/i.test(question) && (RADICAL_FORM.test(question) || (STATED_FORM.test(question) && new RegExp(ROOT, "i").test(question))),
  },
  {
    // A line meeting a parabola once is the vertex of their difference; |2x+6|=3k-12 is a slider to the corner.
    id: "exactly-one-intersection",
    techniques: ["vertex-of-difference", "slider-condition"],
    test: (question) => /exactly one (?:point|real solution|solution)|intersects? (?:at )?exactly (?:one|once)|\btangent to\b/i.test(question),
  },
  {
    id: "solution-count-condition",
    techniques: ["bracket-regression", "derivative-regression", "slider-parallel", "identity-regression"],
    test: (question) => questionCondition(question) !== null,
  },
  { id: "factor-with-unknown", techniques: ["shared-zero"], test: (question) => /\b(?:is|as) a factor of\b|\bhas a factor of\b/i.test(question) },
  {
    id: "equivalent-forms",
    techniques: ["identity-regression"],
    test: (question) => /\bequivalent\b|\bfor all (?:real )?values of\b|\btrue for all\b/i.test(question),
  },
  {
    id: "integer-search",
    techniques: ["integer-list-filter"],
    test: (question) =>
      isIntegerFactorExtremumQuestion(question) ||
      /how many (?:positive |negative )?(?:integers?|integer values|whole numbers)|\b(?:greatest|least) (?:possible )?integer\b|\binteger solutions?\b/i.test(question),
  },
  {
    // A stated domain alone is not an extremum: "for 0 <= x <= 90, sin(x) = cos(2x)" is an intersection.
    id: "bounded-extremum",
    techniques: ["restricted-extremum"],
    test: (question) => continuousInterval(question) !== null && /\b(?:maximum|minimum|greatest|least|largest|smallest)\b/i.test(question),
  },
  { id: "statistics", techniques: ["statistics-builtin"], test: (question) => /\b(?:mean|median|standard deviation)\b/i.test(question) },
  { id: "frequency-table", techniques: ["frequency-repeat"], test: (question) => /\bfrequency\b/i.test(question) },
  { id: "midpoint", techniques: ["midpoint-builtin"], test: (question) => /\bmidpoint\b/i.test(question) },
  { id: "distance", techniques: ["distance-builtin"], test: (question) => /\bdistance between\b/i.test(question) },
  { id: "coordinate-polygon-area", techniques: ["polygon-area"], test: (question) => /\barea\b/i.test(question) && coordinatePairs(question) >= 3 },
  {
    id: "points-on-a-model-with-constants",
    techniques: ["parameter-regression", "three-point-regression", "linear-regression", "bracket-regression"],
    test: (question) => /\bconstants?\b/i.test(question) && coordinatePairs(question) >= 2,
  },
  {
    // Not on a "which equation represents" question: translating the words is the task there.
    id: "symbolic-choices",
    techniques: ["strategic-value-test"],
    test: (question, choices) =>
      !isRepresentationQuestion(question) && !!choices?.length && choices.every((choice) => SINGLE_LETTER.test(choice.text.replace(/\\[a-z]+/gi, " "))),
  },
];

export type DetectedStructure = { detector: string; techniques: TechniqueId[] };

export function detectStructures(question: string, choices: AnswerChoice[] | null): DetectedStructure[] {
  return STRUCTURE_DETECTORS.filter((detector) => detector.test(question, choices)).map(({ id, techniques }) => ({ detector: id, techniques: [...techniques] }));
}

export type LibraryTrace = {
  /** Every strategy number the solve referenced: matched, skipped, or cited by a candidate. */
  considered: number[];
  /** Strategies the model said fit the recognized structure. */
  matched: { number: number; title: string | null }[];
  /** Matched strategies that did not become a candidate, with the model's reason. */
  skipped: { number: number; reason: string }[];
  /** Library techniques the deterministic detectors read in the question's wording. */
  detected: DetectedStructure[];
  /** Detected techniques no candidate tried and no matched strategy teaches. */
  missed: TechniqueId[];
  /** Each listed or rejected method: its technique, the strategy it cites, and its fate. */
  candidates: {
    id: string;
    techniqueId: TechniqueId;
    strategy: number | null;
    source: "library" | "uncited-library-technique" | "generic-math";
    outcome: string;
    total: number;
  }[];
  winner: { id: string; techniqueId: TechniqueId; strategy: number | null; total: number; mathScore: number; reason: string } | null;
  /** The default is a standard paper technique, not a library one. */
  fellBackToGenericMath: boolean;
  /** Citations that disagree with the library: a strategy that does not teach the candidate's technique. */
  mismatches: string[];
};

/** The library trace of one selection, computed from call 1's report and the server's outcome. */
export function libraryTrace(response: Pick<CandidatesResponse, "library" | "candidates">, selection: MethodSelection, index: readonly LibraryStrategy[] = []): LibraryTrace {
  const byNumber = new Map(index.map((strategy) => [strategy.number, strategy]));
  // A rescue or a relabel can change which response candidate a method came
  // from; the citation is looked up by technique, first candidate first.
  const cited = new Map<TechniqueId, number | null>();
  for (const candidate of response.candidates) if (!cited.has(candidate.techniqueId)) cited.set(candidate.techniqueId, candidate.strategy);

  const mismatches: string[] = [];
  const candidates = selection.methods.map((method) => {
    const strategy = cited.get(method.techniqueId) ?? null;
    const library = getTechnique(method.techniqueId).source === "library";
    const taught = strategy !== null ? byNumber.get(strategy) : undefined;
    if (taught && !taught.techniques.includes(method.techniqueId)) {
      mismatches.push(`${method.id} cites strategy ${strategy} (${taught.title}), which teaches ${taught.techniques.join(", ")}`);
    }
    const source: LibraryTrace["candidates"][number]["source"] = !library ? "generic-math" : strategy !== null ? "library" : "uncited-library-technique";
    return { id: method.id, techniqueId: method.techniqueId, strategy, source, outcome: method.rejected ? method.rejected.rule : "eligible", total: method.total };
  });

  const winnerMethod = selection.methods.find((method) => method.id === selection.winnerId && !method.rejected) ?? null;
  const runnerUp = selection.methods.find((method) => !method.rejected && method.id !== selection.winnerId) ?? null;
  const winner = winnerMethod
    ? {
        id: winnerMethod.id,
        techniqueId: winnerMethod.techniqueId,
        strategy: cited.get(winnerMethod.techniqueId) ?? null,
        total: winnerMethod.total,
        mathScore: winnerMethod.mathScore,
        reason:
          `lowest total cost ${winnerMethod.total} (${winnerMethod.cost.rows} rows, ${winnerMethod.cost.derivationSteps} derivation, ${winnerMethod.cost.oneOffFacts} facts)` +
          (runnerUp ? `; next ${runnerUp.techniqueId} at ${runnerUp.total}` : "; the only eligible method"),
      }
    : null;

  const detected = detectStructures(selection.question, selection.choices);
  const tried = new Set<TechniqueId>(selection.methods.map((method) => method.techniqueId));
  const matchedTechniques = new Set(response.library.matched.flatMap((number) => byNumber.get(number)?.techniques ?? []));
  // A detector names several techniques when any one of them fits; trying or matching one covers it.
  const covered = (technique: TechniqueId) => tried.has(technique) || matchedTechniques.has(technique);
  const missed = [...new Set(detected.filter((item) => !item.techniques.some(covered)).flatMap((item) => item.techniques))];

  const considered = [
    ...new Set([...response.library.matched, ...response.library.skipped.map((item) => item.strategy), ...candidates.flatMap((item) => (item.strategy !== null ? [item.strategy] : []))]),
  ].sort((a, b) => a - b);

  return {
    considered,
    matched: response.library.matched.map((number) => ({ number, title: byNumber.get(number)?.title ?? null })),
    skipped: response.library.skipped.map((item) => ({ number: item.strategy, reason: item.reason })),
    detected,
    missed,
    candidates,
    winner,
    fellBackToGenericMath: winnerMethod ? getTechnique(winnerMethod.techniqueId).source === "standard" : false,
    mismatches,
  };
}
