# Benchmark: current-cleanup-r2 (after the second round of fixes, commit 785b0f1)

Configuration: `{"model":"gpt-5-mini","reasoningEffort":"low","serviceTier":"priority","promptConfigVersion":"be5900447d7781e4a2676c05"}`. 47 cases × 1 runs.
Compared with `current` (prompt 1547a2d6c32db7781bbc2bc2).

## Metrics

Runs: 47 (47 scored; representative 47, hard 0).

| Metric | All | Δ all | Representative | Δ rep | Hard | Δ hard |
|---|---|---|---|---|---|---|
| Answer accuracy | 95.7% | -2.2 ✗ | 95.7% | -2.2 ✗ | — | — |
| Recommended = gold strategy | 55.3% | +11.8 ✓ | 55.3% | +11.8 ✓ | — | — |
| Recommended = gold or acceptable | 89.4% | +26.4 ✓ | 89.4% | +26.4 ✓ | — | — |
| Recommended = bad strategy | 4.3% | -6.6 ✓ | 4.3% | -6.6 ✓ | — | — |
| Recommended = unlabeled strategy | 6.4% | -19.7 ✓ | 6.4% | -19.7 ✓ | — | — |
| Math-heavy default (math score ≥ 2) | 2.1% | -2.2 ✓ | 2.1% | -2.2 ✓ | — | — |
| Gold strategy listed (default or alternative) | 80.9% | +13.5 ✓ | 80.9% | +13.5 ✓ | — | — |
| Avg Desmos rows (default) | 1.91 | -0.11 ✓ | 1.91 | -0.11 ✓ | — | — |
| Avg manual-math score (default) | 0.3 | +0.06 ✗ | 0.3 | +0.06 ✗ | — | — |
| Avg hidden derivation (calculator defaults) | 0.11 | +0.11 ✗ | 0.11 | +0.11 ✗ | — | — |
| Avg methods listed | 2.77 | +0.31 ✓ | 2.77 | +0.31 ✓ | — | — |
| Avg distinct method families listed | 2.34 | +0.17 ✓ | 2.34 | +0.17 ✓ | — | — |
| Explanation rubric score (0–1) | 0.97 | 0 | 0.97 | 0 | — | — |
| Solver failure rate | 0% | -2.1 ✓ | 0% | -2.1 ✓ | — | — |
| Clarification rate | 0% | 0 | 0% | 0 | — | — |
| Validation retry rate | 6.4% | -6.6 ✓ | 6.4% | -6.6 ✓ | — | — |
| Desmos retry rate | 0% | 0 | 0% | 0 | — | — |
| Explanation fallback rate | 0% | 0 | 0% | 0 | — | — |
| Infrastructure failures (excluded) | 0% | 0 | 0% | 0 | — | — |
| Time to first useful result p50 (ms) | 12110 | -143 ✓ | 12110 | -143 ✓ | — | — |
| Time to first useful result p75 (ms) | 15422 | -296 ✓ | 15422 | -296 ✓ | — | — |
| Time to first useful result p95 (ms) | 30683 | -2504 ✓ | 30683 | -2504 ✓ | — | — |
| Complete p50 (ms) | 16155 | -530 ✓ | 16155 | -530 ✓ | — | — |
| Complete p95 (ms) | 35263 | -1492 ✓ | 35263 | -1492 ✓ | — | — |
| Output tokens per solve | 2916.15 | -281.72 ✓ | 2916.15 | -281.72 ✓ | — | — |

## Where the time goes (per solve)

| Stage | Runs | p50 ms | p95 ms |
|---|---|---|---|
| cache_lookup | 47 | 0 | 0 |
| model_candidates | 47 | 12106 | 30676 |
| cache_lookup_problem | 47 | 0 | 0 |
| validate_select | 47 | 2 | 8 |
| cache_write | 47 | 0 | 0 |
| resolve | 47 | 0 | 0 |
| model_explanation | 47 | 3810 | 5579 |
| explanation | 47 | 3811 | 5580 |
| desmos_rescue | 3 | 21907 | 26264 |

## Validation rejections

| Rule | Rejected candidates |
|---|---|
| answer-consistency | 7 |
| condition-incomplete | 3 |
| row-fails-to-insert | 3 |
| answers-different-question | 2 |
| hidden-derivation | 1 |
| list-shape | 1 |
| duplicate-technique | 1 |

Desmos rescues: applied 3.

## Per case

| Case | Group | Correct | Default technique (class) × runs | Infra fails |
|---|---|---|---|---|
| 003-representation-linear-model | representative | 1/1 | translate-the-words(gold)×1 | 0 |
| 008-restricted-domain-minimum | representative | 1/1 | restricted-extremum(gold)×1 | 0 |
| 010-infinite-solutions-gk-ratio | representative | 1/1 | bracket-regression(acceptable)×1 | 0 |
| 012-circle-radius | representative | 1/1 | graph-raw(gold)×1 | 0 |
| 013-trig-intersection | representative | 1/1 | intercept-read(acceptable)×1 | 0 |
| 014-stdev-list | representative | 1/1 | statistics-builtin(gold)×1 | 0 |
| 015-two-way-table-probability | representative | 1/1 | direct-arithmetic(gold)×1 | 0 |
| 032-linear-equation-fractions | representative | 1/1 | intercept-read(acceptable)×1 | 0 |
| 033-linear-table-x-intercept | representative | 1/1 | linear-regression(gold)×1 | 0 |
| 034-linear-system-x-minus-y | representative | 1/1 | graph-raw(acceptable)×1 | 0 |
| 035-bakery-system-word-problem | representative | 1/1 | graph-raw(acceptable)×1 | 0 |
| 036-moving-budget-inequality | representative | 0/1 | graph-both-sides(gold)×1 | 0 |
| 037-absolute-value-one-solution | representative | 1/1 | slider-condition(gold)×1 | 0 |
| 038-interpret-drain-rate | representative | 1/1 | derivative-slope(unlisted)×1 | 0 |
| 039-representation-bouquet-roses | representative | 1/1 | translate-the-words(gold)×1 | 0 |
| 040-no-solution-parameter-k | representative | 1/1 | slider-parallel(gold)×1 | 0 |
| 041-infinitely-many-parameter-k | representative | 1/1 | answer-choice-list(unlisted)×1 | 0 |
| 042-inequality-system-point | representative | 1/1 | answer-choice-list(acceptable)×1 | 0 |
| 043-linear-growth-initial-members | representative | 1/1 | linear-regression(gold)×1 | 0 |
| 046-quadratic-zero-choice | representative | 1/1 | intercept-read(gold)×1 | 0 |
| 047-projectile-maximum-height | representative | 1/1 | vertex-read(gold)×1 | 0 |
| 048-exponential-model-evaluation | representative | 1/1 | direct-arithmetic(acceptable)×1 | 0 |
| 049-exponential-growth-representation | representative | 1/1 | translate-the-words(gold)×1 | 0 |
| 050-function-composition | representative | 1/1 | direct-arithmetic(acceptable)×1 | 0 |
| 051-identity-unknown-constants | representative | 1/1 | identity-regression(gold)×1 | 0 |
| 052-rational-equation | representative | 1/1 | intercept-read(gold)×1 | 0 |
| 053-radical-extraneous-root | representative | 1/1 | intercept-read(gold)×1 | 0 |
| 054-factor-theorem-unknown-coefficient | representative | 1/1 | shared-zero(acceptable)×1 | 0 |
| 055-line-tangent-parabola-slider | representative | 1/1 | answer-choice-list(acceptable)×1 | 0 |
| 056-count-circle-parabola-intersections | representative | 1/1 | count-intersections(gold)×1 | 0 |
| 057-function-transformation-shift | representative | 1/1 | answer-choice-list(unlisted)×1 | 0 |
| 060-mean-minus-median-homework-list | representative | 1/1 | statistics-builtin(gold)×1 | 0 |
| 061-stdev-compare-same-mean-range | representative | 0/1 | statistics-builtin(gold)×1 | 0 |
| 062-reverse-percent-increase-price | representative | 1/1 | graph-both-sides(gold)×1 | 0 |
| 063-square-feet-to-square-yards-cost | representative | 1/1 | calculator-arithmetic(gold)×1 | 0 |
| 064-two-way-table-conditional-salad-bar | representative | 1/1 | list-evaluation(bad)×1 | 0 |
| 065-line-of-best-fit-tank-empty | representative | 1/1 | linear-regression(gold)×1 | 0 |
| 066-ratio-with-total-smoothie | representative | 1/1 | direct-arithmetic(acceptable)×1 | 0 |
| 067-weighted-mean-two-classes | representative | 1/1 | statistics-builtin(gold)×1 | 0 |
| 068-margin-of-error-inference | representative | 1/1 | translate-the-words(gold)×1 | 0 |
| 069-expanded-circle-radius-graph | representative | 1/1 | expanded-circle(acceptable)×1 | 0 |
| 070-diameter-endpoints-radius-distance | representative | 1/1 | distance-builtin(gold)×1 | 0 |
| 071-triangle-area-from-coordinates | representative | 1/1 | calculator-arithmetic(acceptable)×1 | 0 |
| 072-similar-triangles-parallel-segment | representative | 1/1 | answer-choice-list(acceptable)×1 | 0 |
| 073-right-triangle-tangent | representative | 1/1 | answer-choice-list(acceptable)×1 | 0 |
| 074-arc-length-central-angle | representative | 1/1 | direct-arithmetic(bad)×1 | 0 |
| 075-cylinder-minus-sphere-volume | representative | 1/1 | calculator-arithmetic(acceptable)×1 | 0 |
