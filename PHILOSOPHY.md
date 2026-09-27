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
6. **Show only the Desmos-first solution.**

**Anti-pattern, explicitly forbidden:** solving the problem traditionally
first and then reverse-engineering a Desmos-looking solution around that
answer. The Desmos method must be arrived at by searching Desmos techniques
for the problem's structure, not by dressing up an algebra solution.

## What "least effort" actually means

The optimization target is **not** simply the fewest Desmos lines, and it is
**not** simply "maximum Desmos usage at any cost." Both extremes are wrong:

- A 5-line Desmos method requiring almost no math can beat a 2-line method
  that requires the student to understand or derive a formula. Hidden
  derivation behind a short expression is a cost, not a shortcut.
- Do not avoid basic math at absolutely any cost. If a Desmos workaround
  becomes insanely complicated just to avoid one trivial Algebra 1-level step,
  the basic math step is acceptable. Small substitutions and rearrangements
  are also acceptable when they unlock a useful Desmos technique. Always ask
  first whether Desmos can reasonably do that step instead — but don't force
  the answer to always be yes.

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

## User modes

Desmo offers three modes over the same strategy library (selectable on the
solver page; the server ranks candidates differently per mode):

- **Weaponized Desmos** — replace as much math as reasonably possible with
  Desmos; strongly prioritize reusable Desmos generalizations even when a
  quick manual step would technically be shorter.
- **Desmos First** — strongly prefer Desmos, but allow basic math when it
  clearly and simply simplifies the solution.
- **Fastest SAT Method** — assume stronger existing math knowledge and simply
  choose the fastest reliable method, whether that's Desmos, algebra,
  answer-choice testing, or a hybrid.

**The default is Desmos First; the philosophy leans toward Weaponized Desmos /
Desmos First.** Implementation: `SOLVE_MODES` in `src/lib/solver-schema.ts`,
per-mode priorities and the written-plan gate in `src/lib/strategy-selection.ts`,
per-mode policy text in `buildUserPrompt` (`src/lib/solver-instructions.ts`).

## How the product enforces this

- The model must emit `structure` (what it recognized) before any candidate;
  the output schema orders it first. Every candidate names its `trick` and
  declares `reusable` (works without the answer choices).
- The student sees the recognized structure and the trick name on every
  solution and in history, so pattern recognition is what gets practiced.
- Ranking is per mode (`STRATEGY_PRIORITIES`); reusability breaks simplicity
  ties in Desmos First and outranks effort in Weaponized Desmos.
- A written plan is blocked only while a calculator plan of simplicity 3+
  exists; if every Desmos route is convoluted, one basic step is allowed.
- Reverse-engineered plans are detected structurally, not just discouraged:
  a row using numbers the question never states (`41` from completing the
  square off-screen) or a value defined by a formula in a fitted parameter
  (`a=6/m`) is rejected as hidden derivation, with the runner-up Desmos
  candidate named. The model then gets up to two guided retries in which the
  rejected rows are banned and it must switch methods.

## The review standard

When reviewing any proposed solution — as a design choice, a prompt change, or
a specific answer the model produced — do not ask only:

> "Is this mathematically correct?"

Also ask:

> "Is there a more Desmos-native, reusable, lower-math-burden way to solve
> this?"

That second question is the main standard Desmo is held to. Correctness is
necessary but not sufficient.
