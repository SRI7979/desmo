# Desmo

An SAT Math workspace: upload a screenshot, get a concise answer, and watch the solution appear in an editable Desmos calculator. The solver uses the curated 76-strategy library in `src/content/desmos-tricks.md` plus reviewed training batches to choose a useful calculator method: graphing, regression, answer-choice testing, formulas, or direct arithmetic. See [PHILOSOPHY.md](PHILOSOPHY.md) for the product's Desmos-first design philosophy — read it before changing the solver's prompt, strategy library, or scoring.

## Run locally

Use Node.js 22 or newer and npm.

```sh
npm install
# On a fresh checkout only: copy .env.example to .env.local and fill in your keys.
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) for the landing page and its fixed question-and-solution preview. Click **Try it** to open the interactive solver at [http://localhost:3000/solve](http://localhost:3000/solve). Upload, drop, or paste a PNG, JPG, or WebP screenshot (up to 8 MB), then click **Solve**. Include the full question and answer choices. **Use sample** loads an original practice image so you can test the same upload flow.

The **Explanation** card follows the exact expressions loaded into Desmos: each numbered line shows its equation and what it does, followed by **Read the result** instructions. The walkthrough and calculator share one ordered expression list. Check the extracted question under **Question text**. Desmos receives the ordered expression batch immediately; **Restore entries** restores the explained lines after editing. Written steps can win only when they require less human reasoning than the best applicable calculator method, with a specific reason shown. Blurry or incomplete questions prompt a clearer upload.

The solver now requires an account. Complete the Supabase setup below, then create an account at `/login?mode=signup`. `/history` lists your saved screenshots and explanations; reopening a problem restores its original Desmos entries without another AI call.

## Configuration

Put credentials in `.env.local`, which is ignored by Git:

```dotenv
OPENAI_API_KEY=your_openai_key
NEXT_PUBLIC_DESMOS_API_KEY=your_desmos_key
OPENAI_MODEL=gpt-5-mini
OPENAI_REASONING_EFFORT=low
OPENAI_SERVICE_TIER=priority
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_public_publishable_key
SUPABASE_SECRET_KEY=your_private_secret_key
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

`OPENAI_MODEL` is optional and defaults to `gpt-5-mini`. An override must support image inputs and structured outputs. `OPENAI_REASONING_EFFORT` accepts `minimal`, `low`, `medium`, or `high` and defaults to `low`; raise it when testing unusually difficult questions where extra latency is acceptable. Do not lower it: `minimal` was about twice as fast in benchmarks but answered the r+s identity question wrong. `FREE_SOLVES_PER_DAY` (default 15) caps new solves per account per rolling 24 hours, and `DAILY_SPEND_CEILING_USD` (default 5) stops new solves for everyone once that day's recorded OpenAI cost (UTC) reaches it; both are read on every request, and neither blocks cached solves, history, or switching methods on a solved problem. Every OpenAI call's token usage and USD cost is recorded in `model_usage` (per-solve totals in the `solve_costs` view), priced from `src/lib/model-pricing.ts`. `OPENAI_SERVICE_TIER` defaults to `priority`, which roughly halves solve time at the same reasoning effort for about 1.8× the token price (around one cent per solve); set it to `default` to opt out. If the OpenAI project cannot use priority processing, the server retries once without it and stays on the default tier. The OpenAI project needs API credits and access to the selected model. Restart the development server after changing variables.

The OpenAI key is used only in the server route. Before each deploy, run `npm run build && npm run audit:secrets`: it scans everything a production build serves to browsers (`.next/static` plus prerendered HTML and RSC payloads) for every server-only value in `.env.local` and for key-shaped strings, printing only names, and fails on any finding. The Desmos key is browser-visible by design; [Next.js exposes `NEXT_PUBLIC_` variables](https://nextjs.org/docs/app/guides/environment-variables). Never prefix a private AI key with `NEXT_PUBLIC_`.

## Set up Supabase

1. Create a [Supabase project](https://supabase.com/dashboard). Copy its project URL and **publishable** key into `.env.local` using the names above. Put its **secret** key in `SUPABASE_SECRET_KEY`. Legacy projects may use their public `anon` key for the publishable variable and `SUPABASE_SERVICE_ROLE_KEY` for the private `service_role` key. Do not put either private key in a `NEXT_PUBLIC_` variable.
2. Open the project's **SQL Editor** and run [the migration](supabase/migrations/202609210001_accounts_history_limits.sql) once. It creates the history table, per-account rate limiter, private `problem-images` bucket, and ownership policies. Then run [the solve-cache migration](supabase/migrations/202609270001_solve_cache.sql), which creates the service-role-only determinism cache, then [the pre-flight cache migration](supabase/migrations/202609280001_solve_cache_preflight.sql) and [the usage and limits migration](supabase/migrations/202609290001_usage_and_limits.sql). Also apply [the app events migration](supabase/migrations/202609290002_app_events.sql): every API error (with its stack, user, solve id, problem cacheKey, technique, and the model call that failed) and the events solve_started, solve_succeeded, solve_failed, method_switched, cap_hit, ceiling_hit, and upload_rejected are written there and logged as `[desmo:event]` / `[desmo:error]` JSON lines; no image bytes or problem text are recorded. Apply the usage migration before deploying: without it the server refuses every new solve (it fails closed so spending is never unmetered), though cached solves and history still work. Finally apply [the tutor and saved-tricks migration](supabase/migrations/202610040001_tutor_and_saved_tricks.sql): it widens `model_usage`'s call check to accept the tutor's `tutor` calls, adds the per-account tutor allowance (`daily_tutor_questions`, `reserve_daily_tutor`), and creates `saved_tricks` with owner-only row-level security. Apply it before deploying the tutor; until then the tutor refuses every question (it fails closed, so tutor spending is never unmetered) and saved tricks are unavailable (the History page simply hides the section). If you already use the Supabase CLI, apply them all with `supabase db push` instead.
3. Under **Authentication → Providers**, enable Email/password and keep email confirmation enabled. Under **URL Configuration**, set the Site URL to the public production origin (`https://desmo-one.vercel.app/`). Add `http://localhost:3000/**` and `https://desmo-one.vercel.app/auth/callback**` to Redirect URLs; the local wildcard allows the callback's Google, recovery, and safe return-path query parameters. Supabase falls back to the Site URL when a requested redirect is not allowed, so confirm the callback host matches the environment. Set `NEXT_PUBLIC_SITE_URL` to the appropriate origin in each environment.
4. Under **Authentication → Email Templates**, use these confirmation links so email verification and recovery also work when opened in another browser:

   **Confirm signup:**
   ```html
   <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Confirm your email</a>
   ```

   **Reset password:**
   ```html
   <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery">Reset your password</a>
   ```

   Supabase's default email service restricts delivery; [configure custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp) to send verification/recovery emails to real students. Default PKCE callback links are also supported, but must be opened in the browser that requested them.
5. Run `npm run setup:check` to verify the keys, connection, history table, private bucket, and limiter without printing credentials or creating records. Then restart `npm run dev`. Create and verify an account, solve a question, and open **History**. Sign out and verify that `/solve` and `/history` require sign-in. Another account must see only its own history.

Authentication uses [Supabase's server-side cookie flow](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs) with server-verified users. Session cookies are HTTP-only; a Next.js proxy refreshes them. Supabase's built-in authentication limits also apply to signup, login, and recovery requests.

### Google sign-in

Enable **Google** under Supabase **Authentication → Providers** and enter the Google OAuth client ID and secret there. In Google Cloud Console, create a **Web application** OAuth client. Add `http://localhost:3000` and the public production origin (`https://desmo-one.vercel.app`) as **Authorized JavaScript origins**. Its **Authorized redirect URI** is your hosted Supabase project URL followed by `/auth/v1/callback` (for this project, `https://jwfrozzoknimldsmexgq.supabase.co/auth/v1/callback`). Google redirects to Supabase for both environments; Google does not redirect directly to Desmo.

In Supabase **Authentication → URL Configuration**, keep the Site URL at `https://desmo-one.vercel.app/` and add `http://localhost:3000/**` under **Redirect URLs** alongside the production callback entry. The local entry is required even when the Site URL points to production: without it, Google returns the code to the Vercel root instead of the local `/auth/callback` handler. Keep `NEXT_PUBLIC_SITE_URL=http://localhost:3000` in local `.env.local`; set `NEXT_PUBLIC_SITE_URL=https://desmo-one.vercel.app` in Vercel Production and redeploy after changing it. The code also guards against a localhost value in Vercel Production, but the configured origin should match the public site. No Google client secret belongs in Desmo's environment variables, and no database migration is needed. Email/password sign-in remains available.

### Solve limits and history behavior

- **3 solve attempts per rolling 60 seconds per account, plus a configurable daily cap on new solves (default 15 per rolling 24 hours).** The server reserves a slot atomically in Postgres before image decoding and AI work. Accepted attempts count even if the image later needs correction, the provider fails, or the user cancels. This prevents failed/repeated calls from bypassing the limit. Unauthorized requests, malformed multipart data, and files rejected by the initial size/type/signature checks do not consume a slot.
- A denied request returns HTTP `429` and `Retry-After`; the Solve button shows the remaining wait. The database limit applies across tabs and app instances. If the rate-limit service is unavailable, solving is temporarily disabled rather than allowed without limits.
- Screenshots and canonical results (including requests for clarification) are saved privately after the AI responds. History reuses the saved result; it does not call OpenAI or consume a solve attempt. Editing the restored calculator is temporary and does not overwrite the saved explanation.
- History reads enforce database row ownership and an explicit account filter. Image links are signed for five minutes; reload a saved page to get a fresh link. Neither the image bucket nor the history table is public. No shared response cache is used for account pages.
- If saving fails, the answer still appears with a visible warning. Failed provider calls are not saved. Images uploaded before this feature existed cannot be recovered.

### Upload edge cases

Only one still PNG/JPEG/WebP file is accepted per request: maximum 8 MB, 20 megapixels, and 12,000 pixels per side. Actual format and complete pixel data are validated; corrupt, disguised, animated, and oversized images are rejected.

The AI is instructed to request clarification for multiple independent problems in one image, non-math/English-subject questions, random images, illegible text, missing essential diagrams/choices, contradictory givens, and ambiguous targets. A system of equations or multipart setup for one target is allowed, as are math word problems written in English and student-response questions without choices. Text inside uploads is treated as question data, not as instructions to override the solver. These content decisions are model-based and can still make mistakes; file-format checks are deterministic. There is no extra AI classification call.

## Tutor: Explain this and Save this trick

On a solve or a saved problem, every Desmos line has an **Explain** button next to **Copy**, and selecting any text in the solution card (the question, the answer, a line's explanation, or a rendered formula) shows a small **Explain this** button under the selection (Escape or clicking away dismisses it). The tutor answers inline in the card: what the selected part means in plain words, why this solution uses it here, and optionally a tiny Desmos example. **Practice problem** asks for one original problem solved by the same trick, with its hint and answer behind reveals. **Save this trick** (next to "The idea") bookmarks the technique; saved tricks are listed in a collapsed **Saved tricks** section on the History page, where they can be removed. The landing preview has no tutor controls.

- `POST /api/tutor` takes `{ source, selection, practice }`, where `source` is `{ kind: "solve", cacheKey, methodId }` or `{ kind: "history", problemId }` and `selection` is `{ kind: "row", row }` or `{ kind: "text", text }` (1–400 characters). The server resolves the context itself, from the solve cache (the method must still be offered, with its cached explanation prose when written) or from the student's own saved problem through their session (row-level security). A text selection must appear in that context; rendered math is matched by its letters and digits, so `y1 ∼ ax12` or `y_1 ~ ax_1^2` matches `y_{1}\sim ax_{1}^{2}`, and the browser sends a selected formula as its own LaTeX. Anything else is a 400. The model receives only the resolved context and the verified selection (`src/lib/tutor.ts`, `src/lib/tutor-grounding.ts`).
- One Responses API call per question: structured output, `store: false`, low reasoning effort and low verbosity on GPT-5, `prompt_cache_key` `desmo-tutor-v1`, 2,000 output tokens (3,000 with a practice problem), no SDK retries, aborted at `TUTOR_TIMEOUT_MS` (default 25 s) inside the route's 40 s limit. Prose is repaired to plain text like explanations; an example or practice problem that would still show LaTeX is dropped rather than shown raw.
- Each call is recorded in `model_usage` as `tutor` and checked against the global spend ceiling and a per-account allowance, `TUTOR_QUESTIONS_PER_DAY` (default 40 per rolling 24 hours, counted in `daily_tutor_questions`, read on every request); it never uses the daily solve cap, and the allowance keeps one account from spending the ceiling everyone shares. A practice problem counts as one question. A `tutor_explained` event records ids, the selection kind, and the cost, never the question or selection text.
- For a highlighted passage, the model and the saved trick get the server's own matching source text, never the client's string (which is only compared by its letters and digits).
- `/api/tricks` saves (`POST { source }`), lists (`GET`), and removes (`DELETE { id }`) saved tricks. The technique, structure, question, answer, and rows are resolved by the server from the same sources, never taken from the client. Each technique is saved once per solve (or per saved problem); `topic` is reserved for later.

`tests/tutor.test.ts` covers the handler (sign-in, validation, grounding, metering, the spend ceiling, error mapping, saved tricks) with mocked OpenAI responses, and `tests/saved-tricks-database.test.ts` runs every migration on an embedded PostgreSQL to prove owner isolation, uniqueness, and the widened `model_usage` check.

## Add training batches

Put each JSON array in `src/content/training-batches` with a unique filename such as `desmo_training_batch_002.json`. Every example must contain `id`, `question`, `answer_choices`, `correct_answer`, `strategy_name`, `techniqueId` (the vocabulary id of the technique the example teaches), `trigger_pattern`, `desmos_steps`, `why_preferred`, and `needs_review`. IDs must be unique across every batch.

The solve route validates and loads all `.json` files in filename order. Examples with `needs_review: true` remain in the dataset but are omitted from the AI prompt until reviewed. In development, edits are read on the next solve. Rebuild a production deployment after adding a batch so Next.js includes the new file.

These are few-shot method-selection examples rather than fixed answer rules. The solver is instructed to match the structure and trigger pattern, substitute the current problem's values, and verify the setup before it can select that method. Calculator steps and plain-language read instructions may share the `desmos_steps` array; the model still emits only valid expressions into Desmos. Reference forms such as `x_1` are normalized to `x_{1}` before prompting.

## How it works

- `src/app/page.tsx` and its CSS module provide the landing page and a non-editable example preview.
- `src/app/solve/page.tsx` protects the solver; `solver-workspace.tsx` handles uploads, answers, cancellation, and errors.
- `src/app/api/solve/route.ts` wires server authentication, the database limiter, and private storage into `src/lib/solve-handler.ts`.
- `src/lib/solve-handler.ts` validates uploads and calls the OpenAI Responses API with image input and a strict output schema.
- `src/app/login`, `src/app/auth`, and `src/proxy.ts` implement sign-in, signup, email confirmation, password recovery, and cookie refresh.
- `src/app/history` reopens private saved screenshots and results, using the same explanation component as the solver.
- `src/lib/problem-history.ts` stores results and reads them through Supabase ownership policies.
- `src/lib/tutor.ts`, `src/lib/tutor-handler.ts`, and `src/components/tutor-panel.tsx` implement the tutor and saved tricks (see Tutor above); `src/lib/saved-tricks.ts` reads and writes saved tricks through the student's session.
- `supabase/migrations` contains the database, storage, and rolling rate-limit setup.
- `src/lib/solver-schema.ts` shares the canonical solution contract and upload limits with the UI.
- `src/lib/solver-instructions.ts` defines candidate generation, score meanings, advanced methods, and calculator reliability rules.
- `src/lib/strategy-selection.ts` validates 3–6 candidate plans and deterministically selects one using the priority below.
- `src/lib/desmos-latex.ts` normalizes declared list identifiers, their references, and named calculator built-ins to executable Desmos LaTeX before the shared solution reaches the UI, and flags rows that use letters Desmos cannot resolve.
- `src/lib/answer-consistency.ts` derives the displayed answer from the calculator readout the model names, repairs a contradictory read instruction, and reconciles the saved answer with what the live calculator computes.
- `src/components/calculator-verification.tsx` shares Desmos row evaluations between the calculator and the explanation on both the solver and saved-history pages.
- `src/lib/training-examples.ts` validates every training batch, excludes examples awaiting review, and builds the few-shot method-selection context.
- `src/components/desmos-calculator.tsx` loads Desmos, adds expressions, fits the graph window, reports invalid equations, and publishes each row's computed value for verification.
- `src/content/desmos-tricks.md` is read on each solve. Edit this file to refine the strategy guide; the solver also applies domain, precision, and calculator-syntax checks in its prompt.
- `src/content/training-batches` contains reviewed problem-to-strategy examples. Add future numbered JSON batches here.
- `public/sample-question.png` is an original practice question with answer **C) 7**.
- `tests/solve.test.ts` checks upload validation, both model calls' request shapes, caching (repeat solves, re-cropped screenshots, configuration changes), method switching, streaming, fallbacks, and upstream failures with mocked API responses.

A solve is two short model calls. **Call 1** is terse: it transcribes the question and lists 1–4 genuinely distinct candidate techniques, each with a vocabulary `techniqueId`, its calculator rows, a typed readout, and cost components — no prose. The server applies every hard rejection, measures rows itself, and computes each candidate's total:

`total = rows + 3·derivationSteps + 2·newPrimitives + 4·oneOffFacts + setupConstructions + manualIterations`

Whitelisted Desmos primitives (graphing, sliders, lists, regression, restrictions, derivatives, statistics) cost nothing; `newPrimitives` counts Desmos features outside that list. The default is the argmin; ties break by math load, simplicity-ladder rung, rows, then technique id, so the order never depends on emission order. The server also derives each method's `mathLevel` (`low` / `medium` / `high` from derivation steps + one-off facts), a one-line `shape`, and the badges Recommended, Least math, Most Desmos, and Fewest steps. **Call 2** writes the explanation for the chosen technique only. The vocabulary (47 techniques: 39 from the library, 8 standard paper techniques) lives in `src/lib/technique-vocabulary.ts`, and every library strategy carries a `[technique: id | name]` tag. Formula selection and hidden rearrangements still count as human math, even when Desmos performs the final arithmetic. Inapplicable or uncertain candidates are excluded; unreadable questions request clarification without inventing candidates.

Formulas printed in the question or supplied on the official SAT reference sheet count as low-burden givens and may be entered directly into Desmos. An unprovided niche formula carries a math-knowledge cost, so a reliable regression, graph, list, intersection, built-in, or original-constraint method wins when it asks less of the student. Core interpretation questions can still use a short written method when the calculator cannot determine what the quantities mean.

Representation questions are routed differently: when the prompt asks which equation or expression models a situation, the solver translates the quantities and stops once the model matches a choice. Solving or graphing that equation receives no useful Desmos credit unless calculator work actually helps identify the model.

The upload accepts exactly one field, `image`. The response contains `{ solution, cacheKey, selectedMethodId, cached, methods, problemId, historyWarning? }`: `solution` is the default method, explained, in the shape the calculator and history render; `methods` lists every eligible technique with its rows, answer, cost, total, `mathLevel`, `shape`, and badges. Sending `Accept: application/x-ndjson` streams two events instead: `methods` (rows and answer, the moment selection finishes) and then `solution` (with the explanation). `POST /api/solve/method` with `{ cacheKey, methodId }` switches methods: the rows come from the cache immediately, and the explanation is cached or generated once. If the explanation call fails, the rows and answer are still shown with a short generated summary.

### Determinism cache

The same problem returns the same methods, order, and default every time. `cacheKey = sha256(normalized problem text + choices) + "." + promptConfigVersion`, where the problem text is the model's transcription (so a differently cropped screenshot of the same problem hits the same entry after one extraction call) and `promptConfigVersion` hashes both prompts, the strategy library, the training examples, the cost weights, the vocabulary, the response schemas, and the model (so any improvement regenerates cached problems). An identical re-upload maps straight to its entry and makes no model call. The cache lives in the existing Supabase project; apply [the cache migration](supabase/migrations/202609270001_solve_cache.sql) once, like the first migration.

### Answer consistency

Every technique uses the same result contract. `result.type` supports `numeric`, `list_entry`, `intersection`, `x_intercept`, `y_intercept`, `vertex`, `graph_overlap`, `slider_condition`, `visual_choice`, and `written`. Numeric and list results require a finite value; graph results reference the graph rows and describe what to inspect without requiring an artificial numeric row. Written results have no calculator row and require substantive explanation steps. Existing saved results remain compatible.

The server checks result references, Desmos syntax, strategy ranking, and answer consistency. Numeric results match a unique transcribed choice or agree with the student-produced answer; list positions select the aligned choice. Derived formulas such as `a=6/m` remain rejected. A named evaluation of the requested fitted model is allowed only when a restricted arithmetic parser proves it is that model with the requested input substituted. The rational-function regression fixture covers the former false rejection of `g3=(9a+3b+10)/5`.

Missing metadata is repaired only when it follows from the existing response, without inventing equations or changing purposes. Otherwise the server makes **one correction request**, including the exact validation stage, field/error, and previous output. Correct rows are preserved; there is no blanket row ban or instruction to switch strategies. A correction uses at least medium reasoning on GPT-5 when the initial setting was minimal/low. Applied repairs are logged with the solve's diagnostics.

During development, rejected responses are written to ignored `.desmo-debug/<request-id>-<attempt>.json` (and `<request-id>-explanation-<attempt>.json`) files, containing the raw SDK response and exact rejection. These files can contain the transcribed problem; they are local, private diagnostic files, not public assets. Request headers, API credentials, and image bytes are not logged. The API surfaces the specific stage and reason in development, and a diagnostic ID with a general error in production. `DESMO_DIAGNOSTICS=1` explicitly enables local diagnostic files outside development; do not enable it casually on a shared deployment. Tests use captured model output and mocked API calls, so normal `npm test` does not spend credits.

A row may carry `slider: {min, max, step}`; the calculator applies those bounds so a parameter row such as `k=0` becomes a slider the student drags until a graphical condition (tangency, a shared intercept, exactly one intersection) appears. Slider rows are never used to confirm or correct the answer, since their displayed value is wherever the student left them.

In the browser, the calculator publishes what Desmos actually computed for each row. For numeric and list results, the explanation compares the result row against the claimed value and shows a confirmation when they agree; when they disagree, it re-derives the answer and choice from the calculator's number, labels the correction, and, if the number matches no choice, asks for another solve. Saved problems get the same check when reopened. `tests/answer-consistency.test.ts` covers the derivation, the repair rules, and the browser reconciliation, and `tests/solve.test.ts` includes the regression case where r=3, s=403, and r+s=406 must return `C) 406` even when the model wrote `403 (B)`.

Candidate techniques and their cost components are model-generated; server code enforces the hard rejections, the cost arithmetic, and selection, not independent mathematical proof. GPT-5 requests use low reasoning and priority processing by default with concise structured output, stable prompt-cache keys (`desmo-candidates-v1`, `desmo-explanation-v1`), and a `Server-Timing` header with `methods` (time to the calculator rows), `complete`, the cache outcome, the explanation source, and the number of model calls.

### Latency

A solve is roughly 30K input tokens before the image (`npm run bench:prompt` breaks it down; mostly prompt-cached after the first request) and 1,600–3,200 output tokens, of which 400–1,400 are hidden reasoning, so wall-clock time is almost entirely output generation. `npm run bench <image.png>...` (`scripts/bench-solve.mts`, spends real credits) runs the production pipeline on real screenshots and reports time to the calculator rows, time to complete, and a cache hit. `npm run eval -- <label>` (`evals/run-evals.mts`, spends real credits) scores method quality and latency over the problems in `evals/problems`, each run from an empty cache so variance is measured honestly. Rows the model writes with multi-letter names (`diff`) are renamed to valid subscripts (`d_{iff}`), bare built-ins such as `abs(` become `\operatorname{abs}`, and prose inside LaTeX is rejected, so fewer solves are lost to a retry. `tests/strategy-selection.test.ts` covers the hard rejections, cost argmin, deterministic ordering, and duplicate, single-technique, and representation cases; `tests/method-scoring.test.ts`, `tests/technique-vocabulary.test.ts`, and `tests/solve-cache.test.ts` cover the arithmetic and labels, the vocabulary's agreement with the library, and cache keys.

For regression from supplied data, the app enters paired lists and a regression expression instead of creating a table object. Polynomial identities can use a sample input list and a regression between the original sides. Chained regressions must freeze the first fitted model by copying its numeric equation before a later fit; otherwise Desmos can refit upstream parameters. The line-purpose text identifies that copy step and its source. The calculator starts in degrees like the SAT testing calculator, enables `repeat()`, and exposes Desmos geometry functions such as `distance`, `midpoint`, and `polygon`.

The screenshot is sent to OpenAI when you click solve. Requests use `store: false`; this is not a claim about all provider retention. The screenshot and result are then saved to your private Supabase history. Desmos receives the generated expressions, not the screenshot. Responses are AI-generated, and the app flags calculator syntax errors without claiming to independently prove every answer.

Account pages and the paid solve endpoint require authentication. Secrets and the Supabase migration must be configured in each deployment; the solver fails closed if required services are unavailable. Automated tests use mocked AI responses and an embedded PostgreSQL database; they do not require or spend API credits. Real email delivery and live Supabase sign-in still need verification in your configured project.

## Commands

| Command             | Purpose                                         |
| ------------------- | ----------------------------------------------- |
| `npm run dev`       | Start the development server.                   |
| `npm run build`     | Create a production build.                      |
| `npm start`         | Serve the production build.                     |
| `npm run lint`      | Check code with ESLint.                         |
| `npm run typecheck` | Check TypeScript types.                         |
| `npm run setup:check` | Verify Supabase configuration and migration.  |
| `npm test`          | Run backend tests without spending API credits. |
| `npm run bench`     | Benchmark solve latency variants (spends credits). |
| `npm run bench:solver -- <label>` | Benchmark v2 (spends credits): accuracy, gold-strategy rate, burden, explanation rubric, retries, latency p50/p75/p95 per group. `--compare=<label>` diffs two runs. |
| `npm run bench:replay -- <label>` | Re-score a recorded run with the current server rules; no model calls. |
| `npm run bench:routing` | Offline: question detectors vs labeled routing. |
| `npm run bench:rescore -- <label>...` | Put old recorded runs on the benchmark's technique-label scale. |
| `npm run bench:prompt` | Offline: input-token budget of each request. |
| `npm run eval:validate` | Validate benchmark cases (`evals/problems`, gitignored `evals/private`). |

Integration references: [OpenAI image inputs](https://developers.openai.com/api/docs/guides/images-vision), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), and the [Desmos API](https://www.desmos.com/api/v1.11/docs/index.html).

## Benchmark and evaluation

`evals/problems/*.json` holds the benchmark: a representative group (normal SAT difficulty, broad coverage) and a hard/adversarial group. Each case names its gold, acceptable, and bad strategies with the solver's technique vocabulary, plus topic, expected result type, reference Desmos rows, burden ratings, routing labels, and explanation notes (`evals/benchmark/case-schema.ts`). Licensed problems such as Bedrock Prep items belong in the gitignored `evals/private/` folder with the same schema, so they are benchmarked locally and never committed. `scripts/check-desmos-preflight.mts --cases` runs every case's reference rows through the real Desmos engine; `--plans=<file>` audits worked examples. See `docs/latency.md` for measured latency and `docs/reliability/validation-layers.md` for every layer that can reject a solve.
