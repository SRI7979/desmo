import type { CacheEntry, Explanation } from "./solve-cache";
import { parseNumber } from "./answer-consistency";
import { selectMethods, type Candidate, type CandidatesResponse } from "./strategy-selection";

/** Both factor assignments must be found before classifying them as integer/noninteger. */
function factorForms(question: string) {
  const text = question.replace(/[−–]/g, "-").replace(/\$/g, "");
  if (!/\bj\s+and\s+k\s+are\s+positive\s+integers\b/i.test(text) ||
      !/\bl\s+and\s+m\s+are\s+positive\s+(?:nonintegers|non-integers|noninteger\s+(?:numbers|constants)|numbers\s+that\s+are\s+not\s+integers)\b/i.test(text) ||
      !/\b(?:value\s+of|what\s+is)\s+k\s*\+\s*l\b/i.test(text)) return null;
  const superscripts = "⁰¹²³⁴⁵⁶⁷⁸⁹";
  const compact = text
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, digits => `^${[...digits].map(digit => superscripts.indexOf(digit)).join("")}`)
    .replace(/\^\{(\d+)\}/g, "^$1")
    .replace(/\\(?:left|right|cdot)/g, "")
    .replace(/\s+/g, "");
  const polynomial = compact.match(/(\d+)x\^(\d+)\+(\d+)x\^(\d+)\+(\d+)/);
  if (!polynomial) return null;
  const [leading, highPower, middle, power, constant] = polynomial.slice(1).map(Number);
  if (![leading, middle, constant, highPower, power].every(Number.isSafeInteger) ||
      Math.min(leading, middle, constant, power) < 1 || highPower !== 2 * power ||
      Math.max(leading, middle, constant) > 10000) return null;
  const first = compact.match(new RegExp(`\\((\\d+)x\\^${power}\\+j\\)\\((\\d+)x\\^${power}\\+k\\)`));
  const second = compact.match(new RegExp(`\\((\\d+)x\\^${power}\\+l\\)\\((\\d+)x\\^${power}\\+m\\)`));
  if (!first || !second || first[1] !== second[1] || first[2] !== second[2]) return null;
  const [p, q] = first.slice(1).map(Number);
  if (p * q !== leading) return null;
  const discriminant = middle ** 2 - 4 * leading * constant;
  if (discriminant <= 0 || !Number.isSafeInteger(discriminant)) return null;
  const root = Math.sqrt(discriminant);
  // An integer factor assignment requires a rational root; for these integer
  // coefficients the discriminant must therefore be a perfect square.
  if (!Number.isSafeInteger(root)) return null;
  const pairs = [(middle - root) / (2 * q), (middle + root) / (2 * q)]
    .map(x => ({ x, y: constant / x }));
  const whole = (value: number) => Math.abs(value - Math.round(value)) < 1e-9;
  if (!pairs.every(pair => pair.x > 0 && pair.y > 0 && Number.isFinite(pair.x + pair.y))) return null;
  const integers = pairs.filter(pair => whole(pair.x) && whole(pair.y));
  const nonintegers = pairs.filter(pair => !whole(pair.x) && !whole(pair.y));
  if (integers.length !== 1 || nonintegers.length !== 1) return null;
  const integerPair = { x: Math.round(integers[0].x), y: Math.round(integers[0].y) };
  const nonintegerPair = nonintegers[0];
  const answer = Number((integerPair.y + nonintegerPair.x).toPrecision(12));
  return { leading, middle, constant, p, q, integerPair, nonintegerPair, answer };
}

/** Recognizes only the complete stated pair of forms, with a unique classification. */
export function twoFactorFormsPlan(question: string): { candidate: Candidate; explanation: Explanation; structure: string } | null {
  const problem = factorForms(question);
  if (!problem) return null;
  const { leading, middle, constant, p, q, integerPair, nonintegerPair, answer } = problem;
  const point = (pair: { x: number; y: number }) => `(${Number(pair.x.toPrecision(12))}, ${Number(pair.y.toPrecision(12))})`;
  const rows = [`xy=${constant}`, `(${p}+x)(${q}+y)=${leading}+${middle}+${constant}`];
  return {
    structure: "Find both factor pairs, then use the integer and noninteger conditions to label the two intersections.",
    candidate: {
      techniqueId: "graph-both-sides", strategy: null, rung: 4,
      rows: rows.map(latex => ({ latex, slider: null, copiesRow: null })),
      answer: String(answer),
      result: {
        type: "intersection", row: 1, relatedRows: [2], value: answer,
        listIndex: null, answerFrom: "reasoning", choiceLabel: null,
        detail: "k is the y-coordinate of the integer intersection; l is the x-coordinate of the noninteger intersection. Add those coordinates.",
      },
      answerState: null, parameters: [], conditionType: null, distinguishes: null,
      graphBounds: { left: 0, right: Math.max(integerPair.x, nonintegerPair.x) * 1.3, bottom: 0, top: Math.max(integerPair.y, nonintegerPair.y) * 1.3 },
      cost: { derivationSteps: 1, newPrimitives: 0, oneOffFacts: 0, setupConstructions: 0, manualIterations: 0 },
    },
    explanation: {
      why: `Use x for the first factor's constant and y for the second factor's constant. The constant term of their product is xy, so it must equal ${constant}. At the original polynomial's variable equal to 1, the same product must equal ${leading}+${middle}+${constant}. Each intersection satisfies both conditions, so clicking both points reveals the two possible factor pairs.`,
      handMath: `Read k=${integerPair.y} from the whole-number point and l=${Number(nonintegerPair.x.toPrecision(12))} from the other point. Add these two displayed coordinates to get ${answer}.`,
      readAnswer: `Click both intersections of lines 1 and 2. The point ${point(integerPair)} has two whole-number coordinates, so its y-coordinate is k=${integerPair.y}. The point ${point(nonintegerPair)} has two noninteger coordinates, so its x-coordinate is l=${Number(nonintegerPair.x.toPrecision(12))}. Add k+l=${answer}.`,
      steps: [
        "Enter both graph lines and click each intersection to reveal its coordinates",
        `Label the whole-number point ${point(integerPair)} as (j,k) and the other point ${point(nonintegerPair)} as (l,m)`,
        `Add the whole-number point's y-coordinate and the other point's x-coordinate: ${integerPair.y}+${Number(nonintegerPair.x.toPrecision(12))}=${answer}`,
      ],
      purposes: [
        `The problem's constant term is ${constant}. The two factor constants multiply to that value, so xy=${constant} graphs the first condition with the first constant as x and the second as y.`,
        `Set the original polynomial's variable to 1. The printed polynomial gives ${leading}+${middle}+${constant}, while the printed factors give (${p}+x)(${q}+y). Graphing this second condition with line 1 finds both factor assignments; the integer conditions tell you which point is (j,k) and which is (l,m).`,
      ],
    },
  };
}

/** Discard fits that never distinguish the two allowed factor assignments. */
export function repairTwoFactorForms(response: CandidatesResponse): CandidatesResponse {
  if (response.status !== "solved") return response;
  const plan = twoFactorFormsPlan(response.question);
  if (!plan || response.choices?.length) return response;
  const alternatives = response.candidates.filter(candidate => {
    const answer = parseNumber(candidate.answer);
    return candidate.rows.length === 0 && answer !== null && Math.abs(answer - plan.candidate.result.value!) < 1e-9;
  });
  return { ...response, structure: plan.structure, candidates: [plan.candidate, ...alternatives].slice(0, 6), preferredTechniqueId: plan.candidate.techniqueId };
}

/** Repair only this recognized pattern on cache reads, without invalidating other solves. */
export function repairCachedTwoFactorForms(entry: CacheEntry): CacheEntry {
  if (entry.choices?.length || entry.retryOf !== null) return entry;
  const plan = twoFactorFormsPlan(entry.question);
  if (!plan) return entry;
  const selection = selectMethods(repairTwoFactorForms({
    status: "solved", question: entry.question, choices: entry.choices,
    structure: plan.structure, clarification: null, library: { matched: [], skipped: [] },
    candidates: entry.methods.filter(method => !method.rejected && method.rows.length === 0).map(method => ({
      techniqueId: method.techniqueId, strategy: null, rung: 2, rows: [],
      answer: method.answer, result: method.result, answerState: method.answerState,
      parameters: method.parameters, conditionType: method.conditionType,
      distinguishes: method.distinguishes, graphBounds: method.graphBounds, cost: method.cost,
    })), preferredTechniqueId: null,
  }));
  return { ...entry, structure: selection.structure, methods: selection.methods, winnerId: selection.winnerId, modelPreference: selection.modelPreference };
}
