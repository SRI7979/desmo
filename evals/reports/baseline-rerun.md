# Benchmark: baseline-rerun (the original code, commit ad02029, 2 runs per case; scored here with that commit's labels)

Configuration: `{"model":"gpt-5-mini","reasoningEffort":"low","serviceTier":"priority","promptConfigVersion":"1547a2d6c32db7781bbc2bc2"}`. 47 cases × 2 runs.


## Metrics

Runs: 94 (94 scored; representative 94, hard 0).

| Metric | All | Representative | Hard |
|---|---|---|---|
| Answer accuracy | 97.9% | 97.9% | — |
| Recommended = gold strategy | 41.5% | 41.5% | — |
| Recommended = gold or acceptable | 66% | 66% | — |
| Recommended = bad strategy | 8.5% | 8.5% | — |
| Recommended = unlabeled strategy | 25.5% | 25.5% | — |
| Math-heavy default (math score ≥ 2) | 3.2% | 3.2% | — |
| Gold strategy listed (default or alternative) | 68.1% | 68.1% | — |
| Avg Desmos rows (default) | 1.89 | 1.89 | — |
| Avg manual-math score (default) | 0.22 | 0.22 | — |
| Avg hidden derivation (calculator defaults) | 0.01 | 0.01 | — |
| Avg methods listed | 2.56 | 2.56 | — |
| Avg distinct method families listed | 2.17 | 2.17 | — |
| Explanation rubric score (0–1) | 0.96 | 0.96 | — |
| Solver failure rate | 0% | 0% | — |
| Clarification rate | 0% | 0% | — |
| Validation retry rate | 10.6% | 10.6% | — |
| Desmos retry rate | 0% | 0% | — |
| Explanation fallback rate | 1.1% | 1.1% | — |
| Infrastructure failures (excluded) | 0% | 0% | — |
| Time to first useful result p50 (ms) | 13346 | 13346 | — |
| Time to first useful result p75 (ms) | 16108 | 16108 | — |
| Time to first useful result p95 (ms) | 35916 | 35916 | — |
| Complete p50 (ms) | 16855 | 16855 | — |
| Complete p95 (ms) | 40899 | 40899 | — |
| Output tokens per solve | 3146.13 | 3146.13 | — |

## Where the time goes (per solve)

| Stage | Runs | p50 ms | p95 ms |
|---|---|---|---|
| cache_lookup | 94 | 0 | 0 |
| model_candidates | 94 | 13343 | 35911 |
| cache_lookup_problem | 94 | 0 | 0 |
| validate_select | 94 | 2 | 5 |
| cache_write | 94 | 0 | 0 |
| resolve | 94 | 0 | 0 |
| model_explanation | 94 | 3589 | 5741 |
| explanation | 94 | 3590 | 5742 |
| desmos_rescue | 8 | 18232 | 26064 |

## Validation rejections

| Rule | Rejected candidates |
|---|---|
| answer-consistency | 12 |
| row-fails-to-insert | 9 |
| duplicate-rows | 5 |
| answers-different-question | 5 |
| condition-incomplete | 5 |
| list-shape | 3 |
| hidden-derivation | 2 |
| answer-state | 2 |

Desmos rescues: applied 7, kept 1.

## Per case

| Case | Group | Correct | Default technique (class) × runs | Infra fails |
|---|---|---|---|---|
| 003-representation-linear-model | representative | 2/2 | translate-the-words(gold)×2 | 0 |
| 008-restricted-domain-minimum | representative | 2/2 | restricted-extremum(gold)×2 | 0 |
| 010-infinite-solutions-gk-ratio | representative | 2/2 | bracket-regression(acceptable)×2 | 0 |
| 012-circle-radius | representative | 2/2 | expanded-circle(acceptable)×2 | 0 |
| 013-trig-intersection | representative | 2/2 | intercept-read(acceptable)×2 | 0 |
| 014-stdev-list | representative | 2/2 | statistics-builtin(gold)×2 | 0 |
| 015-two-way-table-probability | representative | 2/2 | direct-arithmetic(gold)×1, function-evaluation(unlisted)×1 | 0 |
| 032-linear-equation-fractions | representative | 2/2 | intercept-read(acceptable)×1, graph-raw(acceptable)×1 | 0 |
| 033-linear-table-x-intercept | representative | 2/2 | bracket-regression(acceptable)×2 | 0 |
| 034-linear-system-x-minus-y | representative | 2/2 | graph-both-sides(gold)×1, bracket-regression(acceptable)×1 | 0 |
| 035-bakery-system-word-problem | representative | 1/2 | graph-both-sides(acceptable)×2 | 0 |
| 036-moving-budget-inequality | representative | 1/2 | ceil-floor(bad)×1, intercept-read(unlisted)×1 | 0 |
| 037-absolute-value-one-solution | representative | 2/2 | direct-arithmetic(bad)×2 | 0 |
| 038-interpret-drain-rate | representative | 2/2 | derivative-slope(unlisted)×1, translate-the-words(gold)×1 | 0 |
| 039-representation-bouquet-roses | representative | 2/2 | translate-the-words(gold)×2 | 0 |
| 040-no-solution-parameter-k | representative | 2/2 | direct-arithmetic(bad)×2 | 0 |
| 041-infinitely-many-parameter-k | representative | 2/2 | plug-in-choices(bad)×1, answer-choice-list(unlisted)×1 | 0 |
| 042-inequality-system-point | representative | 2/2 | graph-inequality(gold)×2 | 0 |
| 043-linear-growth-initial-members | representative | 2/2 | answer-choice-list(unlisted)×1, linear-regression(gold)×1 | 0 |
| 046-quadratic-zero-choice | representative | 2/2 | intercept-read(gold)×2 | 0 |
| 047-projectile-maximum-height | representative | 2/2 | vertex-read(gold)×2 | 0 |
| 048-exponential-model-evaluation | representative | 2/2 | graph-raw(unlisted)×1, function-evaluation(gold)×1 | 0 |
| 049-exponential-growth-representation | representative | 2/2 | translate-the-words(gold)×1, direct-arithmetic(unlisted)×1 | 0 |
| 050-function-composition | representative | 2/2 | function-evaluation(gold)×2 | 0 |
| 051-identity-unknown-constants | representative | 2/2 | identity-regression(gold)×2 | 0 |
| 052-rational-equation | representative | 2/2 | graph-raw(unlisted)×2 | 0 |
| 053-radical-extraneous-root | representative | 2/2 | intercept-read(gold)×2 | 0 |
| 054-factor-theorem-unknown-coefficient | representative | 2/2 | direct-arithmetic(bad)×1, shared-zero(acceptable)×1 | 0 |
| 055-line-tangent-parabola-slider | representative | 2/2 | answer-choice-list(acceptable)×1, slider-condition(gold)×1 | 0 |
| 056-count-circle-parabola-intersections | representative | 2/2 | count-intersections(gold)×1, intercept-read(unlisted)×1 | 0 |
| 057-function-transformation-shift | representative | 2/2 | answer-choice-list(unlisted)×1, function-evaluation(unlisted)×1 | 0 |
| 060-mean-minus-median-homework-list | representative | 2/2 | statistics-builtin(gold)×1, list-evaluation(unlisted)×1 | 0 |
| 061-stdev-compare-same-mean-range | representative | 2/2 | statistics-builtin(gold)×2 | 0 |
| 062-reverse-percent-increase-price | representative | 2/2 | answer-choice-list(acceptable)×1, intercept-read(unlisted)×1 | 0 |
| 063-square-feet-to-square-yards-cost | representative | 2/2 | function-evaluation(unlisted)×1, direct-arithmetic(gold)×1 | 0 |
| 064-two-way-table-conditional-salad-bar | representative | 2/2 | list-evaluation(bad)×1, direct-arithmetic(gold)×1 | 0 |
| 065-line-of-best-fit-tank-empty | representative | 2/2 | linear-regression(gold)×2 | 0 |
| 066-ratio-with-total-smoothie | representative | 2/2 | function-evaluation(unlisted)×2 | 0 |
| 067-weighted-mean-two-classes | representative | 2/2 | statistics-builtin(gold)×1, list-evaluation(unlisted)×1 | 0 |
| 068-margin-of-error-inference | representative | 2/2 | direct-arithmetic(acceptable)×2 | 0 |
| 069-expanded-circle-radius-graph | representative | 2/2 | expanded-circle(acceptable)×2 | 0 |
| 070-diameter-endpoints-radius-distance | representative | 2/2 | distance-builtin(gold)×2 | 0 |
| 071-triangle-area-from-coordinates | representative | 2/2 | distance-builtin(unlisted)×1, reference-formula(gold)×1 | 0 |
| 072-similar-triangles-parallel-segment | representative | 2/2 | function-evaluation(unlisted)×1, direct-arithmetic(acceptable)×1 | 0 |
| 073-right-triangle-tangent | representative | 2/2 | reference-formula(acceptable)×2 | 0 |
| 074-arc-length-central-angle | representative | 2/2 | function-evaluation(unlisted)×2 | 0 |
| 075-cylinder-minus-sphere-volume | representative | 2/2 | function-evaluation(unlisted)×2 | 0 |
