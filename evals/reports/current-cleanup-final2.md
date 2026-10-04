# Benchmark: current-cleanup-final2 (final commit a31f837, rescue on, 2 runs per case)

Configuration: `{"model":"gpt-5-mini","reasoningEffort":"low","serviceTier":"priority","promptConfigVersion":"be5900447d7781e4a2676c05"}`. 47 cases × 2 runs.
Compared with `baseline-rerun` (prompt 1547a2d6c32db7781bbc2bc2).

## Metrics

Runs: 94 (94 scored; representative 94, hard 0).

| Metric | All | Δ all | Representative | Δ rep | Hard | Δ hard |
|---|---|---|---|---|---|---|
| Answer accuracy | 98.9% | +1 ✓ | 98.9% | +1 ✓ | — | — |
| Recommended = gold strategy | 57.4% | +15.9 ✓ | 57.4% | +15.9 ✓ | — | — |
| Recommended = gold or acceptable | 86.2% | +20.2 ✓ | 86.2% | +20.2 ✓ | — | — |
| Recommended = bad strategy | 7.4% | -1.1 ✓ | 7.4% | -1.1 ✓ | — | — |
| Recommended = unlabeled strategy | 6.4% | -19.1 ✓ | 6.4% | -19.1 ✓ | — | — |
| Math-heavy default (math score ≥ 2) | 2.1% | -1.1 ✓ | 2.1% | -1.1 ✓ | — | — |
| Gold strategy listed (default or alternative) | 77.7% | +9.6 ✓ | 77.7% | +9.6 ✓ | — | — |
| Avg Desmos rows (default) | 2.14 | +0.25 ✗ | 2.14 | +0.25 ✗ | — | — |
| Avg manual-math score (default) | 0.26 | +0.04 ✗ | 0.26 | +0.04 ✗ | — | — |
| Avg hidden derivation (calculator defaults) | 0.11 | +0.1 ✗ | 0.11 | +0.1 ✗ | — | — |
| Avg methods listed | 2.87 | +0.31 ✓ | 2.87 | +0.31 ✓ | — | — |
| Avg distinct method families listed | 2.33 | +0.16 ✓ | 2.33 | +0.16 ✓ | — | — |
| Explanation rubric score (0–1) | 0.96 | 0 | 0.96 | 0 | — | — |
| Solver failure rate | 0% | 0 | 0% | 0 | — | — |
| Clarification rate | 0% | 0 | 0% | 0 | — | — |
| Validation retry rate | 2.1% | -8.5 ✓ | 2.1% | -8.5 ✓ | — | — |
| Desmos retry rate | 0% | 0 | 0% | 0 | — | — |
| Explanation fallback rate | 0% | -1.1 ✓ | 0% | -1.1 ✓ | — | — |
| Infrastructure failures (excluded) | 0% | 0 | 0% | 0 | — | — |
| Time to first useful result p50 (ms) | 12832 | -514 ✓ | 12832 | -514 ✓ | — | — |
| Time to first useful result p75 (ms) | 16345 | +237 ✗ | 16345 | +237 ✗ | — | — |
| Time to first useful result p95 (ms) | 20582 | -15334 ✓ | 20582 | -15334 ✓ | — | — |
| Complete p50 (ms) | 16288 | -567 ✓ | 16288 | -567 ✓ | — | — |
| Complete p95 (ms) | 25437 | -15462 ✓ | 25437 | -15462 ✓ | — | — |
| Output tokens per solve | 2788.62 | -357.51 ✓ | 2788.62 | -357.51 ✓ | — | — |

## Where the time goes (per solve)

| Stage | Runs | p50 ms | p95 ms |
|---|---|---|---|
| cache_lookup | 94 | 0 | 0 |
| model_candidates | 94 | 12828 | 20579 |
| cache_lookup_problem | 94 | 0 | 0 |
| validate_select | 94 | 2 | 7 |
| cache_write | 94 | 0 | 0 |
| resolve | 94 | 0 | 0 |
| model_explanation | 94 | 3360 | 4983 |
| explanation | 94 | 3361 | 4984 |
| desmos_rescue | 2 | 11275 | 17057 |

## Validation rejections

| Rule | Rejected candidates |
|---|---|
| answer-consistency | 6 |
| hidden-derivation | 6 |
| condition-incomplete | 5 |
| duplicate-technique | 4 |
| list-shape | 4 |
| answers-different-question | 4 |
| row-fails-to-insert | 3 |
| duplicate-rows | 1 |
| answer-state | 1 |

Desmos rescues: applied 2.

## Per case

| Case | Group | Correct | Default technique (class) × runs | Infra fails |
|---|---|---|---|---|
| 003-representation-linear-model | representative | 2/2 | translate-the-words(gold)×2 | 0 |
| 008-restricted-domain-minimum | representative | 2/2 | restricted-extremum(gold)×2 | 0 |
| 010-infinite-solutions-gk-ratio | representative | 2/2 | slider-condition(acceptable)×1, direct-arithmetic(gold)×1 | 0 |
| 012-circle-radius | representative | 2/2 | distance-builtin(unlisted)×1, expanded-circle(acceptable)×1 | 0 |
| 013-trig-intersection | representative | 2/2 | intercept-read(acceptable)×2 | 0 |
| 014-stdev-list | representative | 2/2 | statistics-builtin(gold)×2 | 0 |
| 015-two-way-table-probability | representative | 2/2 | calculator-arithmetic(gold)×2 | 0 |
| 032-linear-equation-fractions | representative | 2/2 | intercept-read(acceptable)×2 | 0 |
| 033-linear-table-x-intercept | representative | 2/2 | linear-regression(gold)×2 | 0 |
| 034-linear-system-x-minus-y | representative | 2/2 | graph-raw(acceptable)×1, graph-both-sides(gold)×1 | 0 |
| 035-bakery-system-word-problem | representative | 2/2 | graph-both-sides(acceptable)×2 | 0 |
| 036-moving-budget-inequality | representative | 2/2 | calculator-arithmetic(bad)×1, intercept-read(unlisted)×1 | 0 |
| 037-absolute-value-one-solution | representative | 2/2 | slider-condition(gold)×2 | 0 |
| 038-interpret-drain-rate | representative | 2/2 | translate-the-words(gold)×1, derivative-slope(bad)×1 | 0 |
| 039-representation-bouquet-roses | representative | 2/2 | translate-the-words(gold)×2 | 0 |
| 040-no-solution-parameter-k | representative | 2/2 | slider-parallel(gold)×1, slider-condition(acceptable)×1 | 0 |
| 041-infinitely-many-parameter-k | representative | 2/2 | slider-condition(gold)×1, answer-choice-list(bad)×1 | 0 |
| 042-inequality-system-point | representative | 2/2 | graph-inequality(gold)×2 | 0 |
| 043-linear-growth-initial-members | representative | 2/2 | linear-regression(gold)×1, answer-choice-list(unlisted)×1 | 0 |
| 046-quadratic-zero-choice | representative | 2/2 | intercept-read(gold)×2 | 0 |
| 047-projectile-maximum-height | representative | 2/2 | vertex-read(gold)×2 | 0 |
| 048-exponential-model-evaluation | representative | 2/2 | function-evaluation(gold)×2 | 0 |
| 049-exponential-growth-representation | representative | 2/2 | translate-the-words(gold)×2 | 0 |
| 050-function-composition | representative | 2/2 | function-evaluation(gold)×2 | 0 |
| 051-identity-unknown-constants | representative | 2/2 | identity-regression(gold)×2 | 0 |
| 052-rational-equation | representative | 2/2 | intercept-read(gold)×2 | 0 |
| 053-radical-extraneous-root | representative | 1/2 | intercept-read(gold)×2 | 0 |
| 054-factor-theorem-unknown-coefficient | representative | 2/2 | shared-zero(acceptable)×2 | 0 |
| 055-line-tangent-parabola-slider | representative | 2/2 | answer-choice-list(acceptable)×1, bracket-regression(unlisted)×1 | 0 |
| 056-count-circle-parabola-intersections | representative | 2/2 | graph-both-sides(acceptable)×1, intercept-read(unlisted)×1 | 0 |
| 057-function-transformation-shift | representative | 2/2 | answer-choice-list(acceptable)×1, strategic-value-test(acceptable)×1 | 0 |
| 060-mean-minus-median-homework-list | representative | 2/2 | statistics-builtin(gold)×2 | 0 |
| 061-stdev-compare-same-mean-range | representative | 2/2 | statistics-builtin(gold)×2 | 0 |
| 062-reverse-percent-increase-price | representative | 2/2 | graph-both-sides(gold)×1, answer-choice-list(acceptable)×1 | 0 |
| 063-square-feet-to-square-yards-cost | representative | 2/2 | calculator-arithmetic(gold)×2 | 0 |
| 064-two-way-table-conditional-salad-bar | representative | 2/2 | list-evaluation(bad)×2 | 0 |
| 065-line-of-best-fit-tank-empty | representative | 2/2 | linear-regression(gold)×2 | 0 |
| 066-ratio-with-total-smoothie | representative | 2/2 | function-evaluation(acceptable)×1, integer-list-filter(unlisted)×1 | 0 |
| 067-weighted-mean-two-classes | representative | 2/2 | statistics-builtin(gold)×1, calculator-arithmetic(acceptable)×1 | 0 |
| 068-margin-of-error-inference | representative | 2/2 | translate-the-words(gold)×2 | 0 |
| 069-expanded-circle-radius-graph | representative | 2/2 | graph-raw(gold)×1, expanded-circle(acceptable)×1 | 0 |
| 070-diameter-endpoints-radius-distance | representative | 2/2 | distance-builtin(gold)×2 | 0 |
| 071-triangle-area-from-coordinates | representative | 2/2 | distance-builtin(acceptable)×2 | 0 |
| 072-similar-triangles-parallel-segment | representative | 2/2 | answer-choice-list(acceptable)×1, calculator-arithmetic(acceptable)×1 | 0 |
| 073-right-triangle-tangent | representative | 2/2 | calculator-arithmetic(acceptable)×1, right-triangle-trig(gold)×1 | 0 |
| 074-arc-length-central-angle | representative | 2/2 | direct-arithmetic(bad)×2 | 0 |
| 075-cylinder-minus-sphere-volume | representative | 2/2 | answer-choice-list(acceptable)×1, direct-arithmetic(acceptable)×1 | 0 |
