import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createPreflightEngine, type DesmosApi } from "../src/lib/desmos-engine";
import {
  calculatorPayload,
  cleanMethods,
  preflightInRankOrder,
  verdictFromAnalysis,
  type CalculatorPayload,
  type DesmosAnalysis,
  type PreflightVerdict,
} from "../src/lib/desmos-preflight";
import { normalizeDesmosExpressions } from "../src/lib/desmos-latex";
import { findListShapeViolations, findRegressionDeterminacyViolations } from "../src/lib/solver-rules";
import { CANDIDATE_INSTRUCTIONS } from "../src/lib/solver-instructions";
import { candidatesResponseSchema, selectMethods, type Method } from "../src/lib/strategy-selection";
import { selectorMethods } from "../src/lib/technique-selection-ui";
import {
  candidatesResponse,
  CORRECTED_ROWS,
  graphCandidate,
  NESTED_LIST_ROWS,
  NO_SOLUTION_QUESTION,
  noSolutionCandidates,
  TANGENT_QUESTION,
  tangentCandidates,
  tangentDerivativeRegression,
} from "./method-fixtures";

const recorded = JSON.parse(readFileSync("tests/fixtures/desmos-analysis-v1.11.json", "utf8")) as Record<
  string,
  { rows: string[]; analysis: DesmosAnalysis }
>;

function select(candidates: ReturnType<typeof tangentCandidates>, question: string) {
  return selectMethods(candidatesResponseSchema.parse(candidatesResponse(candidates, { question })));
}

const eligible = (methods: Method[]) => methods.filter((method) => method.rejected === null);

/**
 * A stand-in for the hidden Desmos instance: rows matching `erroring` report
 * an error, like the real engine; every call is recorded.
 */
function stubEngine(erroring: RegExp | null) {
  const checked: CalculatorPayload[] = [];
  const check = async (payload: CalculatorPayload): Promise<PreflightVerdict> => {
    checked.push(payload);
    const errors = payload.items.flatMap((item, index) =>
      erroring && erroring.test(item.latex) ? [{ row: index + 1, message: "Cannot store a list of numbers in a list." }] : [],
    );
    return errors.length > 0
      ? { status: "error", rows: payload.items.length, errors }
      : { status: "clean", rows: payload.items.length, evaluations: {} };
  };
  return { check, checked };
}

// ---- regression test 1 ----------------------------------------------------

test("regression test 1: the shipped nested-list plan is rejected by validation; the two-row form is clean and fits k = 25/12", () => {
  const rows = normalizeDesmosExpressions(NESTED_LIST_ROWS.map((latex) => ({ latex, purpose: "" })));
  assert.deepEqual(
    findListShapeViolations(rows).map((violation) => [violation.row, violation.kind]),
    [[1, "singleton"], [2, "nested"]],
    "x_1=[1] wraps a scalar unknown, and [6x_1-k,6] nests that list",
  );
  const selection = select([tangentDerivativeRegression(NESTED_LIST_ROWS), tangentCandidates()[0]], TANGENT_QUESTION);
  const shipped = selection.methods.find((method) => method.techniqueId === "derivative-regression")!;
  assert.equal(shipped.rejected?.rule, "list-shape");
  assert.match(shipped.rejected!.reason, /one-element list/);
  assert.match(shipped.rejected!.reason, /list inside a list/);

  const corrected = select([tangentDerivativeRegression(CORRECTED_ROWS)], TANGENT_QUESTION).methods[0];
  assert.equal(corrected.rejected, null, "a and k are free, two constraints: determined");
  assert.equal(corrected.cost.rows, 2);
  assert.deepEqual(findRegressionDeterminacyViolations(corrected.rows), []);

  // What the real engine returned for each (tests/fixtures, recorded from Desmos v1.11.4).
  const nested = verdictFromAnalysis(recorded.nestedList.analysis, ["p1", "p2", "p3"]);
  assert.deepEqual(nested, {
    status: "error",
    rows: 3,
    errors: [
      { row: 2, message: "Cannot store a list of numbers in a list." },
      { row: 3, message: "Try adding 'y=' to the beginning of this equation." },
    ],
  });
  const clean = verdictFromAnalysis(recorded.corrected.analysis, ["p1", "p2"]);
  assert.equal(clean?.status, "clean");
  const k = clean?.status === "clean" ? clean.evaluations[2] : null;
  assert.equal(k?.type, "Number");
  assert.ok(k?.type === "Number" && Math.abs(k.value - 25 / 12) < 1e-9, "Desmos fits k = 25/12");
});

test("the list-shape rule leaves real list techniques alone", () => {
  for (const plan of [
    ["x_{1}=[1...5]", "34x_{1}^2+bx_{1}+70\\sim(2x_{1}+7)(17x_{1}+10)"],
    ["x_{1}=[-6,0]", "y_{1}=[0,-9]", "y_{1}\\sim mx_{1}+b"],
    ["N=[1...100]", "\\operatorname{length}(N[\\operatorname{mod}(N,3)=0])"],
    ["L=[1,2,3]", "[\\operatorname{mean}(L),L[2]]\\sim[a,b]"],
    ["B=[1,2,3,4]", "3(-2B)^2+25(-2B)+14B"],
    ["[f(5),f(6),4+c]\\sim[0,0,0]"],
  ]) {
    assert.deepEqual(findListShapeViolations(plan.map((latex) => ({ latex }))), [], plan.join(" ; "));
  }
  assert.deepEqual(findListShapeViolations([{ latex: "[[1,2],3]" }]).map((item) => item.kind), ["nested"]);
  assert.deepEqual(
    findListShapeViolations([{ latex: "B=[1,2]" }, { latex: "C=3B+1" }, { latex: "[C,1]\\sim[a,b]" }]).map((item) => [item.row, item.kind]),
    [[3, "nested"]],
    "a name computed from a list is a list too",
  );
  const mismatch = findRegressionDeterminacyViolations([{ latex: "[a+b,c]\\sim[1,2,3]" }]);
  assert.deepEqual(mismatch, [{ row: 1, kind: "mismatched_lists", lengths: { "left side": 2, "right side": 3 } }], "Desmos silently fits this, so it is caught statically");
});

// ---- regression test 2 ----------------------------------------------------

test("regression test 2: a winner whose rows error in Desmos is never shown; the next clean technique is promoted", async () => {
  const methods = eligible(select(tangentCandidates(), TANGENT_QUESTION).methods);
  assert.equal(methods[0].techniqueId, "vertex-of-difference");
  const { check, checked } = stubEngine(/\(3x\^2\+13x\+2\)-6x/); // the winner's only row errors
  const promotedIds: string[] = [];
  const run = await preflightInRankOrder(methods.map((method) => ({ ...method, verified: false })), check, {
    onPromote: (method) => promotedIds.push(method.id),
  });
  assert.deepEqual(promotedIds, ["slider-condition"], "exactly one promotion, and never the erroring winner");
  assert.equal(run.promoted?.id, "slider-condition");
  assert.equal(run.verdicts.get("vertex-of-difference")?.status, "error");
  assert.equal(checked[0].items[0].latex, "y=(3x^2+13x+2)-6x", "the winner is checked first");
  // Paper techniques have no rows to run and are never sent to the engine.
  assert.equal(checked.length, 3);
  // What the visible calculator receives is the promoted method's batch, the one that was checked.
  const shown = calculatorPayload(run.promoted!.rows, run.promoted!.answerState);
  assert.ok(checked.some((payload) => payload.key === shown.key));
  const statuses = Object.fromEntries([...run.verdicts].map(([id, verdict]) => [id, verdict.status]));
  const listed = selectorMethods(methods.map((method) => ({ ...method, verified: false })), statuses);
  assert.ok(!listed.some((method) => method.id === "vertex-of-difference"), "an erroring technique is not listed either");
  assert.equal(listed[0].id, "slider-condition");
  assert.deepEqual(listed[0].badges, ["Recommended"], "badges are recomputed over what survived");
  assert.deepEqual(cleanMethods(methods, run.verdicts).map((method) => method.id), listed.map((method) => method.id));
});

test("regression test 3 (client side): when every technique errors, nothing is promoted", async () => {
  const methods = eligible(select([tangentDerivativeRegression(CORRECTED_ROWS), tangentCandidates()[0]], TANGENT_QUESTION).methods);
  const { check } = stubEngine(/./);
  const promoted: string[] = [];
  const run = await preflightInRankOrder(methods, check, { onPromote: (method) => promoted.push(method.id) });
  assert.equal(run.promoted, null);
  assert.deepEqual(promoted, []);
  assert.ok([...run.verdicts.values()].every((verdict) => verdict.status === "error"));
});

test("a verdict cached as clean skips the selection check; a timeout never counts as clean", async () => {
  const methods = eligible(select(tangentCandidates(), TANGENT_QUESTION).methods).map((method) => ({
    ...method,
    verified: method.techniqueId === "vertex-of-difference",
  }));
  const { check, checked } = stubEngine(null);
  const run = await preflightInRankOrder(methods, check, { trusted: (method) => method.verified });
  assert.equal(run.promoted?.techniqueId, "vertex-of-difference");
  assert.ok(!checked.some((payload) => payload.items[0]?.latex.includes("-6x")), "the cached-clean winner is not re-checked here");

  const timeouts = await preflightInRankOrder(methods.map((method) => ({ ...method, verified: false })), async (payload) => ({ status: "timeout", rows: payload.items.length }));
  assert.equal(timeouts.promoted?.techniqueId, "discriminant", "only a technique with nothing to run can be promoted without a clean check");
});

test("the engine waits for every row, ignores a stale analysis of the previous batch, and times out rather than guessing", async () => {
  const observers = new Map<string, () => void>();
  let analysis: DesmosAnalysis = {};
  let emissions: Array<{ delay: number; next: (ids: string[]) => DesmosAnalysis }> = [];
  const desmos: DesmosApi = {
    GraphingCalculator: () => ({
      get expressionAnalysis() {
        return analysis;
      },
      getExpressions: () => [],
      observe: (name, callback) => observers.set(name, callback),
      unobserve: (name) => observers.delete(name),
      observeEvent: () => undefined,
      unobserveEvent: () => undefined,
      setBlank: () => undefined, // like Desmos, the old analysis lingers until the next update
      setExpressions: (items) => {
        const ids = items.map((item) => item.id);
        for (const { delay, next } of emissions) {
          setTimeout(() => {
            analysis = next(ids);
            observers.get("expressionAnalysis")?.();
          }, delay);
        }
      },
      setMathBounds: () => undefined,
      resize: () => undefined,
      destroy: () => undefined,
    }),
  };
  const element = { setAttribute: () => undefined, style: {} as Record<string, string>, remove: () => undefined };
  const doc = { createElement: () => element, body: { appendChild: () => undefined } } as unknown as Document;
  const engine = createPreflightEngine(desmos, doc, { quietMs: 15, timeoutMs: 300 });
  const batch = calculatorPayload(CORRECTED_ROWS.map((latex) => ({ latex, slider: null })), null);

  // Row 2's readout settles after the fit: a first update has it erroring, the last is clean.
  emissions = [
    { delay: 1, next: (ids) => ({ [ids[0]]: { isError: false }, [ids[1]]: { isError: true, errorMessage: "k is not defined" } }) },
    { delay: 8, next: (ids) => ({ [ids[0]]: { isError: false }, [ids[1]]: { isError: false, evaluation: { type: "Number", value: 25 / 12 } } }) },
  ];
  const first = await engine.check(batch);
  assert.equal(first.status, "clean", "the verdict is read only after the analysis goes quiet");

  // The previous batch's clean analysis is still present when the next batch starts;
  // with fresh ids it cannot be mistaken for this batch's result.
  emissions = [{ delay: 20, next: (ids) => ({ [ids[0]]: { isError: true, errorMessage: "Cannot store a list of numbers in a list." }, [ids[1]]: { isError: true } }) }];
  const second = await engine.check(batch);
  assert.equal(second.status, "error");

  emissions = [];
  assert.equal((await engine.check(batch)).status, "timeout", "no analysis: unknown, never clean");
});

// ---- regression tests 4, 5, 7, 8 ------------------------------------------

test("regression test 4: the tangent problem lists every Desmos way and one math way, and vertex of the difference is Recommended", () => {
  const selection = select(tangentCandidates(), TANGENT_QUESTION);
  const methods = eligible(selection.methods);
  assert.ok(methods.length >= 4, `${methods.length} techniques`);
  assert.deepEqual(
    methods.map((method) => [method.techniqueId, method.approach]),
    [["vertex-of-difference", "desmos"], ["slider-condition", "desmos"], ["derivative-regression", "desmos"], ["discriminant", "math"]],
  );
  assert.equal(selection.methods.find((method) => method.techniqueId === "quadratic-formula")?.rejected?.rule, "extra-math-way", "a second math way teaches nothing new");
  assert.equal(selection.winnerId, "vertex-of-difference");
  assert.deepEqual(methods[0].badges, ["Recommended"]);
  assert.equal(methods[0].name, "Vertex of the difference");
  assert.equal(methods[0].shape, "1 row · graph · no algebra");
});

test("regression test 5: on the p = 10 no-solution system, derivative regression is listed and is not Recommended", () => {
  const selection = select(noSolutionCandidates(), NO_SOLUTION_QUESTION);
  const methods = eligible(selection.methods);
  const derivative = methods.find((method) => method.techniqueId === "derivative-regression");
  assert.ok(derivative, `listed; rejected: ${JSON.stringify(selection.methods.filter((method) => method.rejected).map((method) => method.rejected))}`);
  assert.equal(derivative.distinguishes, "visual-parallel-vs-overlap", "both lines graphed at the fitted p");
  assert.notEqual(selection.winnerId, derivative.id);
  assert.equal(selection.winnerId, "slider-condition");
  assert.ok(!derivative.badges.includes("Recommended"));

  // Matching slopes alone is still rejected (Rule 3 unchanged for it).
  const slopeOnly = noSolutionCandidates()[2];
  assert.throws(
    () => select([{ ...slopeOnly, rows: slopeOnly.rows!.slice(0, 3), result: { ...slopeOnly.result!, type: "numeric", row: 3, relatedRows: [], value: 10, answerFrom: "value" } }], NO_SOLUTION_QUESTION),
    /Derivative regression \(condition-incomplete\)/,
  );
});

test("regression test 6 (selection output): the winner shows one badge and every badge appears at most once", () => {
  for (const selection of [select(tangentCandidates(), TANGENT_QUESTION), select(noSolutionCandidates(), NO_SOLUTION_QUESTION)]) {
    const methods = eligible(selection.methods);
    assert.deepEqual(methods[0].badges, ["Recommended"]);
    const all = methods.flatMap((method) => method.badges);
    assert.equal(new Set(all).size, all.length);
    assert.ok(methods.every((method) => method.badges.length <= 1));
  }
});

test("regression test 7: a problem with one genuine technique gets one candidate, never padded", () => {
  const selection = select([graphCandidate()], "What is the positive solution to x² = 9?");
  assert.equal(eligible(selection.methods).length, 1);
  assert.deepEqual(selection.methods[0].badges, ["Recommended"]);
  assert.match(CANDIDATE_INSTRUCTIONS, /A problem with only one way is rare; claim it only\s+after checking the library/);
  assert.match(CANDIDATE_INSTRUCTIONS, /Still forbidden: inventing a technique that does not solve the problem in\s+order to pad the list/);
});

test("regression test 8: the shape's row count is the number of rows the calculator inserts", async () => {
  const methods = eligible(select(tangentCandidates(), TANGENT_QUESTION).methods);
  const { check } = stubEngine(null);
  for (const method of methods) {
    const inserted = calculatorPayload(method.rows, method.answerState).items.length;
    const verdict = await check(calculatorPayload(method.rows, method.answerState));
    const count = method.shape.match(/^(\d+) rows?/)?.[1];
    assert.equal(Number(count ?? 0), inserted, method.shape);
    assert.equal(verdict.rows, inserted);
    assert.equal(method.cost.rows, inserted);
  }
});

// ---- the rendering gate ---------------------------------------------------

test("every path that shows calculator rows goes through the pre-flight gate", () => {
  const calculator = readFileSync("src/components/desmos-calculator.tsx", "utf8");
  const explanation = readFileSync("src/components/solution-explanation.tsx", "utf8");
  // The visible calculator inserts rows in exactly one place, only for a clean verdict.
  assert.equal(calculator.match(/\.setExpressions\(/g)?.length, 1);
  assert.match(calculator, /const insertable = gate\.status === "clean" && !blocked;/);
  // The checked batch itself is inserted; dark mode changes only each row's display color.
  assert.match(calculator, /if \(!insertable \|\| payload\.items\.length === 0\) return;\s+try \{\s+const dark = isDark\(\);\s+calculator\.setExpressions\(payload\.items\.map\(\(item\) => \(\{ \.\.\.item, color: displayColor\(item\.color, dark\) \}\)\)\);/);
  // A theme change recolors the loaded rows in place and touches nothing else about them.
  assert.equal(calculator.match(/\.setExpression!?\(/g)?.length, 1);
  assert.match(calculator, /calculator\.setExpression!\(\{ id, color: displayColor\(rows\.colors\[index\], dark\) \}\)/);
  // The explanation's copyable rows render only in the branch after the gate is clean.
  const pending = explanation.indexOf('gate.status === "pending"');
  const withheld = explanation.indexOf('gate.status !== "clean"');
  const rows = explanation.indexOf("<MathExpression latex={expression.latex} />");
  assert.ok(pending > 0 && withheld > pending && rows > withheld, "rows follow both gate checks");
  // Both calculators evaluate with the same math options and the same batch builder.
  assert.match(calculator, /\.\.\.MATH_OPTIONS/);
  assert.match(calculator, /usePreflightGate\(expressions, answerState\)/);
  assert.match(readFileSync("src/components/preflight-gate.ts", "utf8"), /calculatorPayload\(rows, answerState\)/);
});
