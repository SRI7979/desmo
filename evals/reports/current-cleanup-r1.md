# Benchmark: current-cleanup-r1 (after the first round of fixes, commit a6dcab0)

Configuration: `{"model":"gpt-5-mini","reasoningEffort":"low","serviceTier":"priority","promptConfigVersion":"be5900447d7781e4a2676c05"}`. 47 cases × 1 runs.
Compared with `current` (prompt 1547a2d6c32db7781bbc2bc2).

## Metrics

Runs: 47 (47 scored; representative 47, hard 0).

| Metric | All | Δ all | Representative | Δ rep | Hard | Δ hard |
|---|---|---|---|---|---|---|
| Answer accuracy | 97.9% | 0 | 97.9% | 0 | — | — |
| Recommended = gold strategy | 53.2% | +9.7 ✓ | 53.2% | +9.7 ✓ | — | — |
| Recommended = gold or acceptable | 78.7% | +15.7 ✓ | 78.7% | +15.7 ✓ | — | — |
| Recommended = bad strategy | 8.5% | -2.4 ✓ | 8.5% | -2.4 ✓ | — | — |
| Recommended = unlabeled strategy | 12.8% | -13.3 ✓ | 12.8% | -13.3 ✓ | — | — |
| Math-heavy default (math score ≥ 2) | 2.1% | -2.2 ✓ | 2.1% | -2.2 ✓ | — | — |
| Gold strategy listed (default or alternative) | 72.3% | +4.9 ✓ | 72.3% | +4.9 ✓ | — | — |
| Avg Desmos rows (default) | 2.09 | +0.07 ✗ | 2.09 | +0.07 ✗ | — | — |
| Avg manual-math score (default) | 0.21 | -0.03 ✓ | 0.21 | -0.03 ✓ | — | — |
| Avg hidden derivation (calculator defaults) | 0.07 | +0.07 ✗ | 0.07 | +0.07 ✗ | — | — |
| Avg methods listed | 2.68 | +0.22 ✓ | 2.68 | +0.22 ✓ | — | — |
| Avg distinct method families listed | 2.17 | 0 | 2.17 | 0 | — | — |
| Explanation rubric score (0–1) | 0.98 | +0.01 ✓ | 0.98 | +0.01 ✓ | — | — |
| Solver failure rate | 0% | -2.1 ✓ | 0% | -2.1 ✓ | — | — |
| Clarification rate | 0% | 0 | 0% | 0 | — | — |
| Validation retry rate | 0% | -13 ✓ | 0% | -13 ✓ | — | — |
| Desmos retry rate | 0% | 0 | 0% | 0 | — | — |
| Explanation fallback rate | 0% | 0 | 0% | 0 | — | — |
| Infrastructure failures (excluded) | 0% | 0 | 0% | 0 | — | — |
| Time to first useful result p50 (ms) | 12601 | +348 ✗ | 12601 | +348 ✗ | — | — |
| Time to first useful result p75 (ms) | 14745 | -973 ✓ | 14745 | -973 ✓ | — | — |
| Time to first useful result p95 (ms) | 18201 | -14986 ✓ | 18201 | -14986 ✓ | — | — |
| Complete p50 (ms) | 16965 | +280 ✗ | 16965 | +280 ✗ | — | — |
| Complete p95 (ms) | 22688 | -14067 ✓ | 22688 | -14067 ✓ | — | — |
| Output tokens per solve | 2781.09 | -416.78 ✓ | 2781.09 | -416.78 ✓ | — | — |

## Where the time goes (per solve)

| Stage | Runs | p50 ms | p95 ms |
|---|---|---|---|
| cache_lookup | 47 | 0 | 0 |
| model_candidates | 47 | 12599 | 18197 |
| cache_lookup_problem | 47 | 0 | 0 |
| validate_select | 47 | 3 | 6 |
| cache_write | 47 | 0 | 0 |
| resolve | 47 | 0 | 0 |
| model_explanation | 47 | 3786 | 5918 |
| explanation | 47 | 3787 | 5919 |

## Validation rejections

| Rule | Rejected candidates |
|---|---|
| answer-consistency | 8 |
| row-fails-to-insert | 4 |
| hidden-derivation | 3 |
| condition-incomplete | 2 |
| answers-different-question | 1 |
| list-shape | 1 |
| answer-state | 1 |

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
| 033-linear-table-x-intercept | representative | 1/1 | intercept-read(bad)×1 | 0 |
| 034-linear-system-x-minus-y | representative | 1/1 | graph-both-sides(gold)×1 | 0 |
| 035-bakery-system-word-problem | representative | 1/1 | graph-both-sides(acceptable)×1 | 0 |
| 036-moving-budget-inequality | representative | 1/1 | intercept-read(unlisted)×1 | 0 |
| 037-absolute-value-one-solution | representative | 1/1 | slider-condition(gold)×1 | 0 |
| 038-interpret-drain-rate | representative | 1/1 | translate-the-words(gold)×1 | 0 |
| 039-representation-bouquet-roses | representative | 1/1 | translate-the-words(gold)×1 | 0 |
| 040-no-solution-parameter-k | representative | 1/1 | slider-condition(acceptable)×1 | 0 |
| 041-infinitely-many-parameter-k | representative | 1/1 | slider-condition(gold)×1 | 0 |
| 042-inequality-system-point | representative | 1/1 | graph-inequality(gold)×1 | 0 |
| 043-linear-growth-initial-members | representative | 1/1 | linear-regression(gold)×1 | 0 |
| 046-quadratic-zero-choice | representative | 1/1 | intercept-read(gold)×1 | 0 |
| 047-projectile-maximum-height | representative | 1/1 | vertex-read(gold)×1 | 0 |
| 048-exponential-model-evaluation | representative | 1/1 | function-evaluation(gold)×1 | 0 |
| 049-exponential-growth-representation | representative | 1/1 | translate-the-words(gold)×1 | 0 |
| 050-function-composition | representative | 1/1 | function-evaluation(gold)×1 | 0 |
| 051-identity-unknown-constants | representative | 1/1 | identity-regression(gold)×1 | 0 |
| 052-rational-equation | representative | 1/1 | intercept-read(gold)×1 | 0 |
| 053-radical-extraneous-root | representative | 1/1 | intercept-read(gold)×1 | 0 |
| 054-factor-theorem-unknown-coefficient | representative | 1/1 | slider-condition(acceptable)×1 | 0 |
| 055-line-tangent-parabola-slider | representative | 1/1 | parameter-regression(unlisted)×1 | 0 |
| 056-count-circle-parabola-intersections | representative | 1/1 | graph-raw(unlisted)×1 | 0 |
| 057-function-transformation-shift | representative | 1/1 | function-evaluation(acceptable)×1 | 0 |
| 060-mean-minus-median-homework-list | representative | 1/1 | statistics-builtin(gold)×1 | 0 |
| 061-stdev-compare-same-mean-range | representative | 1/1 | statistics-builtin(gold)×1 | 0 |
| 062-reverse-percent-increase-price | representative | 1/1 | intercept-read(acceptable)×1 | 0 |
| 063-square-feet-to-square-yards-cost | representative | 0/1 | answer-choice-list(bad)×1 | 0 |
| 064-two-way-table-conditional-salad-bar | representative | 1/1 | list-evaluation(bad)×1 | 0 |
| 065-line-of-best-fit-tank-empty | representative | 1/1 | linear-regression(gold)×1 | 0 |
| 066-ratio-with-total-smoothie | representative | 1/1 | intercept-read(unlisted)×1 | 0 |
| 067-weighted-mean-two-classes | representative | 1/1 | statistics-builtin(gold)×1 | 0 |
| 068-margin-of-error-inference | representative | 1/1 | direct-arithmetic(acceptable)×1 | 0 |
| 069-expanded-circle-radius-graph | representative | 1/1 | expanded-circle(acceptable)×1 | 0 |
| 070-diameter-endpoints-radius-distance | representative | 1/1 | distance-builtin(gold)×1 | 0 |
| 071-triangle-area-from-coordinates | representative | 1/1 | calculator-arithmetic(acceptable)×1 | 0 |
| 072-similar-triangles-parallel-segment | representative | 1/1 | function-evaluation(unlisted)×1 | 0 |
| 073-right-triangle-tangent | representative | 1/1 | answer-choice-list(unlisted)×1 | 0 |
| 074-arc-length-central-angle | representative | 1/1 | direct-arithmetic(bad)×1 | 0 |
| 075-cylinder-minus-sphere-volume | representative | 1/1 | reference-formula(gold)×1 | 0 |
