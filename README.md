# Desmo

An SAT Math workspace: upload a screenshot, get a concise answer, and watch the solution appear in an editable Desmos calculator. The solver uses the curated 75-strategy library in `src/content/desmos-tricks.md` plus reviewed training batches to choose a useful calculator method: graphing, regression, answer-choice testing, formulas, or direct arithmetic. See [PHILOSOPHY.md](PHILOSOPHY.md) for the product's Desmos-first design philosophy — read it before changing the solver's prompt, strategy library, or scoring.

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

`OPENAI_MODEL` is optional and defaults to `gpt-5-mini`. An override must support image inputs and structured outputs. `OPENAI_REASONING_EFFORT` accepts `minimal`, `low`, `medium`, or `high` and defaults to `low`; raise it when testing unusually difficult questions where extra latency is acceptable. Do not lower it: `minimal` was about twice as fast in benchmarks but answered the r+s identity question wrong. `OPENAI_SERVICE_TIER` defaults to `priority`, which roughly halves solve time at the same reasoning effort for about 1.8× the token price (around one cent per solve); set it to `default` to opt out. If the OpenAI project cannot use priority processing, the server retries once without it and stays on the default tier. The OpenAI project needs API credits and access to the selected model. Restart the development server after changing variables.

The OpenAI key is used only in the server route. The Desmos key is browser-visible by design; [Next.js exposes `NEXT_PUBLIC_` variables](https://nextjs.org/docs/app/guides/environment-variables). Never prefix a private AI key with `NEXT_PUBLIC_`.

## Set up Supabase

1. Create a [Supabase project](https://supabase.com/dashboard). Copy its project URL and **publishable** key into `.env.local` using the names above. Put its **secret** key in `SUPABASE_SECRET_KEY`. Legacy projects may use their public `anon` key for the publishable variable and `SUPABASE_SERVICE_ROLE_KEY` for the private `service_role` key. Do not put either private key in a `NEXT_PUBLIC_` variable.
2. Open the project's **SQL Editor** and run [the migration](supabase/migrations/202609210001_accounts_history_limits.sql) once. It creates the history table, per-account rate limiter, private `problem-images` bucket, and ownership policies. If you already use the Supabase CLI, apply the migration with `supabase db push` instead.
3. Under **Authentication → Providers**, enable Email/password and keep email confirmation enabled. Under **URL Configuration**, set Site URL to `http://localhost:3000` and add `http://localhost:3000/auth/callback` and `http://localhost:3000/auth/callback?recovery=1` to Redirect URLs. For deployment, set the Site URL and `NEXT_PUBLIC_SITE_URL` to the app's HTTPS origin and add its callback URLs too.
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

### Solve limits and history behavior

- **3 solve attempts per rolling 60 seconds per account; no daily limit.** The server reserves a slot atomically in Postgres before image decoding and AI work. Accepted attempts count even if the image later needs correction, the provider fails, or the user cancels. This prevents failed/repeated calls from bypassing the limit. Unauthorized requests, malformed multipart data, and files rejected by the initial size/type/signature checks do not consume a slot.
- A denied request returns HTTP `429` and `Retry-After`; the Solve button shows the remaining wait. The database limit applies across tabs and app instances. If the rate-limit service is unavailable, solving is temporarily disabled rather than allowed without limits.
- Screenshots and canonical results (including requests for clarification) are saved privately after the AI responds. History reuses the saved result; it does not call OpenAI or consume a solve attempt. Editing the restored calculator is temporary and does not overwrite the saved explanation.
- History reads enforce database row ownership and an explicit account filter. Image links are signed for five minutes; reload a saved page to get a fresh link. Neither the image bucket nor the history table is public. No shared response cache is used for account pages.
- If saving fails, the answer still appears with a visible warning. Failed provider calls are not saved. Images uploaded before this feature existed cannot be recovered.

### Upload edge cases

Only one still PNG/JPEG/WebP file is accepted per request: maximum 8 MB, 20 megapixels, and 12,000 pixels per side. Actual format and complete pixel data are validated; corrupt, disguised, animated, and oversized images are rejected.

The AI is instructed to request clarification for multiple independent problems in one image, non-math/English-subject questions, random images, illegible text, missing essential diagrams/choices, contradictory givens, and ambiguous targets. A system of equations or multipart setup for one target is allowed, as are math word problems written in English and student-response questions without choices. Text inside uploads is treated as question data, not as instructions to override the solver. These content decisions are model-based and can still make mistakes; file-format checks are deterministic. There is no extra AI classification call.

## Add training batches

Put each JSON array in `src/content/training-batches` with a unique filename such as `desmo_training_batch_002.json`. Every example must contain `id`, `question`, `answer_choices`, `correct_answer`, `strategy_name`, `trick` (the short pattern name the student learns), `trigger_pattern`, `desmos_steps`, `why_preferred`, and `needs_review`. IDs must be unique across every batch.

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
- `tests/solve.test.ts` checks upload validation, structured output, strategy-library and training-example inclusion, and upstream failures with mocked API responses.

Every readable question generates **3–6 distinct candidate scorecards** and one complete canonical solution for the winner. The server independently verifies that the selected candidate is rated 5 for correctness and wins this lexicographic priority (each item wins before the next):

1. Highest `simplicity` (reproducible, few rows, nothing derived off-screen).
2. Lowest `student_effort` (recall + algebra + arithmetic + typing + reading).
3. Lowest combined `manual_math_knowledge + manual_algebra + manual_calculation`.
4. Lowest `steps_time` (rows, typing, clicks).
5. Highest `desmos_outsourcing`, only as a tie-breaker.
6. Highest `reliability`.

Hidden derivation (a formula the student would have to derive before typing it) caps simplicity, so a one-row derived formula loses to a three-row slider or shared-zero graph; rows count only after simplicity, effort, and manual math tie. The app supports up to 16 rows per plan, so useful regression, derivative matching, and answer-choice lists are not compressed into a formula-heavy solution. Formula selection and hidden rearrangements still count as human math, even when Desmos performs the final arithmetic. Inapplicable or uncertain candidates are excluded; unreadable questions request clarification without inventing candidates.

Formulas printed in the question or supplied on the official SAT reference sheet count as low-burden givens and may be entered directly into Desmos. An unprovided niche formula carries a math-knowledge cost, so a reliable regression, graph, list, intersection, built-in, or original-constraint method wins when it asks less of the student. Core interpretation questions can still use a short written method when the calculator cannot determine what the quantities mean.

Representation questions are routed differently: when the prompt asks which equation or expression models a situation, the solver translates the quantities and stops once the model matches a choice. Solving or graphing that equation receives no useful Desmos credit unless calculator work actually helps identify the model.

The response contains `{ solution, strategySelection, problemId, historyWarning? }`. `solution` includes the transcribed `choices` and the `result` readout described below. `solution` is the winning candidate's single generated walkthrough; its expressions and their purposes drive both the calculator and explanation. `strategySelection` contains the chosen candidate ID, every candidate's scores, concise human/calculator work assessments, and the priority order. `problemId` links to the saved result, or is null with a warning if storage failed. The server rejects a selected ID that does not actually win those scores. Generating alternative scorecards instead of several unused walkthroughs reduces response time without removing comparison rigor or calculator rows from the chosen method.

### Modes, structure, and tricks

The solver page offers three modes (see [PHILOSOPHY.md](PHILOSOPHY.md)): **Weaponized Desmos**, **Desmos First** (default), and **Fastest SAT Method**. The mode is sent with the upload, its policy and priority order go in the per-request user message (the cached instruction prefix is unchanged), and the server ranks candidates with that mode's `STRATEGY_PRIORITIES`. The model must first write the problem's `structure` (what the student should notice), then candidates, each with a `trick` name and a `reusable` flag; the winner's trick and the structure are shown on the solution and in history so students learn the pattern, not just the rows. Answer-choice testing alone is never counted as reusable.

### Answer consistency

All three modes use the same result contract. `result.type` supports `numeric`, `list_entry`, `intersection`, `x_intercept`, `y_intercept`, `vertex`, `graph_overlap`, `slider_condition`, `visual_choice`, and `written`. Numeric and list results require a finite value; graph results reference the graph rows and describe what to inspect without requiring an artificial numeric row. Written results have no calculator row and require substantive explanation steps. Existing saved results remain compatible.

The server checks result references, Desmos syntax, strategy ranking, and answer consistency. Numeric results match a unique transcribed choice or agree with the student-produced answer; list positions select the aligned choice. Derived formulas such as `a=6/m` remain rejected. A named evaluation of the requested fitted model is allowed only when a restricted arithmetic parser proves it is that model with the requested input substituted. The rational-function regression fixture covers the former false rejection of `g3=(9a+3b+10)/5` in every mode.

Missing metadata is repaired only when it follows from the existing response, without inventing equations or changing purposes. Otherwise the server makes **one correction request**, including the exact validation stage, field/error, and previous output. Correct rows are preserved; there is no blanket row ban or instruction to switch strategies. A correction uses at least medium reasoning on GPT-5 when the initial setting was minimal/low. Applied repairs appear in `strategySelection.repairs`.

During development, rejected responses are written to ignored `.desmo-debug/<request-id>-<mode>-<attempt>.json` files, containing the raw SDK response and exact rejection. These files can contain the transcribed problem; they are local, private diagnostic files, not public assets. Request headers, API credentials, and image bytes are not logged. The API surfaces the specific stage and reason in development, and a diagnostic ID with a general error in production. `DESMO_DIAGNOSTICS=1` explicitly enables local diagnostic files outside development; do not enable it casually on a shared deployment. Tests use captured model output and mocked API calls, so normal `npm test` does not spend credits.

A row may carry `slider: {min, max, step}`; the calculator applies those bounds so a parameter row such as `k=0` becomes a slider the student drags until a graphical condition (tangency, a shared intercept, exactly one intersection) appears. Slider rows are never used to confirm or correct the answer, since their displayed value is wherever the student left them.

In the browser, the calculator publishes what Desmos actually computed for each row. For numeric and list results, the explanation compares the result row against the claimed value and shows a confirmation when they agree; when they disagree, it re-derives the answer and choice from the calculator's number, labels the correction, and, if the number matches no choice, asks for another solve. Saved problems get the same check when reopened. `tests/answer-consistency.test.ts` covers the derivation, the repair rules, and the browser reconciliation, and `tests/solve.test.ts` includes the regression case where r=3, s=403, and r+s=406 must return `C) 406` even when the model wrote `403 (B)`.

Candidate creation, math checks, and score assessments are model-generated; server code enforces the selection order and output consistency, not independent mathematical proof. GPT-5 requests use low reasoning and priority processing by default with concise structured output, a stable prompt-cache key, and server timing metrics (the `ai` entry's `desc` records the tier actually used).

### Latency

A solve is roughly 17K input tokens (fully prompt-cached after the first request) and 1,600–3,200 output tokens, of which 400–1,400 are hidden reasoning, so wall-clock time is almost entirely output generation. `npm run bench <variants> <image.png>...` (`scripts/bench-solve.mts`, spends real credits) sends the exact production request under `current`, `minimal`, `compact`, and `priority` variants. Measured on three questions with gpt-5-mini: default tier averaged 26.5 s, priority processing 13.5 s with identical answers, `minimal` reasoning 12 s but wrong on the identity question, and a tighter output schema saved nothing because reasoning-token variance dominates. Rows the model writes with multi-letter names (`diff`) are renamed to valid subscripts (`d_{iff}`), bare built-ins such as `abs(` become `\operatorname{abs}`, and prose inside LaTeX is rejected, so fewer solves are lost to a retry. `tests/strategy-selection.test.ts` covers priority ordering, correctness filtering, canonical output, rejected winner mismatches, and longer calculator strategies beating shorter formula methods.

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

Integration references: [OpenAI image inputs](https://developers.openai.com/api/docs/guides/images-vision), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), and the [Desmos API](https://www.desmos.com/api/v1.11/docs/index.html).
