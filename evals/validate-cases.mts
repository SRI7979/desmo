/**
 * Validates every benchmark case against evals/benchmark/case-schema.ts and
 * prints coverage by group, domain, topic, and gold technique. Free: no model
 * calls.
 *
 *   npm run eval:validate
 */
import { loadCases, loadGoldCases } from "./benchmark/load-cases";

const cases = await loadCases();
const count = <T extends string>(values: T[]) =>
  Object.entries(values.reduce<Record<string, number>>((tally, value) => ({ ...tally, [value]: (tally[value] ?? 0) + 1 }), {}))
    .sort((left, right) => right[1] - left[1])
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ");

console.log(`${cases.length} valid cases (${cases.filter((item) => item.private).length} private), plus ${(await loadGoldCases()).length} gold solutions (--group=gold)`);
console.log(`groups: ${count(cases.map((item) => item.group))}`);
console.log(`domains: ${count(cases.map((item) => item.domain))}`);
console.log(`sources: ${count(cases.map((item) => item.source))}`);
console.log(`label provenance: ${count(cases.map((item) => item.labelProvenance))}`);
console.log(`expected result types: ${count(cases.map((item) => item.expectedResultType))}`);
console.log(`gold techniques: ${count(cases.flatMap((item) => item.gold))}`);
console.log(`with answer choices: ${cases.filter((item) => item.choices).length}, student-produced: ${cases.filter((item) => !item.choices).length}`);
