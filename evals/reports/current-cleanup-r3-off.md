# Benchmark: current-cleanup-r3-off (DESMO_DESMOS_RESCUE=off, commit 69dcc5e)

Configuration: `{"model":"gpt-5-mini","reasoningEffort":"low","serviceTier":"priority","promptConfigVersion":"be5900447d7781e4a2676c05"}`. 47 cases × 1 runs.
Compared with `current-cleanup-r3-on` (prompt be5900447d7781e4a2676c05).

## Metrics

Runs: 47 (47 scored; representative 47, hard 0).

| Metric | All | Δ all | Representative | Δ rep | Hard | Δ hard |
|---|---|---|---|---|---|---|
| Answer accuracy | 100% | 0 | 100% | 0 | — | — |
| Recommended = gold strategy | 59.6% | +4.3 ✓ | 59.6% | +4.3 ✓ | — | — |
| Recommended = gold or acceptable | 87.2% | +8.5 ✓ | 87.2% | +8.5 ✓ | — | — |
| Recommended = bad strategy | 8.5% | -6.4 ✓ | 8.5% | -6.4 ✓ | — | — |
| Recommended = unlabeled strategy | 4.3% | -2.1 ✓ | 4.3% | -2.1 ✓ | — | — |
| Math-heavy default (math score ≥ 2) | 6.4% | +2.1 ✗ | 6.4% | +2.1 ✗ | — | — |
| Gold strategy listed (default or alternative) | 76.6% | +4.3 ✓ | 76.6% | +4.3 ✓ | — | — |
| Avg Desmos rows (default) | 2.04 | -0.02 ✓ | 2.04 | -0.02 ✓ | — | — |
| Avg manual-math score (default) | 0.3 | -0.02 ✓ | 0.3 | -0.02 ✓ | — | — |
| Avg hidden derivation (calculator defaults) | 0.05 | -0.03 ✓ | 0.05 | -0.03 ✓ | — | — |
| Avg methods listed | 2.72 | +0.1 ✓ | 2.72 | +0.1 ✓ | — | — |
| Avg distinct method families listed | 2.26 | +0.03 ✓ | 2.26 | +0.03 ✓ | — | — |
| Explanation rubric score (0–1) | 0.97 | +0.01 ✓ | 0.97 | +0.01 ✓ | — | — |
| Solver failure rate | 0% | 0 | 0% | 0 | — | — |
| Clarification rate | 0% | 0 | 0% | 0 | — | — |
| Validation retry rate | 0% | -4.3 ✓ | 0% | -4.3 ✓ | — | — |
| Desmos retry rate | 0% | 0 | 0% | 0 | — | — |
| Explanation fallback rate | 0% | 0 | 0% | 0 | — | — |
| Infrastructure failures (excluded) | 0% | 0 | 0% | 0 | — | — |
| Time to first useful result p50 (ms) | 11747 | -247 ✓ | 11747 | -247 ✓ | — | — |
| Time to first useful result p75 (ms) | 13838 | -293 ✓ | 13838 | -293 ✓ | — | — |
| Time to first useful result p95 (ms) | 16841 | -1694 ✓ | 16841 | -1694 ✓ | — | — |
| Complete p50 (ms) | 15670 | +282 ✗ | 15670 | +282 ✗ | — | — |
| Complete p95 (ms) | 24279 | +1905 ✗ | 24279 | +1905 ✗ | — | — |
| Output tokens per solve | 2702.89 | -47.13 ✓ | 2702.89 | -47.13 ✓ | — | — |

## Where the time goes (per solve)

| Stage | Runs | p50 ms | p95 ms |
|---|---|---|---|
| cache_lookup | 47 | 0 | 0 |
| model_candidates | 47 | 11745 | 16835 |
| cache_lookup_problem | 47 | 0 | 0 |
| validate_select | 47 | 2 | 7 |
| cache_write | 47 | 0 | 1 |
| resolve | 47 | 0 | 0 |
| model_explanation | 47 | 3973 | 6149 |
| explanation | 47 | 3974 | 6150 |
| desmos_rescue | 1 | 0 | 0 |

## Validation rejections

| Rule | Rejected candidates |
|---|---|
| answer-consistency | 8 |
| hidden-derivation | 2 |
| list-shape | 2 |
| condition-incomplete | 1 |
| row-fails-to-insert | 1 |
| duplicate-technique | 1 |

Desmos rescues: none.

## Per case

| Case | Group | Correct | Default technique (class) × runs | Infra fails |
|---|---|---|---|---|
| 003-representation-linear-model | representative | 1/1 | translate-the-words(gold)×1 | 0 |
| 008-restricted-domain-minimum | representative | 1/1 | restricted-extremum(gold)×1 | 0 |
| 010-infinite-solutions-gk-ratio | representative | 1/1 | bracket-regression(acceptable)×1 | 0 |
| 012-circle-radius | representative | 1/1 | expanded-circle(acceptable)×1 | 0 |
| 013-trig-intersection | representative | 1/1 | intercept-read(acceptable)×1 | 0 |
| 014-stdev-list | representative | 1/1 | statistics-builtin(gold)×1 | 0 |
| 015-two-way-table-probability | representative | 1/1 | calculator-arithmetic(gold)×1 | 0 |
| 032-linear-equation-fractions | representative | 1/1 | intercept-read(acceptable)×1 | 0 |
| 033-linear-table-x-intercept | representative | 1/1 | linear-regression(gold)×1 | 0 |
| 034-linear-system-x-minus-y | representative | 1/1 | graph-both-sides(gold)×1 | 0 |
| 035-bakery-system-word-problem | representative | 1/1 | bracket-regression(acceptable)×1 | 0 |
| 036-moving-budget-inequality | representative | 1/1 | graph-both-sides(gold)×1 | 0 |
| 037-absolute-value-one-solution | representative | 1/1 | slider-condition(gold)×1 | 0 |
| 038-interpret-drain-rate | representative | 1/1 | translate-the-words(gold)×1 | 0 |
| 039-representation-bouquet-roses | representative | 1/1 | translate-the-words(gold)×1 | 0 |
| 040-no-solution-parameter-k | representative | 1/1 | slider-parallel(gold)×1 | 0 |
| 041-infinitely-many-parameter-k | representative | 1/1 | answer-choice-list(bad)×1 | 0 |
| 042-inequality-system-point | representative | 1/1 | graph-inequality(gold)×1 | 0 |
| 043-linear-growth-initial-members | representative | 1/1 | bracket-regression(acceptable)×1 | 0 |
| 046-quadratic-zero-choice | representative | 1/1 | intercept-read(gold)×1 | 0 |
| 047-projectile-maximum-height | representative | 1/1 | vertex-read(gold)×1 | 0 |
| 048-exponential-model-evaluation | representative | 1/1 | function-evaluation(gold)×1 | 0 |
| 049-exponential-growth-representation | representative | 1/1 | translate-the-words(gold)×1 | 0 |
| 050-function-composition | representative | 1/1 | answer-choice-list(bad)×1 | 0 |
| 051-identity-unknown-constants | representative | 1/1 | identity-regression(gold)×1 | 0 |
| 052-rational-equation | representative | 1/1 | intercept-read(gold)×1 | 0 |
| 053-radical-extraneous-root | representative | 1/1 | intercept-read(gold)×1 | 0 |
| 054-factor-theorem-unknown-coefficient | representative | 1/1 | shared-zero(acceptable)×1 | 0 |
| 055-line-tangent-parabola-slider | representative | 1/1 | vertex-of-difference(unlisted)×1 | 0 |
| 056-count-circle-parabola-intersections | representative | 1/1 | graph-both-sides(acceptable)×1 | 0 |
| 057-function-transformation-shift | representative | 1/1 | translate-the-words(bad)×1 | 0 |
| 060-mean-minus-median-homework-list | representative | 1/1 | statistics-builtin(gold)×1 | 0 |
| 061-stdev-compare-same-mean-range | representative | 1/1 | statistics-builtin(gold)×1 | 0 |
| 062-reverse-percent-increase-price | representative | 1/1 | graph-both-sides(gold)×1 | 0 |
| 063-square-feet-to-square-yards-cost | representative | 1/1 | answer-choice-list(bad)×1 | 0 |
| 064-two-way-table-conditional-salad-bar | representative | 1/1 | calculator-arithmetic(gold)×1 | 0 |
| 065-line-of-best-fit-tank-empty | representative | 1/1 | graph-both-sides(unlisted)×1 | 0 |
| 066-ratio-with-total-smoothie | representative | 1/1 | direct-arithmetic(acceptable)×1 | 0 |
| 067-weighted-mean-two-classes | representative | 1/1 | statistics-builtin(gold)×1 | 0 |
| 068-margin-of-error-inference | representative | 1/1 | translate-the-words(gold)×1 | 0 |
| 069-expanded-circle-radius-graph | representative | 1/1 | expanded-circle(acceptable)×1 | 0 |
| 070-diameter-endpoints-radius-distance | representative | 1/1 | distance-builtin(gold)×1 | 0 |
| 071-triangle-area-from-coordinates | representative | 1/1 | distance-builtin(acceptable)×1 | 0 |
| 072-similar-triangles-parallel-segment | representative | 1/1 | direct-arithmetic(acceptable)×1 | 0 |
| 073-right-triangle-tangent | representative | 1/1 | answer-choice-list(acceptable)×1 | 0 |
| 074-arc-length-central-angle | representative | 1/1 | graph-both-sides(gold)×1 | 0 |
| 075-cylinder-minus-sphere-volume | representative | 1/1 | reference-formula(gold)×1 | 0 |
