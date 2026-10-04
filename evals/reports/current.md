# Benchmark: current

Configuration: `{"model":"gpt-5-mini","reasoningEffort":"low","serviceTier":"priority","promptConfigVersion":"1547a2d6c32db7781bbc2bc2"}`. 47 cases × 1 runs.


## Metrics

Runs: 47 (47 scored; representative 47, hard 0).

| Metric | All | Representative | Hard |
|---|---|---|---|
| Answer accuracy | 97.9% | 97.9% | — |
| Recommended = gold strategy | 43.5% | 43.5% | — |
| Recommended = gold or acceptable | 63% | 63% | — |
| Recommended = bad strategy | 10.9% | 10.9% | — |
| Recommended = unlabeled strategy | 26.1% | 26.1% | — |
| Math-heavy default (math score ≥ 2) | 4.3% | 4.3% | — |
| Gold strategy listed (default or alternative) | 67.4% | 67.4% | — |
| Avg Desmos rows (default) | 2.02 | 2.02 | — |
| Avg manual-math score (default) | 0.24 | 0.24 | — |
| Avg hidden derivation (calculator defaults) | 0 | 0 | — |
| Avg methods listed | 2.46 | 2.46 | — |
| Avg distinct method families listed | 2.17 | 2.17 | — |
| Explanation rubric score (0–1) | 0.97 | 0.97 | — |
| Solver failure rate | 2.1% | 2.1% | — |
| Clarification rate | 0% | 0% | — |
| Validation retry rate | 13% | 13% | — |
| Desmos retry rate | 0% | 0% | — |
| Explanation fallback rate | 0% | 0% | — |
| Infrastructure failures (excluded) | 0% | 0% | — |
| Time to first useful result p50 (ms) | 12253 | 12253 | — |
| Time to first useful result p75 (ms) | 15718 | 15718 | — |
| Time to first useful result p95 (ms) | 33187 | 33187 | — |
| Complete p50 (ms) | 16685 | 16685 | — |
| Complete p95 (ms) | 36755 | 36755 | — |
| Output tokens per solve | 3197.87 | 3197.87 | — |

## Where the time goes (per solve)

| Stage | Runs | p50 ms | p95 ms |
|---|---|---|---|
| cache_lookup | 47 | 0 | 0 |
| model_candidates | 47 | 12250 | 33179 |
| cache_lookup_problem | 47 | 0 | 0 |
| validate_select | 47 | 2 | 5 |
| cache_write | 47 | 0 | 0 |
| resolve | 47 | 0 | 0 |
| model_explanation | 47 | 3666 | 6134 |
| explanation | 47 | 3666 | 6135 |
| desmos_rescue | 4 | 10618 | 17232 |

## Validation rejections

| Rule | Rejected candidates |
|---|---|
| answer-consistency | 7 |
| row-fails-to-insert | 6 |
| condition-incomplete | 4 |
| answers-different-question | 3 |
| list-shape | 2 |
| duplicate-rows | 2 |
| hidden-derivation | 1 |

Desmos rescues: applied 3, kept 1.

## Per case

| Case | Group | Correct | Default technique (class) × runs | Infra fails |
|---|---|---|---|---|
| 003-representation-linear-model | representative | 1/1 | translate-the-words(gold)×1 | 0 |
| 008-restricted-domain-minimum | representative | 1/1 | restricted-extremum(gold)×1 | 0 |
| 010-infinite-solutions-gk-ratio | representative | 1/1 | bracket-regression(acceptable)×1 | 0 |
| 012-circle-radius | representative | 1/1 | expanded-circle(acceptable)×1 | 0 |
| 013-trig-intersection | representative | 1/1 | intercept-read(acceptable)×1 | 0 |
| 014-stdev-list | representative | 1/1 | statistics-builtin(gold)×1 | 0 |
| 015-two-way-table-probability | representative | 1/1 | direct-arithmetic(gold)×1 | 0 |
| 032-linear-equation-fractions | representative | 1/1 | intercept-read(acceptable)×1 | 0 |
| 033-linear-table-x-intercept | representative | 1/1 | intercept-read(bad)×1 | 0 |
| 034-linear-system-x-minus-y | representative | 1/1 | graph-both-sides(gold)×1 | 0 |
| 035-bakery-system-word-problem | representative | 1/1 | bracket-regression(acceptable)×1 | 0 |
| 036-moving-budget-inequality | representative | 1/1 | graph-both-sides(gold)×1 | 0 |
| 037-absolute-value-one-solution | representative | 1/1 | direct-arithmetic(bad)×1 | 0 |
| 038-interpret-drain-rate | representative | 1/1 | translate-the-words(gold)×1 | 0 |
| 039-representation-bouquet-roses | representative | 1/1 | direct-arithmetic(unlisted)×1 | 0 |
| 040-no-solution-parameter-k | representative | 1/1 | derivative-regression(bad)×1 | 0 |
| 041-infinitely-many-parameter-k | representative | 1/1 | direct-arithmetic(bad)×1 | 0 |
| 042-inequality-system-point | representative | 1/1 | answer-choice-list(acceptable)×1 | 0 |
| 043-linear-growth-initial-members | representative | 1/1 | linear-regression(gold)×1 | 0 |
| 046-quadratic-zero-choice | representative | 1/1 | intercept-read(gold)×1 | 0 |
| 047-projectile-maximum-height | representative | 1/1 | vertex-read(gold)×1 | 0 |
| 048-exponential-model-evaluation | representative | 1/1 | function-evaluation(gold)×1 | 0 |
| 049-exponential-growth-representation | representative | 1/1 | translate-the-words(gold)×1 | 0 |
| 050-function-composition | representative | 1/1 | function-evaluation(gold)×1 | 0 |
| 051-identity-unknown-constants | representative | 1/1 | identity-regression(gold)×1 | 0 |
| 052-rational-equation | representative | 1/1 | intercept-read(gold)×1 | 0 |
| 053-radical-extraneous-root | representative | 1/1 | intercept-read(gold)×1 | 0 |
| 054-factor-theorem-unknown-coefficient | representative | 1/1 | shared-zero(acceptable)×1 | 0 |
| 055-line-tangent-parabola-slider | representative | 1/1 | graph-each-choice(acceptable)×1 | 0 |
| 056-count-circle-parabola-intersections | representative | 1/1 | count-intersections(gold)×1 | 0 |
| 057-function-transformation-shift | representative | 1/1 | function-evaluation(unlisted)×1 | 0 |
| 060-mean-minus-median-homework-list | representative | 1/1 | list-evaluation(unlisted)×1 | 0 |
| 061-stdev-compare-same-mean-range | representative | 1/1 | list-evaluation(unlisted)×1 | 0 |
| 062-reverse-percent-increase-price | representative | 1/1 | intercept-read(unlisted)×1 | 0 |
| 063-square-feet-to-square-yards-cost | representative | 1/1 | answer-choice-list(bad)×1 | 0 |
| 064-two-way-table-conditional-salad-bar | representative | 1/1 | direct-arithmetic(gold)×1 | 0 |
| 065-line-of-best-fit-tank-empty | representative | 1/1 | answer-choice-list(unlisted)×1 | 0 |
| 066-ratio-with-total-smoothie | representative | 1/1 | function-evaluation(unlisted)×1 | 0 |
| 067-weighted-mean-two-classes | representative | 1/1 | function-evaluation(unlisted)×1 | 0 |
| 068-margin-of-error-inference | representative | 1/1 | translate-the-words(gold)×1 | 0 |
| 069-expanded-circle-radius-graph | representative | 1/1 | expanded-circle(acceptable)×1 | 0 |
| 070-diameter-endpoints-radius-distance | representative | 1/1 | distance-builtin(gold)×1 | 0 |
| 071-triangle-area-from-coordinates | representative | 1/1 | distance-builtin(unlisted)×1 | 0 |
| 072-similar-triangles-parallel-segment | representative | 1/1 | function-evaluation(unlisted)×1 | 0 |
| 073-right-triangle-tangent | representative | 1/1 | direct-arithmetic(unlisted)×1 | 0 |
| 074-arc-length-central-angle | representative | 0/1 | FAILED×1 | 0 |
| 075-cylinder-minus-sphere-volume | representative | 1/1 | answer-choice-list(unlisted)×1 | 0 |
