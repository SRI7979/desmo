/**
 * Desmos first, math last: a Desmos way is the default whenever one passes,
 * the list offers the Desmos ways and one math way, a math-way default gets one
 * call asking for the Desmos angle, and any hand step a Desmos way still needs
 * is named for the student. Plus the two failures that prompted this: the
 * quadratic-root question (real wording, "a and b are integers") and the
 * rational-function table read as g(1)=15.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, mock, test } from "node:test";
import OpenAI from "openai";

import { findUntranscribedListValues } from "../src/lib/desmos-latex";
import { parseLibraryIndex } from "../src/lib/library-trace";
import { ExplanationError, fallbackExplanation, needsHandMath, presentMethod, validateExplanationQuality } from "../src/lib/method-presentation";
import { repairQuadraticRationalIntercept } from "../src/lib/semantic-repairs";
import { createMemorySolveCache, type CacheEntry } from "../src/lib/solve-cache";
import { createTrace, solveProblem, type PipelineDeps } from "../src/lib/solve-pipeline";
import { findIntegerParameterViolations } from "../src/lib/solver-rules";
import {
  asksForDeterminedValue,
  candidatesResponseSchema,
  desmosRescueTarget,
  findTranscriptionConflicts,
  planApproach,
  rescueReason,
  selectMethods,
  StrategySelectionError,
  type CandidatesResponseInput,
} from "../src/lib/strategy-selection";
import { candidatesResponse, explanation, graphCandidate, mockModel, paperCandidate, zeroCost } from "./method-fixtures";

type Candidate = CandidatesResponseInput["candidates"][number];

const row = (latex: string) => ({ latex, slider: null, copiesRow: null });
const numeric = (rowNumber: number, value: number, detail: string, choiceLabel: string | null = null): Candidate["result"] => ({
  type: "numeric", row: rowNumber, relatedRows: [], value, listIndex: null, answerFrom: "value", choiceLabel, detail,
});
const written = (detail: string, choiceLabel: string | null = null): Candidate["result"] => ({
  type: "written", row: null, relatedRows: [], value: null, listIndex: null, answerFrom: "reasoning", choiceLabel, detail,
});

/** The question exactly as the student's screenshot states it. */
const QUADRATIC = "3x^2 - 16x + 2 = 0. One solution to the given equation can be written as (a + sqrt(b))/6, where a and b are integers. What is the value of a + b?";
const QUADRATIC_CHOICES = [{ label: "A", text: "66" }, { label: "B", text: "132" }, { label: "C", text: "248" }, { label: "D", text: "296" }];

const goldWay = (): Candidate =>
  graphCandidate({
    techniqueId: "parameter-regression",
    strategy: 78,
    rung: 4,
    rows: [row("3x^{2}-16x+2"), row("[(a+\\sqrt{b})/6,(a-\\sqrt{b})/6]\\sim[5.20526,0.128073]"), row("a+b")],
    answer: "C) 248",
    result: numeric(3, 248, "a + b from both fitted parameters", "C"),
    graphBounds: null,
    cost: { ...zeroCost },
  });
const typedDiscriminant = (): Candidate =>
  graphCandidate({
    techniqueId: "calculator-arithmetic",
    strategy: 77,
    rung: 2,
    rows: [row("D=(-16)^2-4(3)(2)"), row("16+D")],
    answer: "C) 248",
    result: numeric(2, 248, "a + b", "C"),
    graphBounds: null,
    cost: { ...zeroCost },
  });
const formula = (): Candidate =>
  paperCandidate({ techniqueId: "quadratic-formula", strategy: null, answer: "C) 248", result: written("16 + 232 from (16 ± √232)/6", "C"), cost: { ...zeroCost, derivationSteps: 3, oneOffFacts: 1 } });

const quadraticResponse = (candidates: Candidate[]) =>
  candidatesResponse(candidates, { question: QUADRATIC, choices: QUADRATIC_CHOICES, structure: "A quadratic whose root is given in a radical form with integer constants." });
const select = (input: CandidatesResponseInput) => selectMethods(candidatesResponseSchema.parse(input));

afterEach(() => mock.restoreAll());

test("the real quadratic-root question: fitting both clicked roots survives 'a and b are integers' and is the default", () => {
  const selection = select(quadraticResponse([formula(), typedDiscriminant(), goldWay()]));
  const listed = selection.methods.filter((method) => !method.rejected);
  assert.equal(selection.winnerId, "parameter-regression");
  assert.deepEqual(listed.map((method) => [method.techniqueId, method.approach]), [["parameter-regression", "desmos"], ["calculator-arithmetic", "math"]]);
  assert.equal(listed[1].cost.oneOffFacts, 1, "the typed discriminant is charged the quadratic formula");
  assert.equal(selection.methods.find((method) => method.techniqueId === "quadratic-formula")?.rejected?.rule, "extra-math-way");
  assert.equal(listed[0].answer, "C) 248");
});

test("an integer unknown may be fitted when the question asks for one determined value, never for 'could be' or an extreme", () => {
  const fitted = [{ latex: "[(a+\\sqrt{b})/6,(a-\\sqrt{b})/6]\\sim[5.20526,0.128073]" }];
  const integers = [{ name: "a", integer: true, min: -1000, max: 1000 }, { name: "b", integer: true, min: -1000, max: 1000 }];
  assert.deepEqual(findIntegerParameterViolations(fitted, integers), [{ row: 1, param: "a" }, { row: 1, param: "b" }], "strict by default");
  assert.deepEqual(findIntegerParameterViolations(fitted, integers, { determinedValue: true, fixedValuesAllowed: true }), []);
  assert.deepEqual(findIntegerParameterViolations([{ latex: "y_{1}\\sim ax_{1}\\left\\{a>1\\right\\}" }], integers, { determinedValue: true }), [{ row: 1, param: "a" }], "an inequality restriction still cannot pin an integer");
  assert.deepEqual(findIntegerParameterViolations([{ latex: "q=7", slider: { min: 0, max: 20, step: 0.5 } }], [{ name: "q", integer: true, min: 0, max: 20 }], { fixedValuesAllowed: true }), [{ row: 1, param: "q" }], "a dragged slider still needs step 1");
  assert.equal(asksForDeterminedValue(QUADRATIC), true);
  for (const question of ["Which of the following could be the value of a + b?", "What is the greatest possible value of k?", "How many integer values of k work?", "Which is NOT a possible value of k?"]) {
    assert.equal(asksForDeterminedValue(question), false, question);
  }
});

test("Desmos used as a calculator is the math way, whatever the technique is called", () => {
  assert.equal(planApproach("answer-choice-list", [row("C=[360,1080,3240,9720]"), row("cost=18(540)/3^2"), row("C[C=cost]")]), "math");
  assert.equal(planApproach("answer-choice-list", [row("C=[66,132,248,296]"), row("f(x)=3x^2-16x+2"), row("f(C)")]), "desmos");
  assert.equal(planApproach("calculator-arithmetic", [row("18(540)/3^2")]), "math");
  assert.equal(planApproach("parameter-regression", goldWay().rows), "desmos");
  assert.equal(planApproach("quadratic-formula", []), "math");
});

test("a math-way default asks once for a Desmos way, naming the library strategies the wording points to", async () => {
  const onlyMath = select(quadraticResponse([formula()]));
  const target = desmosRescueTarget(onlyMath);
  assert.equal(target?.winner.techniqueId, "quadratic-formula");
  assert.deepEqual(target?.candidates, []);
  assert.match(rescueReason(target!, "strategies 61, 78 teach parameter-regression"), /You listed no Desmos way[\s\S]*strategies 61, 78 teach parameter-regression[\s\S]*including the math way/);
  // Translating the words has no Desmos way to find.
  const translation = select(candidatesResponse([paperCandidate({ techniqueId: "translate-the-words", answer: "B", result: written("the model", "B") })], {
    question: "Which equation represents the total cost c of x pounds at 3 dollars per pound plus a 2 dollar fee?",
    choices: [{ label: "A", text: "c = 2x + 3" }, { label: "B", text: "c = 3x + 2" }],
  }));
  assert.equal(desmosRescueTarget(translation), null);

  const index = parseLibraryIndex(await readFile(path.join(process.cwd(), "src/content/desmos-tricks.md"), "utf8"));
  const { requests } = mockModel({
    candidates: (_body: Record<string, unknown>, call: number) => (call === 1 ? quadraticResponse([formula()]) : quadraticResponse([goldWay(), formula()])),
    explanation: explanation(3),
  });
  const deps: PipelineDeps = {
    client: new OpenAI({ apiKey: "unit-test-key", maxRetries: 0 }),
    cache: createMemorySolveCache(),
    context: { model: "gpt-5-mini", candidateInstructions: "test", version: "test-version", libraryIndex: index },
    tier: { priorityUnavailable: false },
    diagnosticId: "desmos-first",
    trace: createTrace(),
  };
  const result = await solveProblem(deps, { kind: "text", problem: QUADRATIC, choices: QUADRATIC_CHOICES.map((choice) => choice.text) });
  assert.equal(result.kind, "solved");
  if (result.kind !== "solved") return;
  assert.equal(result.rescue, "applied");
  assert.equal(result.method.techniqueId, "parameter-regression");
  assert.deepEqual(result.resolved.methods.map((method) => method.approach), ["desmos", "math"]);
  assert.equal(requests.candidates.length, 2);
  assert.match(JSON.stringify(requests.candidates[1].input), /You listed no Desmos way/);
  assert.match(JSON.stringify(requests.candidates[1].input), /78 teach parameter-regression/);
  assert.equal(result.solution.handMath, null);
});

test("a Desmos way with a hand step names it; a pure-Desmos method shows no math line", () => {
  const selection = select(quadraticResponse([goldWay(), formula()]));
  const gold = selection.methods[0];
  const entry: CacheEntry = {
    version: 1, cacheKey: "k", promptConfigVersion: "v", question: selection.question, choices: selection.choices, structure: null,
    methods: selection.methods, winnerId: selection.winnerId, modelPreference: null, retryOf: null, createdAt: new Date(0).toISOString(),
  };
  assert.equal(needsHandMath(gold), false);
  assert.equal(presentMethod(entry, gold, explanation(3)).handMath, null);

  const handWorked = { ...gold, cost: { ...gold.cost, derivationSteps: 1 } };
  const without = explanation(3);
  assert.throws(() => validateExplanationQuality(handWorked, without), (error: unknown) => error instanceof ExplanationError && /handMath must name each one/.test(error.message));
  const named = explanation(3, { handMath: "Choose the plus form for the larger root and the minus form for the smaller root." });
  validateExplanationQuality(handWorked, named);
  assert.equal(presentMethod(entry, handWorked, named).handMath, "Choose the plus form for the larger root and the minus form for the smaller root.");
  assert.match(fallbackExplanation(handWorked).handMath ?? "", /done by hand/);

  const pure = select(candidatesResponse([graphCandidate()])).methods[0];
  assert.equal(needsHandMath(pure), false);
  const pureEntry = { ...entry, question: "What is the positive solution to x² = 9?", choices: null, methods: [pure], winnerId: pure.id };
  assert.equal(presentMethod(pureEntry, pure, explanation(1, { handMath: "None." })).handMath, null, "Desmos does all of it");
  assert.equal(presentMethod(pureEntry, pure, explanation(1)).handMath, null);
  assert.equal(presentMethod(pureEntry, pure, explanation(1, { handMath: "Type 9 from the equation." })).handMath, "Type 9 from the equation.", "a decision the student makes is still named");
});

// --- The rational-function table ------------------------------------------------

/** The transcription the model actually wrote for the screenshot: correct, in a format the repair once could not read. */
const RATIONAL =
  "The function g is a rational function defined by g(x)=f(x)/(x+2), where f is a quadratic function. The y-intercept of the graph of f is (0,10), and g passes through the points shown in the table below. What is the value of g(3)?\n\nTable: x: 1 → g(x)=5; x: 4 → g(x)=7";

/** What the model proposed: a three-point fit over f-values it computed itself (5·3=15, 7·6=42). */
const handComputedFit = (): Candidate =>
  graphCandidate({
    techniqueId: "three-point-regression",
    rung: 4,
    rows: ["x_{1}=[0,1,4]", "y_{1}=[10,15,42]", "y_{1}\\sim ax_{1}^2+bx_{1}+c", "f(x)=ax^2+bx+c", "g(x)=f(x)/(x+2)", "g(3)"].map(row),
    answer: "31/5",
    result: numeric(6, 6.2, "g(3)"),
    graphBounds: null,
  });

test("the rational-function table is read from the transcription as printed: y_1=[5,7] and g(3)=6.2, never the model's computed f-values", () => {
  const response = candidatesResponseSchema.parse(candidatesResponse([handComputedFit()], { question: RATIONAL }));
  const repaired = repairQuadraticRationalIntercept(response);
  assert.equal(repaired.question, RATIONAL, "the transcription is never rewritten");
  const selection = selectMethods(repaired);
  const regression = selection.methods.find((method) => method.techniqueId === "parameter-regression")!;
  assert.equal(regression.rows[2].latex, "y_{1}=[5,7]");
  assert.equal(regression.answer, "6.2");
  assert.equal(selection.winnerId, "parameter-regression");
  const computed = selection.methods.find((method) => method.techniqueId === "three-point-regression")!;
  assert.equal(computed.rejected?.rule, "hidden-derivation", "15 and 42 are not in the question");
});

test("two different values for the same table cell stop the solve with a reason the model can act on", () => {
  const contaminated = `${RATIONAL}\nTable values: g(1)=15; g(4)=42.`;
  assert.deepEqual(findTranscriptionConflicts(contaminated), [{ name: "g", input: 1, values: [5, 15] }, { name: "g", input: 4, values: [7, 42] }]);
  assert.deepEqual(findTranscriptionConflicts(RATIONAL), []);
  assert.deepEqual(findTranscriptionConflicts("g(1)=5; g(4)=7. What is g(3)?"), []);
  const response = candidatesResponseSchema.parse(candidatesResponse([handComputedFit()], { question: contaminated }));
  assert.throws(() => repairQuadraticRationalIntercept(response), (error: unknown) => error instanceof StrategySelectionError && error.stage === "transcription_conflict");
  assert.throws(
    () => selectMethods(candidatesResponseSchema.parse(candidatesResponse([graphCandidate()], { question: "f(2)=3 and f(2)=5. What is the positive solution to x² = 9?" }))),
    (error: unknown) => error instanceof StrategySelectionError && error.stage === "transcription_conflict" && /f\(2\) \(3 and 5\)/.test(error.message),
  );
});

test("a data list must hold the question's numbers exactly as printed, at any size", () => {
  const question = "g passes through g(1)=5 and g(4)=7, and f(0)=10.";
  const fit = { latex: "y_{1}\\sim\\frac{f(x_{1})}{x_{1}+2}" };
  assert.deepEqual(findUntranscribedListValues([{ latex: "x_{1}=[1,4]" }, { latex: "y_{1}=[5,7]" }, fit], question, null), []);
  assert.deepEqual(findUntranscribedListValues([{ latex: "y_{1}=[15,42]" }, fit], question, null), [{ row: 1, constants: [15, 42] }]);
  assert.deepEqual(findUntranscribedListValues([{ latex: "y_{1}=[6,8]" }, fit], question, null), [{ row: 1, constants: [6, 8] }], "small computed values count too");
  // Sample inputs plugged into both sides of an identity are free choices, not data.
  const circle = [{ latex: "x_{1}=[0,1,0,2,-1,3]" }, { latex: "y_{1}=[0,0,1,2,3,-1]" }, { latex: "x_{1}^2+y_{1}^2-6x_{1}+4y_{1}-12\\sim(x_{1}-h)^2+(y_{1}-k)^2-q" }];
  assert.deepEqual(findUntranscribedListValues(circle, "x^2 + y^2 - 6x + 4y - 12 = 0. What is the radius?", null), []);
  assert.deepEqual(findUntranscribedListValues([{ latex: "x_{1}=[1,2,3,4,5]" }, { latex: "y_{1}=[1,2,3,4,5]" }, { latex: "y_{1}\\sim ax_{1}+b" }], question, null), [], "consecutive integers are inputs");
  assert.deepEqual(findUntranscribedListValues([{ latex: "C=[66,132,248,296]" }, { latex: "C\\sim 3k" }], QUADRATIC, QUADRATIC_CHOICES), [], "the choices are given numbers");
});

test("a decimal typed after a graph is a clicked point, and the explanation call is told so", async () => {
  const { clickedValues, explanationInput } = await import("../src/lib/method-presentation");
  assert.deepEqual(clickedValues(QUADRATIC, goldWay().rows), [{ row: 2, value: "5.20526" }, { row: 2, value: "0.128073" }]);
  assert.deepEqual(clickedValues("A price of 1.15 per pound.", [row("y=1.15x"), row("1.15(4)")]), [], "a stated decimal is a given");
  assert.deepEqual(clickedValues(QUADRATIC, [row("a=5.20526")]), [], "nothing was graphed to click");
  const selection = select(quadraticResponse([goldWay(), formula()]));
  const entry: CacheEntry = {
    version: 1, cacheKey: "k", promptConfigVersion: "v", question: selection.question, choices: selection.choices, structure: null,
    methods: selection.methods, winnerId: selection.winnerId, modelPreference: null, retryOf: null, createdAt: new Date(0).toISOString(),
  };
  assert.match(explanationInput(entry, selection.methods[0]), /Line 2 types 5\.20526[\s\S]*clicking the matching point[\s\S]*Line 2 types 0\.128073[\s\S]*clicking the matching point[\s\S]*never a hand computation/);
});

test("THE IDEA of a Desmos way may name paper algebra only as what it avoids", async () => {
  const { leansOnPaperAlgebra } = await import("../src/lib/method-presentation");
  const gold = select(quadraticResponse([goldWay(), formula()])).methods[0];
  assert.equal(leansOnPaperAlgebra(gold, "The quadratic formula gives (16 +/- sqrt(discriminant))/6, so a is 16."), "quadratic formula");
  assert.equal(leansOnPaperAlgebra(gold, "Instead of the quadratic formula, click both roots and let one regression find a and b."), null);
  assert.equal(leansOnPaperAlgebra(gold, "Click both roots and let Desmos fit both unknowns; no discriminant needed."), null);
  const paper = select(quadraticResponse([formula()])).methods[0];
  assert.equal(leansOnPaperAlgebra(paper, "The quadratic formula gives both roots."), null, "the math way is allowed to be math");
  assert.throws(() => validateExplanationQuality(gold, explanation(4, { why: "The quadratic formula gives (16 ± √232)/6.", handMath: "a = 16" })), /through paper algebra \(quadratic formula\)/);
});
