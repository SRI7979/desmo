# Desmo's Product Philosophy

This is the north star for what Desmo is and how it must think. If a future
change (prompt, library, scoring, or UI) conflicts with this document, the
change is wrong, not this document. Read this before editing
`src/lib/solver-instructions.ts`, `src/content/desmos-tricks.md`, or
`src/lib/strategy-selection.ts`.

## The core idea

Desmo teaches **Desmos-first problem solving**, not traditional math with
Desmos bolted on afterward. The product is an SAT Math tool whose job is to
give students a large arsenal of reusable Desmos techniques so they can solve
problems with as little manual math, algebra, arithmetic, formula
memorization, and conceptual derivation as reasonably possible.

The ideal Desmo user may be weak or average at traditional math but extremely
good at recognizing Desmos patterns. Their thought process should become:

> "This is an intersection trick." "This is a list-filter trick." "This is a
> midpoint trick." "This is a regression trick." "This is a brute-force
> integer trick."

**Not:**

> "I need to derive this formula and then use Desmos to calculate it."

## The solving algorithm

This is the required internal order, not just a style preference:

1. **Recognize the problem structure.**
2. **Search the Desmos trick library** for the best Desmos-native technique:
   graphing, intersections, tables, sliders, lists, list filtering, sequences,
   restrictions, regressions, functions, coordinates, midpoint, max/min,
   answer-choice testing, brute force, etc.
3. **Generate Desmos-first candidates.** Prefer a reusable Desmos trick over
   traditional algebra when practical.
4. **Select the method requiring the least student math while staying
   reasonably simple** — not simply the fewest Desmos lines.
5. **Verify with symbolic/traditional math internally.** This check exists to
   confirm correctness; it must never leak into or dictate the student-facing
   method.
6. **Default to the least-effort Desmos-first solution**, offering each other
   genuine technique as a labeled alternative.

**Anti-pattern, explicitly forbidden:** solving the problem traditionally
first and then reverse-engineering a Desmos-looking solution around that
answer. The Desmos method must be arrived at by searching Desmos techniques
for the problem's structure, not by dressing up an algebra solution.

## What "least effort" actually means

The optimization target is **not** simply the fewest Desmos lines, and it is
**not** the most Desmos rows possible. Among Desmos ways, the simplest one that
removes the most math wins; math itself comes last:

- A 5-line Desmos method requiring almost no math can beat a 2-line method
  that requires the student to understand or derive a formula. Hidden
  derivation behind a short expression is a cost, not a shortcut.
- Math is the last resort, never a co-equal option. A Desmos way is the
  default whenever one works; a math way is listed as the alternative and is
  the default only when no Desmos way passes. A Desmos way may still need one
  tiny step by hand (reading `a = 16` off the equation), and a small
  substitution that unlocks a Desmos technique is fine, but that step is
  always named and explained to the student, never hidden in a row.

## The Desmos way and the math way

This is the product's moat. A general chatbot solves the math first and uses
Desmos only as a calculator for the formula it derived: the discriminant typed
into a row, a substitution worked by hand. That is the **math way**. Desmo's
job is the **Desmos way**: come at the problem from an angle Desmos can handle,
so Desmos removes the math and the student's skill is knowing Desmos.

The standard example: `3x² − 16x + 2 = 0` has a solution `(a + √b)/6`, where
`a` and `b` are integers; find `a + b`. The math way recalls the quadratic
formula, computes `16² − 4(3)(2) = 232`, and matches `a = 16`, `b = 232`. The
Desmos way graphs `3x² − 16x + 2`, clicks the root `(5.20526, 0)`, types
`(a + √b)/6 ~ 5.20526` with a slider `a = 16` (a number already printed in the
equation), and reads `b = 232.00042` and `a + b = 248`. Desmos found the root
and the hidden number; the student did no algebra.

Before accepting any method, ask: *is this what a general chatbot would do,
with Desmos as a calculator?* If yes, it is the math way, and the Desmos angle
must be found too. The human-verified **gold solutions**
(`src/content/gold-solutions`) are the standard every Desmos way is held to.

## Formula memorization

Avoid making students memorize specialized mathematical formulas whenever a
clean Desmos method can replace them. Memorizing **Desmos patterns and
tricks** is encouraged and expected — that is the skill Desmo exists to teach.
The trade is deliberate: trade formula recall for pattern recognition.

## Generalizable methods over answer-choice-only hacks

Prefer a generalizable method over an answer-choice-only hack when the general
method is reasonably simple. Example: if plugging in answer choices works but
a reusable Desmos technique also solves it without needing the choices,
generally prefer the reusable technique — it's the one that transfers to the
next problem, including student-produced-response questions with no choices
to plug in.

## Simple graphical methods over unnecessary advanced syntax

Prefer simple graphical methods over unnecessarily advanced syntax. If a
problem can be solved by graphing two equations and clicking the intersection,
do not force a regression merely because regression technically also works.
Advanced techniques (regression, derivative regression, parameter fitting,
list-vector conditions) earn their place only when they actually reduce the
student's mathematical burden or solve the problem more effectively than the
simple graphical route — not by default, and not to look more sophisticated.

For a small system, prefer copying its complete equations into **bracket
regression** over extracting separate coefficient lists. More setup does not
mean more useful Desmos work. Keep real data tables, reusable lists, and needed
readouts; remove disposable bookkeeping. A fit may determine the requested
parameter even when nuisance parameters are not individually unique, but that
uniqueness must be checked internally before accepting the method.

## Brute force is completely acceptable

Desmos can test hundreds of possibilities instantly. If list generation,
filtering, tables, or brute-force searches eliminate difficult math, use them.
The only constraint: don't build an absurd brute-force setup when one very
basic step would make the method dramatically cleaner. Brute force is a tool
to reach for, not a method of last resort to apologize for.

## Method choice

For each problem Desmo lists every Desmos way that validly solves it and
**one** math way (up to six in all, never padded: validity is the filter), each
named from a fixed vocabulary so the same technique always carries the same
name, labeled "Desmos way" or "Math way", and labeled with its math load and a
one-line shape ("3 rows · slider · no algebra"). Nearly every SAT problem has
both a Desmos way and a math way; a list with only one method is rare. Several
algebra variants of the same idea teach nothing new, so only the simplest math
way is kept. The student may switch to any listed technique.

**The default is the cheapest Desmos way.** Desmos ways always rank ahead of
math ways; a math way is the default only when no Desmos way passes, and then
the model gets one call asking for the Desmos angle first. Among Desmos ways,
the cost function decides: every hand derivation step costs 3, every
memorized one-off fact costs 4, while calculator rows cost 1 and whitelisted
Desmos primitives (graphing, sliders, lists, regression, restrictions,
derivatives, statistics) cost nothing. A math way is a paper technique, or
Desmos used as a calculator: rows that only do arithmetic on the question's
numbers, or evaluate a formula the student recalls. Implementation: the vocabulary in
`src/lib/technique-vocabulary.ts`, the weights and labels in
`src/lib/method-scoring.ts`, selection in `src/lib/strategy-selection.ts`.

## How the product enforces this

- The model must emit `structure` (what it recognized) before any candidate;
  the output schema orders it first. Next comes the `library` report: the
  numbered strategies whose trigger fits, and why a matched one was skipped.
  Each candidate cites the strategy it applies. A development/eval trace
  (`src/lib/library-trace.ts`) compares that report with deterministic
  structure detectors, flags a library trick the wording points to that was
  never tried, and records whether the default fell back to generic math.
  Students never see it. Every candidate names a `techniqueId`
  from the vocabulary; a free-form name fails validation, and every library
  strategy carries its id, so a technique is named the same way everywhere.
- The student sees the recognized structure and the technique name on every
  solution and in history, so pattern recognition is what gets practiced.
- The model reports only judgment (derivation steps, one-off facts); the
  server counts rows, applies definitional floors (a paper technique's own
  steps), computes totals, and derives math level, shape, and badges. The
  model's preferred technique is logged, never obeyed.
- Hard rejections run before any scoring: hidden derivation, rows that cannot
  be inserted, underdetermined regressions, integer parameters not encoded as
  integers, incomplete no-solution / infinitely-many checks (verified, not
  taken on the model's word), sampling a continuous domain, and solving a
  "which equation represents" question instead of translating it, nested or
  one-element lists, and mismatched list lengths across a `~`.
- Nothing that errors in Desmos is ever shown. Before any row reaches the
  student, the exact batch the calculator would receive runs in a hidden
  Desmos instance; a technique with any erroring row is dropped and the next
  one by cost takes its place. When every technique errors, the model gets
  one retry with the Desmos errors attached, and after that the answer is an
  honest failure, not broken rows. Badges discriminate: the default carries
  only "Recommended", and every other badge names one strict leader.
- The same problem always returns the same methods, order, and default: the
  result is cached by the normalized problem text and the prompt
  configuration version, so any prompt or library improvement regenerates.
- Reverse-engineered plans are detected structurally, not just discouraged:
  a row using numbers the question never states (`41` from completing the
  square off-screen) or a value defined by a formula in a fitted parameter
  (`a=6/m`) is rejected as hidden derivation, with the runner-up Desmos
  candidate named. The model then gets one guided retry with the exact
  rejection reason. A row that types a memorized formula over the givens
  (the slope formula, the quadratic formula's `16^{2}-4(3)(2)`) is charged
  that formula as a one-off fact, whatever the model reported.
- Any hand step a Desmos way still needs is shown to the student on its own
  "Math you do by hand" line, named and explained; an explanation that leaves
  it out is rejected. A pure-Desmos method shows no such line.
- The transcription is copied verbatim: a table cell is written once, under
  its printed header, and never replaced by a value the model computed. Two
  different values for the same cell stop the solve with a reason the model
  must fix, and a data list holding a number the question never states is
  rejected as hidden derivation, whatever its size.
- The gold solutions are human-verified and lead the prompt; the benchmark's
  case files are agent-written silver. Benchmark reports show the gold
  solutions as their own group, never averaged into the others.

## The review standard

When reviewing any proposed solution — as a design choice, a prompt change, or
a specific answer the model produced — do not ask only:

> "Is this mathematically correct?"

Also ask:

> "Is there a more Desmos-native, reusable, lower-math-burden way to solve
> this?"

That second question is the main standard Desmo is held to. Correctness is
necessary but not sufficient.
