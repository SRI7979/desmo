# Benchmark: current-cleanup (final A/B, rescue on, 2 runs per case, commit dbc190d)

Configuration: `{"model":"gpt-5-mini","reasoningEffort":"low","serviceTier":"priority","promptConfigVersion":"be5900447d7781e4a2676c05"}`. 47 cases × 2 runs.
Compared with `current` (prompt 1547a2d6c32db7781bbc2bc2).

## Metrics

Runs: 94 (94 scored; representative 94, hard 0).

| Metric | All | Δ all | Representative | Δ rep | Hard | Δ hard |
|---|---|---|---|---|---|---|
| Answer accuracy | 96.8% | -1.1 ✗ | 96.8% | -1.1 ✗ | — | — |
| Recommended = gold strategy | 53.2% | +9.7 ✓ | 53.2% | +9.7 ✓ | — | — |
| Recommended = gold or acceptable | 85.1% | +22.1 ✓ | 85.1% | +22.1 ✓ | — | — |
| Recommended = bad strategy | 11.7% | +0.8 ✗ | 11.7% | +0.8 ✗ | — | — |
| Recommended = unlabeled strategy | 3.2% | -22.9 ✓ | 3.2% | -22.9 ✓ | — | — |
| Math-heavy default (math score ≥ 2) | 7.4% | +3.1 ✗ | 7.4% | +3.1 ✗ | — | — |
| Gold strategy listed (default or alternative) | 78.7% | +11.3 ✓ | 78.7% | +11.3 ✓ | — | — |
| Avg Desmos rows (default) | 2.03 | +0.01 ✗ | 2.03 | +0.01 ✗ | — | — |
| Avg manual-math score (default) | 0.28 | +0.04 ✗ | 0.28 | +0.04 ✗ | — | — |
| Avg hidden derivation (calculator defaults) | 0.07 | +0.07 ✗ | 0.07 | +0.07 ✗ | — | — |
| Avg methods listed | 2.8 | +0.34 ✓ | 2.8 | +0.34 ✓ | — | — |
| Avg distinct method families listed | 2.35 | +0.18 ✓ | 2.35 | +0.18 ✓ | — | — |
| Explanation rubric score (0–1) | 0.96 | -0.01 ✗ | 0.96 | -0.01 ✗ | — | — |
| Solver failure rate | 0% | -2.1 ✓ | 0% | -2.1 ✓ | — | — |
| Clarification rate | 0% | 0 | 0% | 0 | — | — |
| Validation retry rate | 1.1% | -11.9 ✓ | 1.1% | -11.9 ✓ | — | — |
| Desmos retry rate | 0% | 0 | 0% | 0 | — | — |
| Explanation fallback rate | 0% | 0 | 0% | 0 | — | — |
| Infrastructure failures (excluded) | 0% | 0 | 0% | 0 | — | — |
| Time to first useful result p50 (ms) | 12395 | +142 ✗ | 12395 | +142 ✗ | — | — |
| Time to first useful result p75 (ms) | 13721 | -1997 ✓ | 13721 | -1997 ✓ | — | — |
| Time to first useful result p95 (ms) | 17341 | -15846 ✓ | 17341 | -15846 ✓ | — | — |
| Complete p50 (ms) | 16226 | -459 ✓ | 16226 | -459 ✓ | — | — |
| Complete p95 (ms) | 21170 | -15585 ✓ | 21170 | -15585 ✓ | — | — |
| Output tokens per solve | 2735.91 | -461.96 ✓ | 2735.91 | -461.96 ✓ | — | — |

## Where the time goes (per solve)

| Stage | Runs | p50 ms | p95 ms |
|---|---|---|---|
| cache_lookup | 94 | 0 | 0 |
| model_candidates | 94 | 12393 | 17339 |
| cache_lookup_problem | 94 | 0 | 0 |
| validate_select | 94 | 2 | 6 |
| cache_write | 94 | 0 | 0 |
| resolve | 94 | 0 | 0 |
| model_explanation | 94 | 3815 | 5851 |
| explanation | 94 | 3816 | 5852 |
| desmos_rescue | 1 | 20820 | 20820 |

## Validation rejections

| Rule | Rejected candidates |
|---|---|
| answer-consistency | 11 |
| list-shape | 6 |
| duplicate-technique | 4 |
| answers-different-question | 4 |
| hidden-derivation | 3 |
| condition-incomplete | 3 |
| row-fails-to-insert | 3 |
| duplicate-rows | 3 |

Desmos rescues: kept 1.

## Per case

| Case | Group | Correct | Default technique (class) × runs | Infra fails |
|---|---|---|---|---|
| 003-representation-linear-model | representative | 2/2 | translate-the-words(gold)×2 | 0 |
| 008-restricted-domain-minimum | representative | 2/2 | restricted-extremum(gold)×2 | 0 |
| 010-infinite-solutions-gk-ratio | representative | 2/2 | bracket-regression(acceptable)×1, slider-condition(acceptable)×1 | 0 |
| 012-circle-radius | representative | 2/2 | expanded-circle(acceptable)×2 | 0 |
| 013-trig-intersection | representative | 2/2 | intercept-read(acceptable)×1, graph-both-sides(gold)×1 | 0 |
| 014-stdev-list | representative | 2/2 | statistics-builtin(gold)×2 | 0 |
| 015-two-way-table-probability | representative | 2/2 | direct-arithmetic(gold)×1, calculator-arithmetic(gold)×1 | 0 |
| 032-linear-equation-fractions | representative | 2/2 | intercept-read(acceptable)×1, graph-both-sides(gold)×1 | 0 |
| 033-linear-table-x-intercept | representative | 2/2 | linear-regression(gold)×1, direct-arithmetic(bad)×1 | 0 |
| 034-linear-system-x-minus-y | representative | 2/2 | graph-both-sides(gold)×1, bracket-regression(acceptable)×1 | 0 |
| 035-bakery-system-word-problem | representative | 2/2 | graph-both-sides(acceptable)×2 | 0 |
| 036-moving-budget-inequality | representative | 2/2 | graph-inequality(acceptable)×1, ceil-floor(bad)×1 | 0 |
| 037-absolute-value-one-solution | representative | 2/2 | slider-condition(gold)×2 | 0 |
| 038-interpret-drain-rate | representative | 2/2 | derivative-slope(bad)×2 | 0 |
| 039-representation-bouquet-roses | representative | 2/2 | translate-the-words(gold)×2 | 0 |
| 040-no-solution-parameter-k | representative | 2/2 | slider-condition(acceptable)×1, slider-parallel(gold)×1 | 0 |
| 041-infinitely-many-parameter-k | representative | 2/2 | slider-condition(gold)×2 | 0 |
| 042-inequality-system-point | representative | 1/2 | graph-inequality(gold)×2 | 0 |
| 043-linear-growth-initial-members | representative | 2/2 | linear-regression(gold)×1, answer-choice-list(unlisted)×1 | 0 |
| 046-quadratic-zero-choice | representative | 2/2 | intercept-read(gold)×2 | 0 |
| 047-projectile-maximum-height | representative | 2/2 | vertex-read(gold)×2 | 0 |
| 048-exponential-model-evaluation | representative | 2/2 | function-evaluation(gold)×2 | 0 |
| 049-exponential-growth-representation | representative | 2/2 | translate-the-words(gold)×2 | 0 |
| 050-function-composition | representative | 2/2 | function-evaluation(gold)×2 | 0 |
| 051-identity-unknown-constants | representative | 2/2 | bracket-regression(unlisted)×1, identity-regression(gold)×1 | 0 |
| 052-rational-equation | representative | 2/2 | intercept-read(gold)×2 | 0 |
| 053-radical-extraneous-root | representative | 2/2 | intercept-read(gold)×2 | 0 |
| 054-factor-theorem-unknown-coefficient | representative | 2/2 | slider-condition(acceptable)×1, shared-zero(acceptable)×1 | 0 |
| 055-line-tangent-parabola-slider | representative | 2/2 | answer-choice-list(acceptable)×1, vertex-of-difference(acceptable)×1 | 0 |
| 056-count-circle-parabola-intersections | representative | 1/2 | count-intersections(gold)×2 | 0 |
| 057-function-transformation-shift | representative | 2/2 | function-evaluation(acceptable)×2 | 0 |
| 060-mean-minus-median-homework-list | representative | 2/2 | statistics-builtin(gold)×2 | 0 |
| 061-stdev-compare-same-mean-range | representative | 2/2 | statistics-builtin(gold)×2 | 0 |
| 062-reverse-percent-increase-price | representative | 2/2 | graph-both-sides(gold)×2 | 0 |
| 063-square-feet-to-square-yards-cost | representative | 1/2 | answer-choice-list(bad)×1, function-evaluation(unlisted)×1 | 0 |
| 064-two-way-table-conditional-salad-bar | representative | 2/2 | list-evaluation(bad)×2 | 0 |
| 065-line-of-best-fit-tank-empty | representative | 2/2 | answer-choice-list(acceptable)×1, direct-arithmetic(bad)×1 | 0 |
| 066-ratio-with-total-smoothie | representative | 2/2 | direct-arithmetic(acceptable)×2 | 0 |
| 067-weighted-mean-two-classes | representative | 2/2 | calculator-arithmetic(acceptable)×1, statistics-builtin(gold)×1 | 0 |
| 068-margin-of-error-inference | representative | 2/2 | translate-the-words(gold)×1, calculator-arithmetic(acceptable)×1 | 0 |
| 069-expanded-circle-radius-graph | representative | 2/2 | expanded-circle(acceptable)×1, graph-raw(gold)×1 | 0 |
| 070-diameter-endpoints-radius-distance | representative | 2/2 | midpoint-builtin(acceptable)×1, distance-builtin(gold)×1 | 0 |
| 071-triangle-area-from-coordinates | representative | 2/2 | distance-builtin(acceptable)×1, polygon-area(bad)×1 | 0 |
| 072-similar-triangles-parallel-segment | representative | 2/2 | answer-choice-list(acceptable)×2 | 0 |
| 073-right-triangle-tangent | representative | 2/2 | right-triangle-trig(gold)×1, answer-choice-list(acceptable)×1 | 0 |
| 074-arc-length-central-angle | representative | 2/2 | calculator-arithmetic(bad)×1, direct-arithmetic(bad)×1 | 0 |
| 075-cylinder-minus-sphere-volume | representative | 2/2 | direct-arithmetic(acceptable)×1, calculator-arithmetic(acceptable)×1 | 0 |
