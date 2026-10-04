# Recorded runs re-scored: after-enum

These runs were recorded by the previous harness on older prompt versions; they cover only the cases that existed then. Latency is in-process (no auth, upload, or database time).

- after-enum: 80 runs, prompt bb3e99e855951645d67bd736

Runs: 80 (55 scored; representative 35, hard 45).

| Metric | All | Representative | Hard |
|---|---|---|---|
| Answer accuracy | 100% | 100% | 100% |
| Recommended = gold strategy | 63.6% | 55.6% | 67.6% |
| Recommended = gold or acceptable | 72.7% | 77.8% | 70.3% |
| Recommended = bad strategy | 7.3% | 0% | 10.8% |
| Recommended = unlabeled strategy | 20% | 22.2% | 18.9% |
| Math-heavy default (math score ≥ 2) | 12.7% | 5.6% | 16.2% |
| Gold strategy listed (default or alternative) | 78.2% | 77.8% | 78.4% |
| Avg Desmos rows (default) | 1.8 | 1.56 | 1.92 |
| Avg manual-math score (default) | 0.4 | 0.33 | 0.43 |
| Avg hidden derivation (calculator defaults) | 0 | 0 | 0 |
| Avg methods listed | 1.75 | 1.67 | 1.78 |
| Avg distinct method families listed | — | — | — |
| Explanation rubric score (0–1) | — | — | — |
| Solver failure rate | 0% | 0% | 0% |
| Clarification rate | 0% | 0% | 0% |
| Validation retry rate | 5.5% | 5.6% | 5.4% |
| Desmos retry rate | 0% | 0% | 0% |
| Explanation fallback rate | 10.9% | 22.2% | 5.4% |
| Infrastructure failures (excluded) | 31.3% | 48.6% | 17.8% |
| Time to first useful result p50 (ms) | 14917 | 13293 | 15655 |
| Time to first useful result p75 (ms) | 16938 | 16208 | 17952 |
| Time to first useful result p95 (ms) | 25919 | 25919 | 30631 |
| Complete p50 (ms) | 18253 | 15452 | 19424 |
| Complete p95 (ms) | 28712 | 26908 | 33855 |
| Output tokens per solve | — | — | — |

| Case | Group | Correct | Default technique (class) × runs | Infra fails |
|---|---|---|---|---|
| 001-quadratic-three-points | hard | 5/5 | three-point-regression(gold)×5 | 0 |
| 002-quadratic-inequality-integer-count | hard | 5/5 | graph-both-sides(unlisted)×1, integer-list-filter(gold)×4 | 0 |
| 003-representation-linear-model | representative | 4/4 | translate-the-words(gold)×4 | 1 |
| 004-factor-shared-zero-integer-slider | hard | 5/5 | substitution(bad)×2, shared-zero(gold)×2, integer-list-filter(acceptable)×1 | 0 |
| 005-constraint-regression-intersection | hard | 5/5 | bracket-regression(gold)×5 | 0 |
| 006-identity-regression-r-plus-s | hard | 5/5 | bracket-regression(unlisted)×1, identity-regression(gold)×4 | 0 |
| 007-infinitely-many-ratio | hard | 5/5 | elimination(unlisted)×1, direct-arithmetic(gold)×4 | 0 |
| 008-restricted-domain-minimum | representative | 5/5 | restricted-extremum(gold)×4, function-evaluation(acceptable)×1 | 0 |
| 009-integer-list-coefficient-read | hard | 5/5 | answer-choice-list(bad)×2, direct-arithmetic(unlisted)×2, slider-condition(unlisted)×1 | 0 |
| 010-infinite-solutions-gk-ratio | representative | 4/4 | identity-regression(unlisted)×2, direct-arithmetic(gold)×1, slider-condition(acceptable)×1 | 1 |
| 011-no-solution-slider-both-graphed | hard | 1/1 | direct-arithmetic(unlisted)×1 | 4 |
| 012-circle-radius | representative | 1/1 | expanded-circle(acceptable)×1 | 4 |
| 013-trig-intersection | representative | 1/1 | intercept-read(acceptable)×1 | 4 |
| 014-stdev-list | representative | 1/1 | statistics-builtin(gold)×1 | 4 |
| 015-two-way-table-probability | representative | 2/2 | function-evaluation(unlisted)×2 | 3 |
| 016-tangent-line-parabola | hard | 1/1 | vertex-of-difference(gold)×1 | 4 |
