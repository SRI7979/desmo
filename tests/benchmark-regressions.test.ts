/**
 * Regressions from the live representative benchmark (evals/results/current.json):
 * each test replays what the model actually returned for one case.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test, mock } from "node:test";
import OpenAI from "openai";

import {
  isApproximationQuestion,
  isWholeNumberQuestion,
  matchChoice,
  normalizeChoices,
  ProseLatexError,
  repairProseText,
  sanitizeProse,
} from "../src/lib/answer-consistency";
import { unwrapCaption } from "../src/lib/desmos-latex";
import { createMemorySolveCache } from "../src/lib/solve-cache";
import { validateCandidatesResponse } from "../src/lib/solve-output";
import { createTrace, solveProblem, type PipelineDeps } from "../src/lib/solve-pipeline";
import { checkConditionCompleteness } from "../src/lib/solver-rules";
import {
  desmosRescueTarget,
  isLiteralArithmetic,
  isSolutionCountCondition,
  selectMethods,
  StrategySelectionError,
  type CandidatesResponse,
  type CandidatesResponseInput,
} from "../src/lib/strategy-selection";
import { candidatesResponse, explanation, graphCandidate, mockModel, providerBody } from "./method-fixtures";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

function deps(): PipelineDeps {
  return {
    client: new OpenAI({ apiKey: "unit-test-key", maxRetries: 0 }),
    cache: createMemorySolveCache(),
    context: { model: "gpt-5-mini", candidateInstructions: "test", version: "test-version" },
    tier: { priorityUnavailable: false },
    diagnosticId: "benchmark-regression",
    trace: createTrace(),
  };
}

afterEach(() => {
  mock.restoreAll();
});

// --- 074: a transcribed 10\pi failed the whole solve ---------------------------

const ARC_PROBLEM = "A circle has a radius of 12 centimeters. An arc of the circle has a length of 10pi centimeters. What is the measure, in degrees, of the central angle that intercepts this arc?";

test("074: symbol commands with an exact plain equivalent repair to that character", () => {
  assert.equal(repairProseText("an arc of length 10\\pi centimeters"), "an arc of length 10π centimeters");
  assert.equal(repairProseText("an angle of 30^{\\circ} and 45^\\circ"), "an angle of 30° and 45°");
  assert.equal(repairProseText("x \\le 5 and y \\geq 2, x \\neq 0"), "x ≤ 5 and y ≥ 2, x ≠ 0");
  assert.equal(repairProseText("(f \\circ g)(x) = 3 \\times 4"), "(f ∘ g)(x) = 3 × 4");
  assert.equal(repairProseText("\\theta = \\frac{5\\pi}{6}"), "θ = 5π/6");
  assert.equal(repairProseText("an increase of 20\\%"), "an increase of 20%");
});

test("074: LaTeX with no plain equivalent is still rejected, so validation is not weakened", () => {
  assert.throws(() => sanitizeProse("segment \\overline{AB} has length 4", "question"), ProseLatexError);
  assert.throws(() => sanitizeProse("\\int_0^1 x dx", "why"), ProseLatexError);
  // An unknown command that merely starts with a symbol's name is not that symbol.
  assert.throws(() => sanitizeProse("\\pir^2", "why"), ProseLatexError);
});

test("074: the transcribed question is repaired at selection, where call 1 owns it", () => {
  const selection = selectMethods(fixture("arc-length-pi-candidates.json") as CandidatesResponse);
  assert.match(selection.question, /length of 10π centimeters/);
  assert.doesNotMatch(selection.question, /\\/);
});

test("074: an unrepairable transcription is corrected by call 1, not failed at the explanation", () => {
  assert.throws(
    () => selectMethods(candidatesResponse([graphCandidate()], { question: "Segment \\overline{AB} has length x where x^2 = 9. What is x?" }) as CandidatesResponse),
    (error: unknown) => error instanceof StrategySelectionError && error.stage === "prose_text",
  );
});

test("074: the recorded arc-length output solves with one explanation call, and the fallback cannot fail", async () => {
  const recorded = fixture("arc-length-pi-candidates.json");
  const winner = selectMethods(recorded as CandidatesResponse).methods[0];
  const { requests } = mockModel({ candidates: recorded, explanation: explanation(winner.rows.length) });
  const result = await solveProblem(deps(), { kind: "text", problem: ARC_PROBLEM, choices: null });
  assert.equal(result.kind, "solved");
  assert.ok(result.kind === "solved");
  assert.equal(result.solution.answer, "150");
  assert.equal(result.explanation, "model");
  assert.equal(requests.explanation.length, 1, "no explanation retry is spent on the question's own math");
  assert.match(result.solution.question, /10π/);

  mock.restoreAll();
  mockModel({ candidates: recorded, explanation: Response.json({ error: { code: "server_error", message: "down" } }, { status: 500 }) });
  const fallback = await solveProblem(deps(), { kind: "text", problem: ARC_PROBLEM, choices: null });
  assert.ok(fallback.kind === "solved");
  assert.equal(fallback.explanation, "fallback");
  assert.equal(fallback.solution.answer, "150");
});

// --- Defaults, retries, and rescues from the same run --------------------------

const recorded: Record<string, CandidatesResponseInput> = fixture("live-benchmark-first-attempts.json");
const caseOutput = (prefix: string) => {
  const key = Object.keys(recorded).find((id) => id.startsWith(prefix));
  assert.ok(key, `fixture for ${prefix}`);
  return recorded[key];
};
/** Selection exactly as call 1 runs it: metadata repairs, then validation and scoring. */
function selectRecorded(prefix: string) {
  const { parsed } = validateCandidatesResponse(providerBody(caseOutput(prefix)));
  return selectMethods(parsed);
}
const eligible = (selection: ReturnType<typeof selectMethods>) => selection.methods.filter((method) => !method.rejected);
const winnerOf = (prefix: string) => eligible(selectRecorded(prefix))[0];

test("040/041: a slider that opens at the answer with both equations graphed proves no solution / infinitely many", () => {
  const graphs = [{ latex: "k=0" }, { latex: "4x-ky=9" }, { latex: "6x+15y=2" }];
  const slider = { type: "slider_condition" as const, row: 1, relatedRows: [2, 3], value: null, listIndex: null, answerFrom: "reasoning" as const, choiceLabel: null, detail: "k where the lines are parallel" };
  assert.deepEqual(
    checkConditionCompleteness({ conditionType: "no-solution", distinguishes: null, result: slider, answerState: { param: "k", value: -10 }, expressions: graphs }),
    { distinguishes: "visual-parallel-vs-overlap" },
  );
  // Still rejected: no answerState (the slider opens elsewhere), or a slider that moves neither graph.
  const unopened = checkConditionCompleteness({ conditionType: "no-solution", distinguishes: null, result: slider, answerState: null, expressions: graphs });
  assert.ok(unopened && "error" in unopened);
  const unrelated = checkConditionCompleteness({ conditionType: "no-solution", distinguishes: null, result: slider, answerState: { param: "a", value: 3 }, expressions: [{ latex: "a=0" }, ...graphs.slice(1)] });
  assert.ok(unrelated && "error" in unrelated);

  // 040 was rejected outright and retried; 041 fell back to the memorized ratio rule.
  assert.equal(winnerOf("040").techniqueId, "slider-condition");
  assert.equal(winnerOf("041").techniqueId, "slider-condition");
});

test("037/041/010: a paper method that decides how many solutions there are pays for the solution-count rule", () => {
  assert.equal(isSolutionCountCondition("|2x + 6| = 3k - 12. In the given equation, k is a constant. If the equation has exactly one solution, what is the value of k?"), true);
  assert.equal(isSolutionCountCondition("How many solutions does x^2 = 4x have?"), false);
  const paper = eligible(selectRecorded("037")).find((method) => method.techniqueId === "direct-arithmetic")!;
  assert.equal(paper.cost.oneOffFacts, 1);
  assert.equal(winnerOf("037").techniqueId, "slider-condition");
  // 010's paper candidates said "numeric" with no rows: repaired to written, so no retry is spent.
  assert.equal(winnerOf("010").techniqueId, "direct-arithmetic");
});

test("033: the slope formula typed over the table's numbers is a memorized fact; three points on a line are a linear fit", () => {
  const selection = eligible(selectRecorded("033"));
  const slopeFormula = selection.find((method) => method.techniqueId === "intercept-read")!;
  assert.equal(slopeFormula.cost.oneOffFacts, 1);
  const fit = selection[0];
  assert.equal(fit.techniqueId, "linear-regression", "relabeled from three-point-regression");
});

test("039: on a representation question, paper direct arithmetic is the translation, listed once", () => {
  const selection = selectRecorded("039");
  assert.deepEqual(eligible(selection).map((method) => method.techniqueId), ["translate-the-words"]);
  assert.ok(selection.methods.some((method) => method.id === "translate-the-words#3" && method.rejected?.rule === "duplicate-technique"));
  assert.ok(!selection.methods.some((method) => method.techniqueId === "direct-arithmetic"));
});

test("060/061/067: the technique the rows visibly use wins a tie, and scalar rows are calculator arithmetic", () => {
  assert.equal(winnerOf("060").techniqueId, "statistics-builtin");
  assert.equal(winnerOf("061").techniqueId, "statistics-builtin");
  const weighted = eligible(selectRecorded("067"));
  assert.equal(weighted[0].techniqueId, "statistics-builtin");
  // T=24*81+16*86 then T/40 evaluates no function: it is calculator arithmetic, whose setup is a step.
  const arithmetic = weighted.find((method) => method.techniqueId === "calculator-arithmetic")!;
  assert.equal(arithmetic.cost.derivationSteps, 1, "the student still sets up 24*81+16*86 over 40");
});

test("065: an approximation question matches the clearly nearest choice, and only then", () => {
  const choices = normalizeChoices(["15", "19", "23", "27"].map((text, index) => ({ label: "ABCD"[index], text })))!;
  assert.equal(matchChoice(19.046, choices), null, "exact questions keep the strict match");
  assert.equal(matchChoice(19.046, choices, true)?.label, "B");
  assert.equal(matchChoice(21, choices, true), null, "halfway between two choices is never guessed");
  assert.equal(isApproximationQuestion("Based on a line of best fit, approximately how many minutes after the tank began draining will the tank be empty?"), true);
  assert.ok(eligible(selectRecorded("065")).some((method) => method.techniqueId === "linear-regression"), "the fitted line is no longer rejected");
});

test("042/061/071/073: contract slips are repaired locally, so no rescue call is spent", () => {
  for (const prefix of ["042", "061", "071", "073"]) {
    assert.equal(desmosRescueTarget(selectRecorded(prefix)), null, prefix);
  }
  assert.equal(winnerOf("042").techniqueId, "graph-inequality");
  assert.deepEqual(winnerOf("073").rows.map((row) => row.latex), ["a=\\sqrt{29^{2}-20^{2}}", "20/a"]);
  assert.equal(winnerOf("071").rows[2].latex, "\\frac{1}{2}d_{1}d_{2}");
  assert.equal(unwrapCaption("\\operatorname{mean}=3"), null, "a built-in is not a caption");
  assert.equal(unwrapCaption("\\sin x=0.5"), null, "an equation in a graph coordinate is not a caption");
  assert.equal(unwrapCaption("\\tan(S)=20/a"), "20/a");
});

test("010/040: the recorded first attempts solve with a single candidates call", async () => {
  for (const [prefix, problem] of [
    ["010", "The system of equations gx - 3y = 15 and 8x - ky = 60 has infinitely many solutions, where g and k are constants. What is the value of g/k?"],
    ["040", "4x - ky = 9\n6x + 15y = 2\nIn the given system of equations, k is a constant. If the system has no solution, what is the value of k?"],
  ] as const) {
    mock.restoreAll();
    const winner = winnerOf(prefix);
    const { requests } = mockModel({ candidates: caseOutput(prefix), explanation: explanation(winner.rows.length) });
    const result = await solveProblem(deps(), { kind: "text", problem, choices: null });
    assert.ok(result.kind === "solved", prefix);
    assert.equal(requests.candidates.length, 1, `${prefix}: no validation retry`);
    assert.equal(result.method.techniqueId, winner.techniqueId);
  }
});

// --- From the run after the first round of fixes ------------------------------

const secondRun: Record<string, CandidatesResponseInput> = fixture("live-benchmark-later-runs.json");
const secondOutput = (prefix: string) => secondRun[Object.keys(secondRun).find((id) => id.startsWith(prefix))!] ?? secondRun[prefix];
const selectSecond = (prefix: string) => selectMethods(validateCandidatesResponse(providerBody(secondOutput(prefix))).parsed);

test("063: a filtered choice list's entry 1 is the value it shows, not choice A", () => {
  // A[cost=A] displays [1080]; the model reported entry 1 as a choice position,
  // which read as A) $360 although the value and its own label both said B.
  const listing = selectSecond("063").methods.find((method) => method.techniqueId === "answer-choice-list")!;
  assert.equal(listing.rejected, null);
  assert.equal(listing.answer, "B) $1,080");
  assert.equal(listing.result.answerFrom, "value");
  assert.equal(listing.result.listIndex, 1, "entry 1 of the filtered list is what Desmos shows");
});

test("063: an aligned choice list still selects by position when its value is not a choice", () => {
  const response = candidatesResponse([
    graphCandidate({
      techniqueId: "answer-choice-list",
      rows: [{ latex: "A=[2,4,6,8]", slider: null, copiesRow: null }, { latex: "A^{2}-36", slider: null, copiesRow: null }],
      answer: "C) 6",
      result: { type: "list_entry", row: 2, relatedRows: [1], value: 0, listIndex: 3, answerFrom: "choice_position", choiceLabel: "C", detail: "the entry that is zero" },
    }),
  ], { question: "What is the positive solution to x^2 = 36?", choices: ["2", "4", "6", "8"].map((text, index) => ({ label: "ABCD"[index], text })) });
  const method = eligible(selectMethods(response as CandidatesResponse))[0];
  assert.equal(method.answer, "C) 6");
  assert.equal(method.result.answerFrom, "choice_position");
});

test("033: a fit read at its graphed x-intercept is the linear regression, kept over a costlier -b/m listing", () => {
  const selection = selectSecond("033");
  const fits = eligible(selection).filter((method) => method.techniqueId === "linear-regression");
  assert.equal(fits.length, 1);
  assert.equal(eligible(selection)[0].techniqueId, "linear-regression");
  assert.equal(fits[0].result.type, "intersection", "the clicked-intercept version, not -b/m");
  assert.ok(selection.methods.some((method) => method.rejected?.rule === "duplicate-technique"));
});

test("073: a caption Desmos cannot define is removed from any row nothing references", () => {
  const listing = eligible(selectSecond("073")).find((method) => method.techniqueId === "answer-choice-list")!;
  assert.equal(listing.rows[1].latex, "20/\\sqrt{29^2-20^2}");
  // A caption another row uses is a name, so it is left for the undefined-name check.
  const named = selectMethods(candidatesResponse([graphCandidate({
    techniqueId: "integer-list-filter",
    rows: [{ latex: "M=[0...300]", slider: null, copiesRow: null }, { latex: "\\operatorname{ok}=M[95+1.85M\\le300]", slider: null, copiesRow: null }, { latex: "\\operatorname{max}(\\operatorname{ok})", slider: null, copiesRow: null }],
    answer: "110",
    result: { type: "numeric", row: 3, relatedRows: [], value: 110, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "the greatest allowed m" },
  })], { question: "A move costs $95 plus $1.85 per mile, with at most $300 to spend. What is the greatest whole number of miles?" }) as CandidatesResponse);
  assert.equal(named.methods[0].rows[1].latex, "\\operatorname{ok}=M[95+1.85M\\le300]");
});

test("036: a clicked boundary of 110.81 never replaces the whole-number answer 110 the question asks for", () => {
  const graph = selectSecond("036").methods.find((method) => method.techniqueId === "graph-both-sides")!;
  assert.equal(graph.rejected, null);
  assert.equal(graph.answer, "110");
  assert.equal(isWholeNumberQuestion("What is the greatest whole number of miles the company can drive for Dana's move without exceeding her budget?"), true);
  // Without a whole-number question the calculator's value still wins over a disagreeing stated answer.
  const plain = selectMethods(candidatesResponse([graphCandidate({ answer: "4", result: { ...graphCandidate().result, value: 3 } })]) as CandidatesResponse);
  assert.equal(plain.methods[0].answer, "3");
});

test("010: a given-ratio question reads g/k from the scale factor, so it is not charged a solution-count fact or rescued", () => {
  // The rescue replaced this gold paper method with bracket regression for 26 s
  // only because the fact made a rejected slider candidate look cheaper.
  const selection = selectSecond("010");
  const paper = eligible(selection)[0];
  assert.equal(paper.techniqueId, "direct-arithmetic");
  assert.equal(paper.cost.oneOffFacts, 0);
  assert.equal(desmosRescueTarget(selection), null);
});

test("040: a slider readout that lists the slider row among its graphs still proves no solution", () => {
  // relatedRows [1, 2, 3] named the slider k=0 itself; the slider was rejected on
  // the first attempt and again after a 24 s rescue, leaving paper elimination.
  const selection = selectSecond("040");
  assert.equal(eligible(selection)[0].techniqueId, "slider-condition");
  assert.equal(desmosRescueTarget(selection), null);
});

test("048: 'to the nearest whole number' with choices matches 644.43 to 644, so the gold evaluation is not rejected", () => {
  assert.equal(isApproximationQuestion("According to the model, how many subscribers, to the nearest whole number, did the newsletter have 10 weeks after it launched?"), true);
  assert.equal(eligible(selectSecond("048"))[0].techniqueId, "function-evaluation");
});

test("065: a fitted line graphed and read at its x-intercept is the linear regression; a bracket system is not", () => {
  const selection = selectSecond("065");
  const fit = eligible(selection)[0];
  assert.equal(fit.techniqueId, "linear-regression");
  assert.ok(!fit.rows.some((row) => row.latex === "-b/m"), "the graphed readout is kept over the -b/m formula");
  const system = selectMethods(candidatesResponse([graphCandidate({
    techniqueId: "graph-both-sides",
    rows: [{ latex: "[2a+3b,a+b]\\sim[19,8]", slider: null, copiesRow: null }, { latex: "a", slider: null, copiesRow: null }],
    answer: "5",
    result: { type: "numeric", row: 2, relatedRows: [], value: 5, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "a" },
  })], { question: "If 2a + 3b = 19 and a + b = 8, what is a?" }) as CandidatesResponse);
  assert.equal(system.methods[0].techniqueId, "graph-both-sides", "a bracket regression is not a linear fit");
});

test("050: at equal cost, the method that works without the choices beats a choice list wrapped around it", () => {
  // A=[-3,-2,1,3] beside f(g(4)) tied the gold function evaluation on every
  // measure and won on the technique id's alphabetical order.
  const selection = eligible(selectSecond("050"));
  assert.equal(selection[0].techniqueId, "function-evaluation");
  assert.ok(selection.some((method) => method.techniqueId === "answer-choice-list"), "still listed as an alternative");
});

test("063: a choice label carrying the start of its text (\"B) $\") is that letter, so the filtered entry reads as B", () => {
  // The same filter as before, but with choiceLabel "B) $": the label matched
  // no choice, so entry 1 of the filtered list was read as choice A) $360.
  const selection = selectMethods(validateCandidatesResponse(providerBody(secondRun["063-square-feet-to-square-yards-cost#ab-1"])).parsed);
  for (const method of eligible(selection)) assert.equal(method.answer, "B) $1,080", method.techniqueId);
});

test("063: a choice list does not make the computation it wraps free", () => {
  assert.equal(isLiteralArithmetic("cost=18(540)/3^2"), true);
  assert.equal(isLiteralArithmetic("\\frac{V}{\\pi}"), false, "a variable");
  assert.equal(isLiteralArithmetic("C=[360,1080,3240,9720]"), false, "a list of the choices");
  assert.equal(isLiteralArithmetic("\\operatorname{distance}((2,-3),(2,5))"), false, "a built-in does the setup");
  assert.equal(isLiteralArithmetic("y=391"), false, "one number");
  // C=[...], cost=18(540)/3^2, C[C=cost] cost 3 against 18(540)/3^2 alone at 4:
  // the same setup now costs the same, and the lookup's extra rows lose.
  const selection = eligible(selectMethods(validateCandidatesResponse(providerBody(secondRun["063-square-feet-to-square-yards-cost#ab-1"])).parsed));
  assert.equal(selection[0].techniqueId, "calculator-arithmetic");
});
