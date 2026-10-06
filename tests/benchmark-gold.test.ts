/**
 * Benchmark labels say who vouches for them: every case file is agent-written
 * silver, and the gold solutions (human-verified, and seen in the prompt) are
 * reported as their own group, never averaged into the others.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { loadCases } from "../evals/benchmark/load-cases";
import { metricsTable } from "../evals/benchmark/report";
import { summarize, summarizeByGroup, type MethodRecord, type RunRecord } from "../evals/benchmark/score";

const desmosWay: MethodRecord = { techniqueId: "parameter-regression", rows: 4, derivationSteps: 1, oneOffFacts: 0, mathScore: 1, total: 7, mathLevel: "low", approach: "desmos" };
const mathWay: MethodRecord = { techniqueId: "quadratic-formula", rows: 0, derivationSteps: 3, oneOffFacts: 1, mathScore: 5, total: 13, mathLevel: "high", approach: "math" };

const record = (overrides: Partial<RunRecord>): RunRecord => ({
  caseId: "x",
  group: "hard",
  runIndex: 0,
  ok: true,
  answerCorrect: true,
  strategyClass: "gold",
  winner: desmosWay,
  methods: [desmosWay, mathWay],
  ...overrides,
});

test("every case file is agent-generated silver; human-verified gold lives only in the gold solutions", async () => {
  const cases = await loadCases({ includePrivate: false });
  assert.ok(cases.length >= 86);
  assert.ok(cases.every((item) => item.labelProvenance === "agent_generated_silver"));
  assert.ok(cases.every((item) => item.group !== "gold"), "gold cases are loaded only with --group=gold");
});

test("the gold group is summarized on its own; Desmos-default, both-ways, single-method, and library metrics read each record", () => {
  const records = [
    record({ caseId: "gold/015", group: "gold", labelProvenance: "human_verified_gold", library: { winner: { strategy: 78 }, missed: [] } as unknown as RunRecord["library"] }),
    record({
      caseId: "074",
      group: "representative",
      strategyClass: "bad",
      winner: mathWay,
      methods: [mathWay],
      library: { winner: { strategy: null }, missed: ["parameter-regression"] } as unknown as RunRecord["library"],
    }),
    record({ caseId: "old", winner: { ...desmosWay, approach: undefined }, methods: [{ ...desmosWay, approach: undefined }] }), // recorded before approaches or traces
  ];
  const grouped = summarizeByGroup(records);
  assert.equal(grouped.gold.runs, 1);
  assert.equal(grouped.gold.goldRate, 100);
  assert.equal(grouped.all.goldRate, 66.7);
  const all = summarize(records);
  assert.equal(all.desmosDefaultRate, 50, "only records that carry the approach count");
  assert.equal(all.bothWaysRate, 50);
  assert.equal(all.singleMethodRate, 66.7);
  assert.equal(all.genericFallbackRate, 33.3);
  assert.equal(all.libraryDefaultRate, 50, "only traced runs count");
  assert.equal(all.libraryMissRate, 50);
  // A baseline recorded before the gold group existed still renders.
  const { gold: _gold, ...oldBaseline } = grouped;
  void _gold;
  const table = metricsTable(grouped, oldBaseline);
  assert.match(table, /\| Metric \| All \| Δ all \| Representative \| Δ rep \| Hard \| Δ hard \| Gold \| Δ gold \|/);
  assert.match(table, /gold 1\)/);
  assert.match(table, /\| Default is a Desmos way \|/);
  assert.match(table, /\| Lists both a Desmos way and a math way \|/);
});
