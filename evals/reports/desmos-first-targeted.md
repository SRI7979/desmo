# Benchmark: desmos-first-targeted

Configuration: `{"model":"gpt-5-mini","reasoningEffort":"low","serviceTier":"priority","promptConfigVersion":"fe7b8a8888c834b67c9536bd"}`. 5 cases × 1 runs.


## Metrics

Runs: 5 (5 scored; representative 4, hard 1, gold 0).

| Metric | All | Representative | Hard | Gold |
|---|---|---|---|---|
| Answer accuracy | 100% | 100% | 100% | — |
| Recommended = gold strategy | 0% | 0% | 0% | — |
| Recommended = gold or acceptable | 20% | 25% | 0% | — |
| Recommended = bad strategy | 40% | 25% | 100% | — |
| Recommended = unlabeled strategy | 40% | 50% | 0% | — |
| Math-heavy default (math score ≥ 2) | 0% | 0% | 0% | — |
| Gold strategy listed (default or alternative) | 20% | 25% | 0% | — |
| Default is a Desmos way | 80% | 75% | 100% | — |
| Lists both a Desmos way and a math way | 80% | 75% | 100% | — |
| Only one method listed | 20% | 25% | 0% | — |
| Default fell back to generic (paper) math | 0% | 0% | 0% | — |
| Default cites a library strategy | 100% | 100% | 100% | — |
| Library miss (detected trick never tried) | 0% | 0% | 0% | — |
| Avg Desmos rows (default) | 2.8 | 2.75 | 3 | — |
| Avg manual-math score (default) | 0.2 | 0.25 | 0 | — |
| Avg hidden derivation (calculator defaults) | 0 | 0 | 0 | — |
| Avg methods listed | 1.8 | 1.75 | 2 | — |
| Avg distinct method families listed | 1.8 | 1.75 | 2 | — |
| Explanation rubric score (0–1) | 0.93 | 0.92 | 1 | — |
| Solver failure rate | 0% | 0% | 0% | — |
| Clarification rate | 0% | 0% | 0% | — |
| Validation retry rate | 40% | 25% | 100% | — |
| Desmos retry rate | 0% | 0% | 0% | — |
| Explanation fallback rate | 0% | 0% | 0% | — |
| Infrastructure failures (excluded) | 0% | 0% | 0% | — |
| Time to first useful result p50 (ms) | 17083 | 14867 | 93196 | — |
| Time to first useful result p75 (ms) | 43600 | 17083 | 93196 | — |
| Time to first useful result p95 (ms) | 93196 | 43600 | 93196 | — |
| Complete p50 (ms) | 22513 | 20570 | 110584 | — |
| Complete p95 (ms) | 110584 | 46628 | 110584 | — |
| Output tokens per solve | 5488.6 | 3874.75 | 11944 | — |

## Where the time goes (per solve)

| Stage | Runs | p50 ms | p95 ms |
|---|---|---|---|
| cache_lookup | 5 | 0 | 0 |
| model_candidates | 5 | 17078 | 93148 |
| cache_lookup_problem | 5 | 0 | 0 |
| validate_select | 5 | 4 | 18 |
| cache_write | 5 | 0 | 3 |
| resolve | 5 | 0 | 0 |
| model_explanation | 5 | 5429 | 17381 |
| explanation | 5 | 5431 | 17388 |
| desmos_rescue | 2 | 27379 | 43720 |

## Validation rejections

| Rule | Rejected candidates |
|---|---|
| hidden-derivation | 1 |
| list-shape | 1 |
| extra-math-way | 1 |

Desmos rescues: applied 1, kept 1.

## Per case

| Case | Group | Correct | Default technique (class) × runs | Infra fails |
|---|---|---|---|---|
| 010-infinite-solutions-gk-ratio | representative | 1/1 | identity-regression(unlisted)×1 | 0 |
| 016-tangent-line-parabola | hard | 1/1 | slider-condition(bad)×1 | 0 |
| 054-factor-theorem-unknown-coefficient | representative | 1/1 | shared-zero(acceptable)×1 | 0 |
| 073-right-triangle-tangent | representative | 1/1 | distance-builtin(unlisted)×1 | 0 |
| 074-arc-length-central-angle | representative | 1/1 | calculator-arithmetic(bad)×1 | 0 |
