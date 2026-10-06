# Benchmark: desmos-first-gold

Configuration: `{"model":"gpt-5-mini","reasoningEffort":"low","serviceTier":"priority","promptConfigVersion":"fe7b8a8888c834b67c9536bd"}`. 2 cases × 1 runs.


## Metrics

Runs: 2 (2 scored; representative 0, hard 0, gold 2).

| Metric | All | Representative | Hard | Gold |
|---|---|---|---|---|
| Answer accuracy | 100% | — | — | 100% |
| Recommended = gold strategy | 50% | — | — | 50% |
| Recommended = gold or acceptable | 50% | — | — | 50% |
| Recommended = bad strategy | 0% | — | — | 0% |
| Recommended = unlabeled strategy | 50% | — | — | 50% |
| Math-heavy default (math score ≥ 2) | 0% | — | — | 0% |
| Gold strategy listed (default or alternative) | 100% | — | — | 100% |
| Default is a Desmos way | 100% | — | — | 100% |
| Lists both a Desmos way and a math way | 100% | — | — | 100% |
| Only one method listed | 0% | — | — | 0% |
| Default fell back to generic (paper) math | 0% | — | — | 0% |
| Default cites a library strategy | 100% | — | — | 100% |
| Library miss (detected trick never tried) | 0% | — | — | 0% |
| Avg Desmos rows (default) | 3 | — | — | 3 |
| Avg manual-math score (default) | 0 | — | — | 0 |
| Avg hidden derivation (calculator defaults) | 0 | — | — | 0 |
| Avg methods listed | 2.5 | — | — | 2.5 |
| Avg distinct method families listed | 2 | — | — | 2 |
| Explanation rubric score (0–1) | 1 | — | — | 1 |
| Solver failure rate | 0% | — | — | 0% |
| Clarification rate | 0% | — | — | 0% |
| Validation retry rate | 0% | — | — | 0% |
| Desmos retry rate | 0% | — | — | 0% |
| Explanation fallback rate | 0% | — | — | 0% |
| Infrastructure failures (excluded) | 0% | — | — | 0% |
| Time to first useful result p50 (ms) | 11593 | — | — | 11593 |
| Time to first useful result p75 (ms) | 18143 | — | — | 18143 |
| Time to first useful result p95 (ms) | 18143 | — | — | 18143 |
| Complete p50 (ms) | 16356 | — | — | 16356 |
| Complete p95 (ms) | 22971 | — | — | 22971 |
| Output tokens per solve | 3111 | — | — | 3111 |

## Where the time goes (per solve)

| Stage | Runs | p50 ms | p95 ms |
|---|---|---|---|
| cache_lookup | 2 | 0 | 0 |
| model_candidates | 2 | 11579 | 18133 |
| cache_lookup_problem | 2 | 0 | 0 |
| validate_select | 2 | 9 | 12 |
| cache_write | 2 | 0 | 1 |
| resolve | 2 | 0 | 0 |
| model_explanation | 2 | 4761 | 4825 |
| explanation | 2 | 4763 | 4828 |

## Validation rejections

| Rule | Rejected candidates |
|---|---|
| list-shape | 1 |
| duplicate-rows | 1 |

Desmos rescues: none.

## Per case

| Case | Group | Correct | Default technique (class) × runs | Infra fails |
|---|---|---|---|---|
| gold/001 | gold | 1/1 | identity-regression(gold)×1 | 0 |
| gold/013 | gold | 1/1 | integer-list-filter(unlisted)×1 | 0 |
