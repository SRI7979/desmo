# Validation layers: what can reject a solve, and how to find which one did

Every solve passes through these layers in order. When a student sees a
generic failure, the layer is always recoverable from the `diagnosticId` the
API returns: the `solve_failed` event in `app_events` (and the
`[desmo:event]` log line) carries `reason`, which is `validation_<stage>`,
`timeout_<call>`, `desmos_preflight`, `refusal`, or `openai_<kind>_<status>`.
In development the API response itself includes `validation.stage` and the
message, and the rejected model output is written to
`.desmo-debug/<id>-<attempt>.json`.

There is no message "AI returned incomplete solution" in the code. The
closest are:

- **Production, any call-1 validation failure after the one correction:**
  "The solver could not produce a valid solution after one correction. Please
  try again." (HTTP 502). The stage is in `solve_failed.reason`.
- **`model_output` stage:** the provider returned `status: "incomplete"`,
  almost always `incomplete_details.reason = "max_output_tokens"` (reasoning
  tokens count toward the cap). Before this change the correction ran at
  *higher* reasoning effort under the *same* cap, which makes a second
  truncation more likely. A truncated response is now retried at the
  configured effort with twice the cap (`outputTokenLimit`, `wasTruncated` in
  `src/lib/solve-pipeline.ts`).

## Call 1: candidates (`src/lib/solve-output.ts`, `src/lib/strategy-selection.ts`)

| Order | Stage | What fails | Recovery |
|---|---|---|---|
| 1 | `model_output` | Provider status not `completed` (truncation, content filter) | One correction; truncation retries with 2× output cap |
| 2 | `json` | Output is not JSON | One correction |
| 3 | (repair) | Missing metadata that follows from the plan: `graphBounds`, `relatedRows`, `value`/`listIndex`/`choiceLabel` nulls, a numeric readout of a list entry (→ `list_entry`), a graph result selecting "by list position" with a named choice (→ `reasoning`), a two-graph intersection missing its other row, a redundant `value` on a written result, a numeric readout on a candidate with no rows (→ `written`), rows named by a written readout (dropped), a graphical readout listing its graphs only in `relatedRows` (the first becomes `row`) | Repaired in place and logged; never a rejection |
| 3b | (selection repair) | The transcribed question, structure, and choices are call 1's prose: symbol LaTeX with an exact plain character (`10\pi` → `10π`, `\le` → `≤`) is repaired; anything else fails `prose_text` here, where call 1 can correct it. A result row captioned with something Desmos cannot define (`\text{area}=`, `\tan S=`) keeps only its computation. Technique names the rows contradict are corrected: scalar rows with no function → `calculator-arithmetic`, a fit with no squared term → `linear-regression`, paper `direct-arithmetic` on a representation question → `translate-the-words` | Repaired and recorded in the method's `repairs`; never a rejection |
| 4 | `zod` | Schema violation (wrong types, unknown technique id) | One correction |
| 5 | per candidate, rule → stage | `row-fails-to-insert` (empty, prose, undefined letters) → `desmos_syntax`; `list-shape` (one-element or nested list) → `desmos_syntax`; `answers-different-question` (calculator rows on a representation question); `unproven-extremum`; `coefficient-lists`; `disposable-scalar-list`; `unproven-invariance`; `hidden-derivation` (numbers not in the question, formula in a fitted parameter); `integer-not-encoded`; `underdetermined-regression`; `discrete-sampling`; `answer-state`; `answer-consistency` → `answer_consistency` or `result_contract`; `condition-incomplete`; `prose-latex` → `prose_text`; `duplicate-technique`; `duplicate-rows` (same rows as a cheaper method) | The candidate is dropped and kept as a rejected record; the solve fails only when **every** candidate is rejected (stage of the first rejection), then one correction |
| 5b | (definitional floors) | Not a failure: costs the model under-reports. A paper method for a solution-count condition ("no solution", "exactly one solution", "infinitely many") carries one memorized fact; a row typing the two-point slope formula carries one; a readout combining fitted parameters the question never writes (`-b/m`) carries one derivation step; `calculator-arithmetic` carries its setup step. `condition-incomplete` accepts a `slider_condition` readout whose slider opens at the answer (`answerState`) with both equations as `relatedRows` | Applied before ranking |
| 6 | `desmos_rescue` (new) | Not a failure: the default would be math-heavy (math score ≥ 2) only because a cheaper Desmos candidate hit a rule above | One guided correction; the result is merged, so the original selection stands if it fails. `DESMO_DESMOS_RESCUE=off` disables it |

## Browser pre-flight (`src/components/preflight-gate.ts`, `src/lib/desmos-preflight.ts`)

Before any row is shown, the exact batch runs in a hidden Desmos instance.
A method with any erroring row is never shown and is reported to
`/api/solve/preflight`; the cheapest clean method becomes the default. If
every method errors, call 1 runs once more with the Desmos errors attached
(`desmos_retry`); if that fails too, the student gets the honest failure
message and no rows. A visible-calculator tripwire removes a batch that
errors there despite a clean check. Measured on the real Desmos API
(v1.11.4, headless Chromium): engine creation 61 ms, a check p50 80 ms /
p95 88 ms including the 60 ms quiet window.

## Call 2: explanation (`src/lib/method-presentation.ts`)

| Stage | What fails | Recovery |
|---|---|---|
| `model_output` / `json` / `zod` | As above | One correction (truncation: 2× cap) |
| `explanation_quality` | THE IDEA only names a tool; a row purpose is a placeholder; a slider explanation says Desmos found the value; a least/greatest integer slider claim without checking the neighbor; multi-step written work compressed into one step | One correction |
| `answer_consistency`, `result_contract`, `prose_text` | Prose contradicts the verified readout, or contains LaTeX (the question itself was made plain text in call 1, so a correction here only concerns the explanation's own fields). An approximation question ("approximately", "closest to") matches the clearly nearest numeric choice | One correction |
| (fallback) | Both attempts failed or timed out | Rows and answer still shown with a generated per-row summary, not cached, with a retry button |

Explanation quality beyond these hard checks is measured, not enforced:
`src/lib/explanation-rubric.ts` scores THE IDEA depth, per-row depth and
grounding, READ THE RESULT specificity, and unexplained jargon, and the
benchmark reports the mean. A rubric that rejected valid teaching would turn
good solves into extra model calls.

## Answer consistency after rendering (`src/lib/answer-consistency.ts`)

The calculator publishes what Desmos computed for each row; the explanation
compares the result row with the claimed value, shows "Verified in Desmos"
when they agree, and re-derives the answer and choice from the calculator's
number when they disagree.
