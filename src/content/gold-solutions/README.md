# Gold solutions

Problems with the Desmos solution a human tutor considers the standard to teach:
the Desmos way that takes the math out, the way a student should learn it.
Only add a problem here when you have checked both the answer and the method.

How they are used:

- Every solution leads the solver's candidates prompt as a top-priority example.
  For a problem with the same structure, the solver always lists this method.
- Every solution also runs in the benchmark as its own group
  (`npm run bench:solver -- <label> --group=gold`). The solver has seen these in
  its prompt, so that score shows the standard is followed, not that it
  generalizes; the representative and hard groups measure that.
- `npm test` checks every file: valid schema, unique ids, and calculator rows
  that are executable Desmos.

## Adding a problem

Add an object to `desmo_gold_solutions.json`, or start a new `*.json` file
holding an array. Ids must be unique across every file.

```json
{
  "id": "016",
  "question": "The full question, every number exactly as printed, tables as g(1)=5; g(4)=7.",
  "answer_choices": { "A": "66", "B": "132", "C": "248", "D": "296" },
  "correct_answer": "C",
  "strategy_name": "Short name of the trick",
  "techniqueId": "parameter-regression",
  "trigger_pattern": "What in a question tells the student to reach for this trick.",
  "desmos_steps": [
    "3x^2-16x+2",
    "Click the positive x-intercept: 5.20526.",
    "(a+\\sqrt{b})/6~5.20526"
  ],
  "why_preferred": "Why this Desmos way beats the math way, and any hand step it still needs.",
  "needs_review": false
}
```

- `answer_choices` is `{}` for a student-produced response; `correct_answer` is
  then the value, otherwise the letter.
- `techniqueId` is a vocabulary id from `src/lib/technique-vocabulary.ts`.
- `desmos_steps` mixes calculator rows (exactly as typed) and plain-English
  instructions (what to click, drag, or read). Instructions start with a capital
  letter; rows do not.
- `needs_review: true` keeps a draft in the file but out of the prompt and the
  benchmark.
