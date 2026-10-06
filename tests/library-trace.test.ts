/**
 * The curated library is consulted on every solve, and the solve records what
 * it did with it: the strategies it matched, the one each candidate applies,
 * library tricks the question's wording points to that it never tried, and
 * whether the default fell back to generic paper math. Development and eval
 * logging only; nothing here selects a method.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, mock, test } from "node:test";
import OpenAI from "openai";

import { detectStructures, libraryTrace, parseLibraryIndex } from "../src/lib/library-trace";
import { createMemorySolveCache } from "../src/lib/solve-cache";
import { createTrace, loadSolveContext, methodSummaries, solveProblem, type PipelineDeps } from "../src/lib/solve-pipeline";
import { candidatesResponseSchema, selectMethods, type CandidatesResponseInput } from "../src/lib/strategy-selection";
import { LIBRARY_STRATEGY_COUNT } from "../src/lib/technique-vocabulary";
import { candidatesResponse, explanation, graphCandidate, mockModel, paperCandidate, zeroCost } from "./method-fixtures";

type Candidate = CandidatesResponseInput["candidates"][number];

const library = () => readFile(path.join(process.cwd(), "src/content/desmos-tricks.md"), "utf8");
const row = (latex: string) => ({ latex, slider: null, copiesRow: null });
const numeric = (rowNumber: number, value: number, detail: string): Candidate["result"] => ({
  type: "numeric", row: rowNumber, relatedRows: [], value, listIndex: null, answerFrom: "value", choiceLabel: null, detail,
});
const written = (detail: string): Candidate["result"] => ({
  type: "written", row: null, relatedRows: [], value: null, listIndex: null, answerFrom: "reasoning", choiceLabel: null, detail,
});

const RADICAL_QUESTION =
  "3x^2 - 16x + 2 = 0. One solution to the given equation can be written as (a + sqrt(b))/6, where a and b are constants. What is the value of a + b?";

/** The human-verified gold method: click the root, read a, regress b. */
const clickedRootRegression = (overrides: Partial<Candidate> = {}): Candidate =>
  graphCandidate({
    techniqueId: "parameter-regression",
    strategy: 78,
    rung: 4,
    rows: [row("y=3x^{2}-16x+2"), row("a=16"), row("(a+\\sqrt{b})/6\\sim5.20526"), row("a+b")],
    answer: "248",
    result: numeric(4, 248, "a+b from the fitted b"),
    graphBounds: null,
    cost: { ...zeroCost, derivationSteps: 1 },
    ...overrides,
  });
const paperFormula = (): Candidate =>
  paperCandidate({ techniqueId: "quadratic-formula", strategy: null, answer: "248", result: written("16 + 232 from (16 ± √232)/6"), cost: { ...zeroCost, derivationSteps: 3, oneOffFacts: 1 } });
/** The quadratic formula typed into Desmos, with its cost under-reported as if Desmos did the thinking. */
const typedFormula = (): Candidate =>
  graphCandidate({
    techniqueId: "calculator-arithmetic",
    strategy: 77,
    rung: 2,
    rows: [row("16+16^{2}-4(3)(2)")],
    answer: "248",
    result: numeric(1, 248, "a + b from the formula's numbers"),
    graphBounds: null,
    cost: { ...zeroCost },
  });

function solve(candidates: Candidate[], overrides: Partial<CandidatesResponseInput> = {}) {
  const response = candidatesResponseSchema.parse(candidatesResponse(candidates, { question: RADICAL_QUESTION, structure: "A quadratic whose root is given in a radical form with unknown constants.", ...overrides }));
  return { response, selection: selectMethods(response) };
}

afterEach(() => {
  mock.restoreAll();
  delete process.env.DESMO_DIAGNOSTICS;
});

test("the library index finds every numbered strategy and the techniques each one teaches", async () => {
  const index = parseLibraryIndex(await library());
  assert.equal(index.length, LIBRARY_STRATEGY_COUNT);
  assert.deepEqual(index.map((strategy) => strategy.number), Array.from({ length: LIBRARY_STRATEGY_COUNT }, (_, i) => i + 1));
  const radical = index[77];
  assert.match(radical.title, /^Root in a given radical form/);
  assert.deepEqual(radical.techniques, ["parameter-regression"]);
  // Strategy 61's unnumbered sub-sections still belong to it.
  assert.deepEqual(index[60].techniques, ["parameter-regression", "bracket-regression", "derivative-regression", "slider-parallel"]);
  for (const strategy of index) assert.ok(strategy.techniques.length > 0, `strategy ${strategy.number} teaches a technique`);
});

test("every candidates prompt carries the Desmo standard, the gold solutions, then the whole library, in the library-first order", async () => {
  const context = await loadSolveContext();
  const instructions = context.candidateInstructions;
  assert.match(instructions, /<strategy_library>[\s\S]*78\. Root in a given radical form[\s\S]*<\/strategy_library>/);
  assert.match(instructions, /THE DESMO STANDARD/);
  assert.match(instructions, /"Is this what a general chatbot would do,\s+with Desmos as a calculator\?"/);
  assert.match(instructions, /DESMOS WAYS AND ONE MATH WAY/);
  assert.ok(instructions.indexOf("\n<gold_solutions>\n") < instructions.indexOf("\n<strategy_library>\n"), "the standard comes before the catalog");
  assert.match(instructions, /Search the numbered strategies in <strategy_library> BEFORE doing any\s+ordinary math/);
  assert.match(instructions, /is there a strategy in the library that avoids\s+this\?/);
  assert.match(instructions, /e\. traditional algebra, last/);
  assert.match(instructions, /Measure the student's effort\s+BEFORE the calculator row/);
  const gold = instructions.slice(instructions.indexOf("\n<gold_solutions>\n"), instructions.indexOf("</gold_solutions>"));
  assert.match(gold, /"id": "015"/);
  assert.match(gold, /\(a\+\\\\sqrt\{b\}\)\/6~5\.20526/, "the quadratic-root rows, as typed");
  assert.equal(context.libraryIndex?.length, LIBRARY_STRATEGY_COUNT);
});

test("the library report is part of the schema, after the structure, and its strategy numbers are bounded", () => {
  const parsed = candidatesResponseSchema.parse(candidatesResponse([clickedRootRegression()], {
    library: { matched: [78, 61], skipped: [{ strategy: 61, reason: "no data table; one clicked root is enough" }] },
  }));
  assert.deepEqual(parsed.library.matched, [78, 61]);
  assert.equal(parsed.candidates[0].strategy, 78);
  // Old recorded outputs (no library report, no citations) still parse.
  const legacy = candidatesResponseSchema.parse(candidatesResponse());
  assert.deepEqual(legacy.library, { matched: [], skipped: [] });
  assert.equal(legacy.candidates[0].strategy, null);
  for (const bad of [0, LIBRARY_STRATEGY_COUNT + 1, 2.5]) {
    assert.equal(candidatesResponseSchema.safeParse(candidatesResponse([clickedRootRegression({ strategy: bad })])).success, false, `strategy ${bad}`);
    assert.equal(candidatesResponseSchema.safeParse(candidatesResponse(undefined, { library: { matched: [bad], skipped: [] } })).success, false, `matched ${bad}`);
  }
});

test("human-verified gold: the clicked root and a regression beat the quadratic formula, typed or written; one math way stays listed", async () => {
  const { response, selection } = solve([paperFormula(), typedFormula(), clickedRootRegression()], { library: { matched: [78], skipped: [] } });
  const eligible = selection.methods.filter((method) => !method.rejected);
  assert.equal(selection.winnerId, "parameter-regression");
  assert.deepEqual(eligible.map((method) => [method.techniqueId, method.approach]), [["parameter-regression", "desmos"], ["calculator-arithmetic", "math"]]);
  assert.equal(selection.methods.find((method) => method.techniqueId === "quadratic-formula")?.rejected?.rule, "extra-math-way");
  assert.equal(eligible[0].answer, "248");
  // Typing b^2-4ac into Desmos is still the quadratic formula, whatever the model reported.
  const typed = eligible.find((method) => method.techniqueId === "calculator-arithmetic")!;
  assert.equal(typed.cost.oneOffFacts, 1);
  assert.ok(typed.repairs.some((repair) => /quadratic formula/.test(repair)));
  assert.ok(typed.total > eligible[0].total);
  // The floor reads the formula, not any square minus a 4: graphs of x^2-4x and (x-2)^2-4(x+1) carry no fact.
  for (const latex of ["y=x^{2}-4x+1", "y=(x-2)^{2}-4(x+1)", "y=3x^{2}-16x+2"]) {
    const { selection: graphed } = solve([clickedRootRegression({ rows: [row(latex), row("a=16"), row("(a+\\sqrt{b})/6\\sim5.20526"), row("a+b")] })]);
    assert.equal(graphed.methods[0].cost.oneOffFacts, 0, latex);
  }
  for (const rows of [["\\sqrt{(-16)^{2}-4(3)(2)}"], ["16+16^{2}-4\\cdot3\\cdot2"], ["a=3", "b=-16", "c=2", "-b+\\sqrt{b^{2}-4ac}"]]) {
    const candidate = { ...typedFormula(), rows: rows.map(row), result: numeric(rows.length, 248, "a + b from the formula's numbers") };
    const { selection: typedAgain } = solve([candidate, clickedRootRegression()]);
    const method = typedAgain.methods.find((item) => item.techniqueId === "calculator-arithmetic");
    assert.equal(method?.rejected, null, `${rows.at(-1)} is a valid row`);
    assert.equal(method?.cost.oneOffFacts, 1, rows.join(" | "));
  }

  const trace = libraryTrace(response, selection, parseLibraryIndex(await library()));
  assert.deepEqual(trace.detected.map((item) => item.detector), ["radical-form-root"]);
  assert.deepEqual(trace.missed, []);
  assert.deepEqual(trace.considered, [77, 78]);
  assert.deepEqual(trace.matched, [{ number: 78, title: "Root in a given radical form → click the root, slider the visible number, regress the hidden one" }]);
  assert.deepEqual(trace.winner && { techniqueId: trace.winner.techniqueId, strategy: trace.winner.strategy }, { techniqueId: "parameter-regression", strategy: 78 });
  assert.match(trace.winner!.reason, /lowest total cost .*; next calculator-arithmetic at/);
  assert.equal(trace.fellBackToGenericMath, false);
  assert.deepEqual(trace.candidates.map((item) => item.source), ["library", "library", "generic-math"]);
  assert.deepEqual(trace.mismatches, []);
});

test("a solve that skips the library is visible: the default is generic math and the radical-form trick is a library miss", async () => {
  const { response, selection } = solve([paperFormula()]);
  const trace = libraryTrace(response, selection, parseLibraryIndex(await library()));
  assert.equal(trace.fellBackToGenericMath, true);
  assert.deepEqual(trace.missed, ["parameter-regression"]);
  assert.deepEqual(trace.matched, []);
});

test("a cited strategy that does not teach the candidate's technique is logged as a mismatch", async () => {
  const { response, selection } = solve([clickedRootRegression({ strategy: 1 })]);
  const trace = libraryTrace(response, selection, parseLibraryIndex(await library()));
  assert.equal(trace.mismatches.length, 1);
  assert.match(trace.mismatches[0], /cites strategy 1 \(Graph two equations and click the intersection\)/);
});

test("a Desmos way is the default even against one trivial paper step; the math way stays listed", () => {
  // Desmos comes first: the list filter is the default and the one-step paper method is the alternative.
  const question = "If 3n = 12, what is the value of 3n + 5?";
  const selection = selectMethods(candidatesResponseSchema.parse(candidatesResponse([
    graphCandidate({
      techniqueId: "integer-list-filter",
      strategy: 65,
      rung: 4,
      rows: [row("N=[1...100]"), row("M=N[3N=12]"), row("S=3M+5"), row("S[1]")],
      answer: "17",
      result: numeric(4, 17, "3n + 5 at the n that passes the filter"),
      graphBounds: null,
      cost: { ...zeroCost, setupConstructions: 2 },
    }),
    paperCandidate({ techniqueId: "direct-arithmetic", strategy: null, answer: "17", result: written("3n is 12, so 3n + 5 is 17"), cost: { ...zeroCost, derivationSteps: 1 } }),
  ], { question, structure: "The asked expression contains the given one." })));
  const eligible = selection.methods.filter((method) => !method.rejected);
  assert.equal(selection.winnerId, "integer-list-filter");
  assert.deepEqual(eligible.map((method) => method.techniqueId), ["integer-list-filter", "direct-arithmetic"], "the math way stays listed");
});

test("the structure detectors fire on the wording that names a trick, and stay quiet otherwise", () => {
  const detectors = (question: string, choices: { label: string; text: string }[] | null = null) => detectStructures(question, choices).map((item) => item.detector);
  assert.deepEqual(detectors(RADICAL_QUESTION), ["radical-form-root"]);
  assert.deepEqual(detectors("One solution is (a + \\sqrt{b})/6. Find a + b."), ["radical-form-root"]);
  assert.deepEqual(detectors("What are the solutions to x - \\sqrt{x} = 6?"), [], "a radical equation is not a stated form");
  assert.deepEqual(detectors("If x - 3 is a factor of p(x), what is the value of k?"), ["factor-with-unknown"]);
  assert.deepEqual(detectors("For 0 <= x <= 90, sin(x) = cos(2x). What is the value of x?"), [], "a domain alone is not an extremum");
  assert.deepEqual(detectors("Which equation represents the total cost?", [{ label: "A", text: "y = 2x + 5" }, { label: "B", text: "y = 5x + 2" }]), [], "translating is the task");
  assert.ok(detectors("The line and the parabola intersect at exactly one point. What is k?").includes("exactly-one-intersection"));
});

test("a fresh solve records the library trace for evals and logs it only when diagnostics are on", async () => {
  const index = parseLibraryIndex(await library());
  const deps = (): PipelineDeps => ({
    client: new OpenAI({ apiKey: "unit-test-key", maxRetries: 0 }),
    cache: createMemorySolveCache(),
    context: { model: "gpt-5-mini", candidateInstructions: "test", version: "test-version", libraryIndex: index },
    tier: { priorityUnavailable: false },
    diagnosticId: "library-trace",
    trace: createTrace(),
  });
  const reply = candidatesResponse([clickedRootRegression(), paperFormula()], { question: RADICAL_QUESTION, library: { matched: [78], skipped: [] } });
  const info = mock.method(console, "info", () => {});

  mockModel({ candidates: reply, explanation: explanation(4) });
  const quiet = deps();
  const result = await solveProblem(quiet, { kind: "text", problem: RADICAL_QUESTION, choices: null });
  assert.equal(result.kind, "solved");
  assert.equal(quiet.trace?.library?.winner?.strategy, 78);
  assert.equal(quiet.trace?.library?.fellBackToGenericMath, false);
  assert.equal(info.mock.calls.some((call) => call.arguments[0] === "[desmo:library]"), false, "not logged for normal users");
  if (result.kind === "solved") {
    assert.doesNotMatch(JSON.stringify(methodSummaries(result.resolved)), /"strategy"|"library"/, "the client never sees the trace");
  }

  mock.restoreAll();
  const logged = mock.method(console, "info", () => {});
  process.env.DESMO_DIAGNOSTICS = "1";
  mockModel({ candidates: reply, explanation: explanation(4) });
  await solveProblem(deps(), { kind: "text", problem: RADICAL_QUESTION, choices: null });
  const line = logged.mock.calls.find((call) => call.arguments[0] === "[desmo:library]");
  assert.ok(line, "logged in development and eval diagnostics");
  const payload = JSON.parse(String(line.arguments[1]));
  assert.deepEqual(payload.matched, [{ number: 78, title: index[77].title }]);
  assert.equal(payload.winner.techniqueId, "parameter-regression");
});
