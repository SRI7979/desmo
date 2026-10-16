# Desmo production hard-problem audit — October 11, 2026

Tested 12 actual questions from Bedrock Prep's **Hard** section through the
image-upload solver at https://desmomath.com. This is a targeted sample of
the Bedrock 125, not an exhaustive assessment of its Hard or Expert questions.
Expected answers were calculated independently: this account could read the
questions, but Bedrock's explanations required Pro.

## Initial production results, before repairs

11 answers were correct. Problem 50 produced the wrong displayed answer.
All 12 displayed calculator batches were free of Desmos expression errors.
No browser exceptions, missing explanations, OpenAI quota errors, or model
timeouts were observed.

| Bedrock problem | Topic | Expected | Displayed | Observed time |
| --- | --- | --- | --- | --- |
| [7](https://www.bedrockprep.com/problems/p_sfcbdayt) | Custom regressions | -6 | -6 | 27.8 s |
| [8](https://www.bedrockprep.com/problems/p_sjcgpu26) | Radical models | 122 | 122 | 65.6 s |
| [20](https://www.bedrockprep.com/problems/p_sv3uaqau) | Rearranging terms | B | B | 28.8 s |
| [23](https://www.bedrockprep.com/problems/p_jjr9io56) | One variable in disguise | 980 | 980 | 24.1 s |
| [49](https://www.bedrockprep.com/problems/p_tahvl5qt) | Maximum factor coefficient | 421 | 421 | 22.4 s |
| [50](https://www.bedrockprep.com/problems/p_cb7ik563) | Two ways to factor | 10.5 | **9.1 — incorrect** | 23.3 s |
| [51](https://www.bedrockprep.com/problems/p_0xme2ue6) | Factors of a quartic | 2 | 2 | 69.4 s |
| [55](https://www.bedrockprep.com/problems/p_hwd3c4vd) | One real quadratic solution | 25/12 | 25/12 | 66.0 s |
| [56](https://www.bedrockprep.com/problems/p_c07bxnm4) | Quadratics with no solution | 7 | 7 | 71.3 s |
| [63](https://www.bedrockprep.com/problems/p_rvw1f37a) | Lowest possible sum | -15 | -15 | 23.6 s |
| [90](https://www.bedrockprep.com/problems/p_3h457p8p) | Circle with constants | 13 | 13 | 29.6 s |
| [102](https://www.bedrockprep.com/problems/p_lkqcamoi) | Pyramid surface area | 12 | 12 | 60.1 s |

Times include 1.5 seconds of deliberate settling before recording the UI.
Median observed time: 29.2 seconds; maximum: 71.3 seconds. Each question was
uploaded once. The production app made 28 model calls, including its own
guided corrections. No extra tutor calls or alternative-method explanation
calls were requested by this audit.

## Cost

Desmo's `model_usage` ledger recorded **$0.314800** for the run, using
`gpt-5-mini-2025-08-07`: 586,688 input tokens (550,528 cached) and 76,042 output
tokens. All 28 calls completed. These are the app's recorded costs, rather
than an independently reconciled OpenAI invoice. Account credit balance was
not available; the test observed no credit exhaustion or rate-limit errors.

## Confirmed answer bug and local correction

Problem 50 used two independent continuous identity regressions. Each fit can
choose either factor assignment, and neither enforces the integer/noninteger
classification. Desmos returned a sum of 9.1 even though the server's stated
answer was 10.5; the UI then displayed the computed 9.1 with a discrepancy
banner. Valid calculator syntax did not establish a mathematically valid method.

The local correction recognizes the complete two-factor pattern and uses two
graph lines: one for the product of the factor constants, and one for the
polynomial evaluated at 1. It shows both intersections and explicitly tells
the student which coordinates are the integer pair and which are the
noninteger pair. The sum is 10.5. A correct paper alternative stays available.

This correction applies to recognized old cache entries without invalidating
unrelated problems. Its explanation comes from a deterministic template,
eliminating the explanation model call for this pattern. Browser preflight
continues checking the actual graph rows and respecting error reports.

The recorded production response was replayed locally and corrected to 10.5.
Both factor points were checked against both equations using the actual
production-loaded Desmos engine, with zero expression errors. This verification
required no further OpenAI calls. The correction was subsequently deployed and
retested as documented below.

Local validation: all 390 offline tests passed, ESLint passed, and the production
build completed. The targeted cache/preflight regression also verifies that a
browser error report can still remove the corrected graph method and offer its
correct paper alternative.

## Domain findings

- `https://desmomath.com` served the deployment successfully.
- `https://www.desmomath.com` had a TLS certificate hostname mismatch.
- Google OAuth from `desmomath.com` still requested a callback at
  `https://desmo-one.vercel.app/auth/callback`. Consequently the user signed in
  on the old domain. For solver testing, the same authenticated Supabase
  session was copied to the custom domain inside the controlled test browser.
  This did not verify the custom domain's complete Google sign-in round trip.

Raw licensed question captures and browser records remain in a local temporary
audit directory; they are not included in repository commits.

## Production repairs and live retest

Deployed to https://desmomath.com on October 11, 2026. Vercel deployment
`dpl_CqeMXjiHEHs797vzc8rh9nUeqvHo` completed successfully. The local production
build, type checking, ESLint, and all **394 offline tests** passed.

All **12 of the same Bedrock Hard questions now show the correct answer** in
production, with no displayed Desmos expression errors, missing explanations,
browser exceptions, or unexpected alerts in the completed retest. Problem 50
now displays **10.5**, using both graph intersections. Its previously saved
unsafe regression also renders the repaired answer when opened in History;
the user's original database record and ownership checks remain intact.

Reusable Desmos-first plans now cover the following complete structures,
including coefficient variants rather than memorized answers:

| Problem | Preferred Desmos route | What the student avoids |
| --- | --- | --- |
| 8 | Bracket-fit the radical's inside, then click its rightmost root | Manually solving its coefficients |
| 50 | Graph both factor conditions and classify both intersections | Arbitrary independent factor fits |
| 51 | Integer lists and a shared-zero test, then min | Factoring the quartic by hand |
| 55 | Click the vertex of the difference | A discriminant calculation |
| 56 | Bracket-fit curvature and the overlap exception | Guessing a, and the incorrect claim that the left parabola becomes horizontal |
| 63 | Evaluate at 1 and graph the full positive-parameter range | Expanding vertex form or sampling a continuous domain |
| 90 | Fit the printed circle coefficients directly | Hidden coefficient divisions and disposable sample lists |
| 102 | Graph area and the slant-height triangle together | Copying an intermediate side length into another formula |

The authored explanations name the required recognition, any small hand step,
each row's role, and the readout. Genuine alternatives remain available. These
repairs apply to recognized old cache entries, and updated calculator batches
receive new preflight verdict identifiers so an old verdict cannot silently
approve new rows. Unsupported structures continue through the existing model
and validation pipeline. The model, reasoning settings, and spending safeguards
were not reduced.

The corrected batches were also replayed in the real Desmos engine before
deployment, including the numeric list and regression readouts. The two factor
points were independently checked against both equations.

### Authentication and domains

- Vercel's production `NEXT_PUBLIC_SITE_URL` and Supabase's saved Site URL now
  use `https://desmomath.com`. Supabase allows `https://desmomath.com/**` while
  preserving the existing localhost and Vercel redirects.
- `www.desmomath.com` now has valid TLS and returns a permanent redirect to
  the apex domain. The old `desmo-one.vercel.app` and
  `desmo-sri7979.vercel.app` production addresses also redirect there, avoiding
  a cross-domain PKCE verifier problem when sign-in starts on an old address.
- A fresh Google OAuth flow was tested in an isolated browser context without
  an existing Desmo session. It requested the custom-domain callback, reached
  that callback with a new code, ended at `https://desmomath.com/solve`, and
  produced a new session verified through Supabase's `getUser`. No copying of
  an existing Desmo session was used for this sign-in verification.

### Retest cost and timing

Every retested upload was confirmed to have an existing input-cache mapping
before submission. The final 12 `solve_succeeded` events each report **zero
model calls and $0 model cost**. The usage ledger remains at its initial
28 calls and $0.314800: the fixes, Desmos checks, and live retest added no paid
OpenAI calls. There were no OpenAI credit or rate-limit errors; remaining
account credits are still unknown.

Median observed cached solve time was **2.12 seconds**, with a maximum of
**2.57 seconds**, including 1.5 seconds of deliberate UI settling. These are
cache-hit timings, not fresh-generation timings. Fresh recognized problems can
use these plans before selection and use the authored explanation without an
explanation model call; fresh latency was not rebenchmarked to avoid additional
API spending.

The first rapid cache replay encountered the existing three-solves-per-minute
request limit. The completed run was paced at 21-second intervals to respect
it. Request and spending limits were retained.

Live control checks also confirmed that collapsing/expanding the sidebar and
switching light/dark themes preserve the current expressions and viewport,
the Appearance dialog opens and closes, and the repaired method endpoint
returns HTTP 200 with its authored explanation and no model call.

This remains a targeted 12-question regression sample. It does not establish
that every unseen Hard or Expert question will solve correctly or within a
fixed time.
