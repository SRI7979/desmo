# Recorded runs re-scored: before-enum

These runs were recorded by the previous harness on older prompt versions; they cover only the cases that existed then. Latency is in-process (no auth, upload, or database time).

- before-enum: 80 runs, prompt 73f0990e5c9c7ba26d24ab39

Runs: 80 (80 scored; representative 35, hard 45).

| Metric | All | Representative | Hard |
|---|---|---|---|
| Answer accuracy | 100% | 100% | 100% |
| Recommended = gold strategy | 62.5% | 74.3% | 53.3% |
| Recommended = gold or acceptable | 82.5% | 97.1% | 71.1% |
| Recommended = bad strategy | 6.3% | 0% | 11.1% |
| Recommended = unlabeled strategy | 11.3% | 2.9% | 17.8% |
| Math-heavy default (math score ≥ 2) | — | — | — |
| Gold strategy listed (default or alternative) | 0% | 0% | 0% |
| Avg Desmos rows (default) | — | — | — |
| Avg manual-math score (default) | — | — | — |
| Avg hidden derivation (calculator defaults) | — | — | — |
| Avg methods listed | 0 | 0 | 0 |
| Avg distinct method families listed | 0 | 0 | 0 |
| Explanation rubric score (0–1) | — | — | — |
| Solver failure rate | 0% | 0% | 0% |
| Clarification rate | 0% | 0% | 0% |
| Validation retry rate | 11.3% | 5.7% | 15.6% |
| Desmos retry rate | 0% | 0% | 0% |
| Explanation fallback rate | 0% | 0% | 0% |
| Infrastructure failures (excluded) | 0% | 0% | 0% |
| Time to first useful result p50 (ms) | 10290 | 10263 | 10370 |
| Time to first useful result p75 (ms) | 12993 | 12187 | 14023 |
| Time to first useful result p95 (ms) | 24939 | 15528 | 29044 |
| Complete p50 (ms) | 13731 | 13598 | 13972 |
| Complete p95 (ms) | 27562 | 19292 | 34336 |
| Output tokens per solve | — | — | — |

| Case | Group | Correct | Default technique (class) × runs | Infra fails |
|---|---|---|---|---|
| 001-quadratic-three-points | hard | 5/5 | clarification×5 | 0 |
| 002-quadratic-inequality-integer-count | hard | 5/5 | clarification×5 | 0 |
| 003-representation-linear-model | representative | 5/5 | clarification×5 | 0 |
| 004-factor-shared-zero-integer-slider | hard | 5/5 | clarification×5 | 0 |
| 005-constraint-regression-intersection | hard | 5/5 | clarification×5 | 0 |
| 006-identity-regression-r-plus-s | hard | 5/5 | clarification×5 | 0 |
| 007-infinitely-many-ratio | hard | 5/5 | clarification×5 | 0 |
| 008-restricted-domain-minimum | representative | 5/5 | clarification×5 | 0 |
| 009-integer-list-coefficient-read | hard | 5/5 | clarification×5 | 0 |
| 010-infinite-solutions-gk-ratio | representative | 5/5 | clarification×5 | 0 |
| 011-no-solution-slider-both-graphed | hard | 5/5 | clarification×5 | 0 |
| 012-circle-radius | representative | 5/5 | clarification×5 | 0 |
| 013-trig-intersection | representative | 5/5 | clarification×5 | 0 |
| 014-stdev-list | representative | 5/5 | clarification×5 | 0 |
| 015-two-way-table-probability | representative | 5/5 | clarification×5 | 0 |
| 016-tangent-line-parabola | hard | 5/5 | clarification×5 | 0 |
