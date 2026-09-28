import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assignBadges,
  compareMethods,
  COST_WEIGHTS,
  deriveCost,
  describeShape,
  mathLevel,
  mathScore,
  totalCost,
  type Cost,
  type Rankable,
} from "../src/lib/method-scoring";
import type { TechniqueId } from "../src/lib/technique-vocabulary";

const none = { derivationSteps: 0, newPrimitives: 0, oneOffFacts: 0, setupConstructions: 0, manualIterations: 0 };

test("total = rows + 3·derivation + 2·newPrimitives + 4·oneOffFacts + setup + iterations", () => {
  assert.deepEqual(COST_WEIGHTS, {
    rows: 1, derivationSteps: 3, newPrimitives: 2, oneOffFacts: 4, setupConstructions: 1, manualIterations: 1,
  });
  const cost: Cost = { rows: 2, derivationSteps: 1, newPrimitives: 1, oneOffFacts: 1, setupConstructions: 1, manualIterations: 1 };
  assert.equal(totalCost(cost), 2 + 3 + 2 + 4 + 1 + 1);
  assert.equal(totalCost({ rows: 0, ...none }), 0);
});

test("the spec's sanity check: slider-until-parallel scores 4, the slope-only derivative regression scores 10", () => {
  // p=10 slider, 7x-py+6=0, 7x-10y-11=0; drag p once. Whitelisted primitives are free.
  const slider = deriveCost({ ...none, manualIterations: 1 }, 3, "slider-parallel");
  // f and g rearranged by hand into function form (two derivation steps), four rows.
  const derivative = deriveCost({ ...none, derivationSteps: 2 }, 4, "derivative-regression");
  assert.equal(totalCost(slider), 4);
  assert.equal(totalCost(derivative), 10);
  const methods = [rankable("derivative-regression", derivative), rankable("slider-parallel", slider)].sort(compareMethods);
  assert.equal(methods[0].techniqueId, "slider-parallel", "the function must pick the 4");
});

test("regression test 8: mathLevel derives at the 0 / 1-2 / 3+ boundaries from derivationSteps + oneOffFacts", () => {
  assert.equal(mathLevel(mathScore({ derivationSteps: 0, oneOffFacts: 0 })), "low");
  assert.equal(mathLevel(mathScore({ derivationSteps: 1, oneOffFacts: 0 })), "medium");
  assert.equal(mathLevel(mathScore({ derivationSteps: 0, oneOffFacts: 1 })), "medium");
  assert.equal(mathLevel(mathScore({ derivationSteps: 1, oneOffFacts: 1 })), "medium");
  assert.equal(mathLevel(mathScore({ derivationSteps: 2, oneOffFacts: 1 })), "high");
  assert.equal(mathLevel(mathScore({ derivationSteps: 0, oneOffFacts: 3 })), "high");
  assert.equal(mathLevel(2), "medium");
  assert.equal(mathLevel(3), "high");
});

test("rows are measured by the server; paper and fact-defined techniques get their definitional floors", () => {
  assert.equal(deriveCost({ ...none }, 3, "graph-both-sides").rows, 3);
  // Elimination scales and combines by definition, whatever the model reported.
  assert.equal(deriveCost({ ...none, derivationSteps: 1 }, 0, "elimination").derivationSteps, 2);
  assert.equal(deriveCost({ ...none, derivationSteps: 4 }, 0, "elimination").derivationSteps, 4);
  // The quadratic formula is a one-off fact by definition.
  assert.equal(deriveCost({ ...none }, 1, "quadratic-formula").oneOffFacts, 1);
  // Any no-calculator method does at least one step by hand...
  assert.equal(deriveCost({ ...none }, 0, "plug-in-choices").derivationSteps, 1);
  // ...except translating the words, which is the task itself.
  assert.equal(deriveCost({ ...none }, 0, "translate-the-words").derivationSteps, 0);
  // Calculator techniques from the library get no invented floor.
  assert.deepEqual(deriveCost({ ...none }, 2, "slider-condition"), { rows: 2, ...none });
});

test("the shape line is built server-side from the rows and cost components", () => {
  const slider = [{ latex: "p=1", slider: { min: 1, max: 20, step: 1 } }, { latex: "7x-py+6=0" }, { latex: "7x-10y-11=0" }];
  assert.equal(
    describeShape({ techniqueId: "slider-parallel", rows: slider, cost: { rows: 3, ...none, manualIterations: 1 } }),
    "3 rows · slider · no algebra",
  );
  assert.equal(
    describeShape({ techniqueId: "quadratic-formula", rows: [{ latex: "(-5+\\sqrt{5^2-4(2)(-3)})/(2(2))" }], cost: { rows: 1, ...none, oneOffFacts: 1 } }),
    "1 row · quadratic formula · no algebra",
  );
  assert.equal(
    describeShape({ techniqueId: "translate-the-words", rows: [], cost: { rows: 0, ...none } }),
    "no calculator · translate the words · no algebra",
  );
  assert.equal(
    describeShape({ techniqueId: "three-point-regression", rows: [{ latex: "x_{1}=[1,2,4]" }, { latex: "y_{1}=[7,15,43]" }, { latex: "y_{1}\\sim ax_{1}^2+bx_{1}+c" }], cost: { rows: 3, ...none } }),
    "3 rows · regression · no algebra",
  );
  assert.equal(
    describeShape({ techniqueId: "elimination", rows: [], cost: { rows: 0, ...none, derivationSteps: 2 } }),
    "no calculator · elimination · 2 algebra steps",
  );
});

function rankable(techniqueId: TechniqueId, cost: Cost, rung = 1): Rankable {
  return { id: techniqueId, techniqueId, rung, cost, total: totalCost(cost), mathScore: mathScore(cost) };
}

test("ranking is deterministic and independent of emission order", () => {
  const a = rankable("graph-both-sides", { rows: 2, ...none });
  const b = rankable("parameter-regression", { rows: 2, ...none });
  const c = rankable("elimination", { rows: 0, ...none, derivationSteps: 2 });
  const forward = [a, b, c].sort(compareMethods).map((method) => method.id);
  const backward = [c, b, a].sort(compareMethods).map((method) => method.id);
  assert.deepEqual(forward, backward);
  assert.deepEqual(forward, ["graph-both-sides", "parameter-regression", "elimination"], "equal totals fall back to technique id");
});

/** Fix 3 invariants, checked on any ranked set. */
function assertBadgesDiscriminate(ranked: readonly Rankable[], badges: Map<string, string[]>) {
  const winner = ranked[0];
  assert.deepEqual(badges.get(winner.id), ["Recommended"], "the winner carries exactly one badge: Recommended");
  const all = [...badges.values()].flat();
  for (const badge of new Set(all)) assert.equal(all.filter((item) => item === badge).length, 1, `${badge} appears at most once`);
  for (const method of ranked.slice(1)) assert.ok(badges.get(method.id)!.length <= 1, `${method.id} shows zero or one badge`);
  assert.ok(!ranked.slice(1).some((method) => badges.get(method.id)!.includes("Recommended")), "Recommended is exclusive");
}

test("regression test 6: badges discriminate: the winner shows only Recommended, each other badge lands once, on its strict leader", () => {
  // The tangent problem's technique set (k = 25/12).
  const vertex = rankable("vertex-of-difference", { rows: 1, ...none, derivationSteps: 1 }, 1);
  const slider = rankable("slider-condition", { rows: 3, ...none, manualIterations: 2 }, 3);
  const derivative = rankable("derivative-regression", { rows: 3, ...none, oneOffFacts: 1 }, 4);
  const discriminant = rankable("discriminant", { rows: 0, ...none, derivationSteps: 3, oneOffFacts: 1 }, 2);
  const formula = rankable("quadratic-formula", { rows: 0, ...none, derivationSteps: 4, oneOffFacts: 1 }, 2);
  const ranked = [formula, slider, discriminant, vertex, derivative].sort(compareMethods);
  const badges = assignBadges(ranked);
  assert.equal(ranked[0].id, "vertex-of-difference");
  assertBadgesDiscriminate(ranked, badges);
  assert.deepEqual(badges.get("slider-condition"), ["Least math"], "no derivation and no memorized fact");
  assert.deepEqual(badges.get("derivative-regression"), ["Most Desmos"], "the highest rung among calculator methods");
  assert.deepEqual(badges.get("quadratic-formula"), ["Most algebra"], "the most written steps");
  assert.deepEqual(badges.get("discriminant"), []);
});

test("regression test 6: a badge the winner would lead is suppressed, not handed to the runner-up", () => {
  const cheapest = rankable("graph-both-sides", { rows: 1, ...none, manualIterations: 1 });
  const leastMath = rankable("parameter-regression", { rows: 3, ...none }, 4);
  const paper = rankable("substitution", { rows: 0, ...none, derivationSteps: 2 }, 2);
  const ranked = [cheapest, leastMath, paper].sort(compareMethods);
  const badges = assignBadges(ranked);
  assertBadgesDiscriminate(ranked, badges);
  // Least math: graph-both-sides and parameter-regression tie at 0; the lower-cost one is the winner, so it is suppressed.
  assert.deepEqual(badges.get("parameter-regression"), ["Most Desmos"]);
  // Fewest steps: substitution's 2 ties graph-both-sides' 1 row + 1 drag; the winner is lower-cost, so suppressed.
  assert.deepEqual(badges.get("substitution"), ["Most algebra"]);
});

test("regression test 6: an unbreakable tie awards no one, and a method leading two dimensions shows only the first", () => {
  const winner = rankable("graph-both-sides", { rows: 1, ...none });
  // Identical costs, so equal totals: neither can take "Most algebra" from the other.
  const elimination = rankable("elimination", { rows: 0, ...none, derivationSteps: 2 }, 2);
  const substitution = rankable("substitution", { rows: 0, ...none, derivationSteps: 2 }, 2);
  const tied = [winner, elimination, substitution].sort(compareMethods);
  const tiedBadges = assignBadges(tied);
  assertBadgesDiscriminate(tied, tiedBadges);
  assert.deepEqual(tiedBadges.get("elimination"), []);
  assert.deepEqual(tiedBadges.get("substitution"), []);

  // The formula method wins on total; the graph method leads both Least math and Most Desmos but shows one badge.
  const formula = rankable("quadratic-formula", { rows: 1, ...none, oneOffFacts: 1 }, 2);
  const graph = rankable("intercept-read", { rows: 6, ...none }, 3);
  const split = [formula, graph].sort(compareMethods);
  const splitBadges = assignBadges(split);
  assertBadgesDiscriminate(split, splitBadges);
  assert.deepEqual(splitBadges.get("intercept-read"), ["Least math"]);
  assert.deepEqual(assignBadges([winner]).get("graph-both-sides"), ["Recommended"], "a lone technique is just Recommended");
});
