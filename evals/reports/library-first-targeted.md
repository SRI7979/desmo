# Benchmark: library-first-targeted

Configuration: `{"model":"gpt-5-mini","reasoningEffort":"low","serviceTier":"priority","promptConfigVersion":"4ec7b283fdc4eedaecd53ae6"}`. 5 cases × 1 runs.


## Metrics

Runs: 5 (5 scored; representative 3, hard 2, human-verified gold 1).

| Metric | All | Representative | Hard | Human gold |
|---|---|---|---|---|
| Answer accuracy | 100% | 100% | 100% | 100% |
| Recommended = gold strategy | 80% | 66.7% | 100% | 100% |
| Recommended = gold or acceptable | 100% | 100% | 100% | 100% |
| Recommended = bad strategy | 0% | 0% | 0% | 0% |
| Recommended = unlabeled strategy | 0% | 0% | 0% | 0% |
| Math-heavy default (math score ≥ 2) | 0% | 0% | 0% | 0% |
| Gold strategy listed (default or alternative) | 80% | 66.7% | 100% | 100% |
| Default fell back to generic (paper) math | 0% | 0% | 0% | 0% |
| Default cites a library strategy | 100% | 100% | 100% | 100% |
| Library miss (detected trick never tried) | 0% | 0% | 0% | 0% |
| Avg Desmos rows (default) | 2.6 | 2.67 | 2.5 | 4 |
| Avg manual-math score (default) | 0 | 0 | 0 | 0 |
| Avg hidden derivation (calculator defaults) | 0 | 0 | 0 | 0 |
| Avg methods listed | 2.8 | 2.33 | 3.5 | 3 |
| Avg distinct method families listed | 2.8 | 2.33 | 3.5 | 3 |
| Explanation rubric score (0–1) | 0.93 | 0.94 | 0.92 | 1 |
| Solver failure rate | 0% | 0% | 0% | 0% |
| Clarification rate | 0% | 0% | 0% | 0% |
| Validation retry rate | 0% | 0% | 0% | 0% |
| Desmos retry rate | 0% | 0% | 0% | 0% |
| Explanation fallback rate | 0% | 0% | 0% | 0% |
| Infrastructure failures (excluded) | 0% | 0% | 0% | 0% |
| Time to first useful result p50 (ms) | 16911 | 16911 | 15067 | 15067 |
| Time to first useful result p75 (ms) | 19119 | 19119 | 21330 | 15067 |
| Time to first useful result p95 (ms) | 21330 | 19119 | 21330 | 15067 |
| Complete p50 (ms) | 22454 | 22454 | 20470 | 20470 |
| Complete p95 (ms) | 28463 | 25462 | 28463 | 20470 |
| Output tokens per solve | 3367.6 | 3141.33 | 3707 | 3037 |

## Where the time goes (per solve)

| Stage | Runs | p50 ms | p95 ms |
|---|---|---|---|
| cache_lookup | 5 | 0 | 0 |
| model_candidates | 5 | 16902 | 21325 |
| cache_lookup_problem | 5 | 0 | 0 |
| validate_select | 5 | 6 | 9 |
| cache_write | 5 | 0 | 1 |
| resolve | 5 | 0 | 0 |
| model_explanation | 5 | 5542 | 7132 |
| explanation | 5 | 5543 | 7133 |

## Validation rejections

| Rule | Rejected candidates |
|---|---|
| list-shape | 2 |

Desmos rescues: none.

## Per case

| Case | Group | Correct | Default technique (class) × runs | Infra fails |
|---|---|---|---|---|
| 016-tangent-line-parabola | hard | 1/1 | vertex-of-difference(gold)×1 | 0 |
| 037-absolute-value-one-solution | representative | 1/1 | slider-condition(gold)×1 | 0 |
| 054-factor-theorem-unknown-coefficient | representative | 1/1 | shared-zero(acceptable)×1 | 0 |
| 074-arc-length-central-angle | representative | 1/1 | graph-both-sides(gold)×1 | 0 |
| 087-gold-quadratic-root-radical-form | hard | 1/1 | parameter-regression(gold)×1 | 0 |
