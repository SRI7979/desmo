# Benchmark: current-cleanup-rescue-off (final A/B, DESMO_DESMOS_RESCUE=off, 2 runs per case, commit dbc190d)

Configuration: `{"model":"gpt-5-mini","reasoningEffort":"low","serviceTier":"priority","promptConfigVersion":"be5900447d7781e4a2676c05"}`. 47 cases × 2 runs.
Compared with `current-cleanup` (prompt be5900447d7781e4a2676c05).

## Metrics

Runs: 94 (94 scored; representative 94, hard 0).

| Metric | All | Δ all | Representative | Δ rep | Hard | Δ hard |
|---|---|---|---|---|---|---|
| Answer accuracy | 95.7% | -1.1 ✗ | 95.7% | -1.1 ✗ | — | — |
| Recommended = gold strategy | 55.3% | +2.1 ✓ | 55.3% | +2.1 ✓ | — | — |
| Recommended = gold or acceptable | 84% | -1.1 ✗ | 84% | -1.1 ✗ | — | — |
| Recommended = bad strategy | 11.7% | 0 | 11.7% | 0 | — | — |
| Recommended = unlabeled strategy | 4.3% | +1.1 ✗ | 4.3% | +1.1 ✗ | — | — |
| Math-heavy default (math score ≥ 2) | 8.5% | +1.1 ✗ | 8.5% | +1.1 ✗ | — | — |
| Gold strategy listed (default or alternative) | 73.4% | -5.3 ✗ | 73.4% | -5.3 ✗ | — | — |
| Avg Desmos rows (default) | 1.81 | -0.22 ✓ | 1.81 | -0.22 ✓ | — | — |
| Avg manual-math score (default) | 0.33 | +0.05 ✗ | 0.33 | +0.05 ✗ | — | — |
| Avg hidden derivation (calculator defaults) | 0.04 | -0.03 ✓ | 0.04 | -0.03 ✓ | — | — |
| Avg methods listed | 2.65 | -0.15 ✗ | 2.65 | -0.15 ✗ | — | — |
| Avg distinct method families listed | 2.22 | -0.13 ✗ | 2.22 | -0.13 ✗ | — | — |
| Explanation rubric score (0–1) | 0.97 | +0.01 ✓ | 0.97 | +0.01 ✓ | — | — |
| Solver failure rate | 0% | 0 | 0% | 0 | — | — |
| Clarification rate | 0% | 0 | 0% | 0 | — | — |
| Validation retry rate | 0% | -1.1 ✓ | 0% | -1.1 ✓ | — | — |
| Desmos retry rate | 0% | 0 | 0% | 0 | — | — |
| Explanation fallback rate | 0% | 0 | 0% | 0 | — | — |
| Infrastructure failures (excluded) | 0% | 0 | 0% | 0 | — | — |
| Time to first useful result p50 (ms) | 11549 | -846 ✓ | 11549 | -846 ✓ | — | — |
| Time to first useful result p75 (ms) | 14001 | +280 ✗ | 14001 | +280 ✗ | — | — |
| Time to first useful result p95 (ms) | 17203 | -138 ✓ | 17203 | -138 ✓ | — | — |
| Complete p50 (ms) | 15284 | -942 ✓ | 15284 | -942 ✓ | — | — |
| Complete p95 (ms) | 21255 | +85 ✗ | 21255 | +85 ✗ | — | — |
| Output tokens per solve | 2610.14 | -125.77 ✓ | 2610.14 | -125.77 ✓ | — | — |

## Where the time goes (per solve)

| Stage | Runs | p50 ms | p95 ms |
|---|---|---|---|
| cache_lookup | 94 | 0 | 0 |
| model_candidates | 94 | 11547 | 17199 |
| cache_lookup_problem | 94 | 0 | 0 |
| validate_select | 94 | 2 | 5 |
| cache_write | 94 | 0 | 1 |
| resolve | 94 | 0 | 0 |
| model_explanation | 94 | 3660 | 5432 |
| explanation | 94 | 3663 | 5433 |
| desmos_rescue | 1 | 0 | 0 |

## Validation rejections

| Rule | Rejected candidates |
|---|---|
| answer-consistency | 13 |
| row-fails-to-insert | 6 |
| condition-incomplete | 5 |
| hidden-derivation | 4 |
| duplicate-rows | 4 |
| list-shape | 4 |
| answers-different-question | 4 |
| duplicate-technique | 1 |
| answer-state | 1 |

Desmos rescues: none.

## Per case

| Case | Group | Correct | Default technique (class) × runs | Infra fails |
|---|---|---|---|---|
| 003-representation-linear-model | representative | 2/2 | translate-the-words(gold)×2 | 0 |
| 008-restricted-domain-minimum | representative | 2/2 | restricted-extremum(gold)×2 | 0 |
| 010-infinite-solutions-gk-ratio | representative | 2/2 | direct-arithmetic(gold)×1, bracket-regression(acceptable)×1 | 0 |
| 012-circle-radius | representative | 2/2 | expanded-circle(acceptable)×2 | 0 |
| 013-trig-intersection | representative | 2/2 | intercept-read(acceptable)×2 | 0 |
| 014-stdev-list | representative | 2/2 | statistics-builtin(gold)×2 | 0 |
| 015-two-way-table-probability | representative | 2/2 | direct-arithmetic(gold)×2 | 0 |
| 032-linear-equation-fractions | representative | 2/2 | intercept-read(acceptable)×2 | 0 |
| 033-linear-table-x-intercept | representative | 1/2 | linear-regression(gold)×2 | 0 |
| 034-linear-system-x-minus-y | representative | 2/2 | graph-both-sides(gold)×1, bracket-regression(acceptable)×1 | 0 |
| 035-bakery-system-word-problem | representative | 2/2 | graph-both-sides(acceptable)×2 | 0 |
| 036-moving-budget-inequality | representative | 2/2 | ceil-floor(bad)×1, intercept-read(unlisted)×1 | 0 |
| 037-absolute-value-one-solution | representative | 2/2 | slider-condition(gold)×2 | 0 |
| 038-interpret-drain-rate | representative | 2/2 | graph-raw(bad)×1, translate-the-words(gold)×1 | 0 |
| 039-representation-bouquet-roses | representative | 2/2 | translate-the-words(gold)×2 | 0 |
| 040-no-solution-parameter-k | representative | 2/2 | slider-parallel(gold)×1, graph-both-sides(unlisted)×1 | 0 |
| 041-infinitely-many-parameter-k | representative | 2/2 | derivative-regression(unlisted)×1, slider-parallel(acceptable)×1 | 0 |
| 042-inequality-system-point | representative | 2/2 | graph-inequality(gold)×2 | 0 |
| 043-linear-growth-initial-members | representative | 2/2 | bracket-regression(acceptable)×1, linear-regression(gold)×1 | 0 |
| 046-quadratic-zero-choice | representative | 2/2 | intercept-read(gold)×2 | 0 |
| 047-projectile-maximum-height | representative | 2/2 | vertex-read(gold)×2 | 0 |
| 048-exponential-model-evaluation | representative | 2/2 | function-evaluation(gold)×2 | 0 |
| 049-exponential-growth-representation | representative | 2/2 | translate-the-words(gold)×2 | 0 |
| 050-function-composition | representative | 2/2 | function-evaluation(gold)×2 | 0 |
| 051-identity-unknown-constants | representative | 2/2 | identity-regression(gold)×2 | 0 |
| 052-rational-equation | representative | 2/2 | intercept-read(gold)×2 | 0 |
| 053-radical-extraneous-root | representative | 0/2 | intercept-read(gold)×2 | 0 |
| 054-factor-theorem-unknown-coefficient | representative | 2/2 | shared-zero(acceptable)×2 | 0 |
| 055-line-tangent-parabola-slider | representative | 2/2 | slider-condition(gold)×1, answer-choice-list(acceptable)×1 | 0 |
| 056-count-circle-parabola-intersections | representative | 1/2 | count-intersections(gold)×1, intercept-read(unlisted)×1 | 0 |
| 057-function-transformation-shift | representative | 2/2 | strategic-value-test(acceptable)×1, translate-the-words(bad)×1 | 0 |
| 060-mean-minus-median-homework-list | representative | 2/2 | statistics-builtin(gold)×2 | 0 |
| 061-stdev-compare-same-mean-range | representative | 2/2 | statistics-builtin(gold)×2 | 0 |
| 062-reverse-percent-increase-price | representative | 2/2 | graph-both-sides(gold)×1, answer-choice-list(acceptable)×1 | 0 |
| 063-square-feet-to-square-yards-cost | representative | 2/2 | answer-choice-list(bad)×2 | 0 |
| 064-two-way-table-conditional-salad-bar | representative | 2/2 | list-evaluation(bad)×1, direct-arithmetic(gold)×1 | 0 |
| 065-line-of-best-fit-tank-empty | representative | 2/2 | calculator-arithmetic(bad)×1, direct-arithmetic(bad)×1 | 0 |
| 066-ratio-with-total-smoothie | representative | 2/2 | function-evaluation(acceptable)×1, direct-arithmetic(acceptable)×1 | 0 |
| 067-weighted-mean-two-classes | representative | 2/2 | calculator-arithmetic(acceptable)×1, statistics-builtin(gold)×1 | 0 |
| 068-margin-of-error-inference | representative | 2/2 | translate-the-words(gold)×2 | 0 |
| 069-expanded-circle-radius-graph | representative | 2/2 | expanded-circle(acceptable)×2 | 0 |
| 070-diameter-endpoints-radius-distance | representative | 2/2 | distance-builtin(gold)×2 | 0 |
| 071-triangle-area-from-coordinates | representative | 2/2 | distance-builtin(acceptable)×2 | 0 |
| 072-similar-triangles-parallel-segment | representative | 2/2 | calculator-arithmetic(acceptable)×1, answer-choice-list(acceptable)×1 | 0 |
| 073-right-triangle-tangent | representative | 2/2 | direct-arithmetic(bad)×1, right-triangle-trig(gold)×1 | 0 |
| 074-arc-length-central-angle | representative | 2/2 | calculator-arithmetic(bad)×1, direct-arithmetic(bad)×1 | 0 |
| 075-cylinder-minus-sphere-volume | representative | 2/2 | reference-formula(gold)×1, direct-arithmetic(acceptable)×1 | 0 |
