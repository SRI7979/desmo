# Benchmark: desmos-first-074b

Configuration: `{"model":"gpt-5-mini","reasoningEffort":"low","serviceTier":"priority","promptConfigVersion":"6bbee572989ac1e52c524bdf"}`. 1 cases × 1 runs.


## Metrics

Runs: 1 (1 scored; representative 1, hard 0, gold 0).

| Metric | All | Representative | Hard | Gold |
|---|---|---|---|---|
| Answer accuracy | 100% | 100% | — | — |
| Recommended = gold strategy | 100% | 100% | — | — |
| Recommended = gold or acceptable | 100% | 100% | — | — |
| Recommended = bad strategy | 0% | 0% | — | — |
| Recommended = unlabeled strategy | 0% | 0% | — | — |
| Math-heavy default (math score ≥ 2) | 0% | 0% | — | — |
| Gold strategy listed (default or alternative) | 100% | 100% | — | — |
| Default is a Desmos way | 100% | 100% | — | — |
| Lists both a Desmos way and a math way | 100% | 100% | — | — |
| Only one method listed | 0% | 0% | — | — |
| Default fell back to generic (paper) math | 0% | 0% | — | — |
| Default cites a library strategy | 100% | 100% | — | — |
| Library miss (detected trick never tried) | 0% | 0% | — | — |
| Avg Desmos rows (default) | 2 | 2 | — | — |
| Avg manual-math score (default) | 0 | 0 | — | — |
| Avg hidden derivation (calculator defaults) | 0 | 0 | — | — |
| Avg methods listed | 2 | 2 | — | — |
| Avg distinct method families listed | 2 | 2 | — | — |
| Explanation rubric score (0–1) | 1 | 1 | — | — |
| Solver failure rate | 0% | 0% | — | — |
| Clarification rate | 0% | 0% | — | — |
| Validation retry rate | 0% | 0% | — | — |
| Desmos retry rate | 0% | 0% | — | — |
| Explanation fallback rate | 0% | 0% | — | — |
| Infrastructure failures (excluded) | 0% | 0% | — | — |
| Time to first useful result p50 (ms) | 11268 | 11268 | — | — |
| Time to first useful result p75 (ms) | 11268 | 11268 | — | — |
| Time to first useful result p95 (ms) | 11268 | 11268 | — | — |
| Complete p50 (ms) | 21171 | 21171 | — | — |
| Complete p95 (ms) | 21171 | 21171 | — | — |
| Output tokens per solve | 2267 | 2267 | — | — |

## Where the time goes (per solve)

| Stage | Runs | p50 ms | p95 ms |
|---|---|---|---|
| cache_lookup | 1 | 0 | 0 |
| model_candidates | 1 | 11248 | 11248 |
| cache_lookup_problem | 1 | 0 | 0 |
| validate_select | 1 | 18 | 18 |
| cache_write | 1 | 1 | 1 |
| resolve | 1 | 0 | 0 |
| model_explanation | 1 | 9898 | 9898 |
| explanation | 1 | 9902 | 9902 |

## Validation rejections

_No candidate was rejected._

## Per case

| Case | Group | Correct | Default technique (class) × runs | Infra fails |
|---|---|---|---|---|
| 074-arc-length-central-angle | representative | 1/1 | graph-both-sides(gold)×1 | 0 |
