import assert from "node:assert/strict";
import { test } from "node:test";
import katex from "katex";

import {
  containsLatex,
  displayProse,
  ProseLatexError,
  repairProseText,
  sanitizeProse,
  sanitizeSolutionProse,
} from "../src/lib/answer-consistency";
import { splitMathText } from "../src/lib/math-text";
import { solutionSchema, type Solution } from "../src/lib/solver-schema";

/** True render pass: MathText's own splitting, through real KaTeX. */
/** Strips KaTeX's hidden MathML <annotation> (the raw TeX source, kept for
 * accessibility/copy-paste, not visible on screen) so a check for a leaked
 * backslash only looks at what a sighted user actually sees. */
function visibleHtml(html: string): string {
  return html.replace(/<annotation[^>]*>[\s\S]*?<\/annotation>/g, "");
}

function renderThroughMathText(text: string): string {
  return splitMathText(text)
    .map((part) =>
      part.type === "text"
        ? part.value
        : katex.renderToString(part.value, {
            throwOnError: false,
            strict: "ignore",
            trust: false,
            maxSize: 10,
            maxExpand: 1000,
          }),
    )
    .join("");
}

function desmosSolution(overrides: Partial<Solution> = {}): Solution {
  return solutionSchema.parse({
    status: "solved",
    question: "What is a + b?",
    choices: null,
    answer: "3",
    method: "desmos",
    why: "",
    steps: [],
    readAnswer: "Read 3.",
    expressions: [{ latex: "y=x^2-9", purpose: "Graph it." }],
    result: { row: 1, value: 3, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "the value" },
    graphBounds: null,
    clarification: null,
    ...overrides,
  });
}

// --- 1. The reported malformed LaTeX repairs to plain text --------------------

test("REGRESSION 1: \\frac{g^{\\prime}^{\\prime}\\left(0\\right)}{2} repairs to g''(0)/2", () => {
  const dirty = "\\frac{g^{\\prime}^{\\prime}\\left(0\\right)}{2}";
  const repaired = repairProseText(dirty);
  assert.equal(repaired, "g''(0)/2");
  assert.doesNotMatch(repaired, /\\/, "no backslash survives in the repaired string");
  assert.equal(sanitizeProse(dirty, "why"), "g''(0)/2");
  // And the repaired text renders through the real pipeline as valid KaTeX,
  // not an error passthrough (KaTeX's own error-fallback echoes the raw,
  // unparsed source back onto the screen — precisely how the original
  // malformed LaTeX produced the reported "visible source" symptom).
  const rendered = renderThroughMathText(repaired);
  assert.doesNotMatch(rendered, /katex-error/, "the rendered formula must be valid, not an error passthrough");
  assert.doesNotMatch(visibleHtml(rendered), /\\/, "no backslash survives to the visibly-rendered output");
});

test("Bedrock radical model: copied square-root notation is repaired in the question and explanation", () => {
  const question = "Let h(x) = -\\sqrt{x^2 + bx + c}. Its graph passes through (3,0) and (0,-\\sqrt{366}). What is m?";
  const repaired = sanitizeProse(question, "question");
  assert.equal(repaired, "Let h(x) = -sqrt(x^2 + bx + c). Its graph passes through (3,0) and (0,-sqrt(366)). What is m?");
  assert.equal(sanitizeProse("The root is \\sqrt{\\sqrt{16}}.", "why"), "The root is sqrt(sqrt(16)).");
  assert.equal(sanitizeProse(repaired, "question"), repaired, "the repair is stable");
  const solution = sanitizeSolutionProse(desmosSolution({ question, why: "h(0)=-\\sqrt{366} means c=366." }));
  assert.equal(solution.question, repaired);
  assert.equal(solution.why, "h(0)=-sqrt(366) means c=366.");
  const rendered = renderThroughMathText(solution.question);
  assert.doesNotMatch(rendered, /katex-error/);
  assert.doesNotMatch(visibleHtml(rendered), /\\/, "no raw TeX reaches the student");
});

// --- 4. Clean prose is untouched, byte-identical -----------------------------

test("REGRESSION 4: prose with no LaTeX passes through byte-identical", () => {
  const clean = "Graph the parabola and click the vertex to read the maximum value.";
  assert.equal(containsLatex(clean), false);
  assert.equal(repairProseText(clean), clean);
  assert.equal(sanitizeProse(clean, "why"), clean);
  // Plain ASCII math the repair pass might otherwise "helpfully" touch.
  for (const text of ["g''(0)/2 + g'(0)", "a = f''(0)/2 and b = f'(0)", "(x+2)(x-8)", "16/17", "r + s"]) {
    assert.equal(sanitizeProse(text, "why"), text, `"${text}" should not be altered further`);
  }
});

// --- 5. A Desmos row's legitimate LaTeX is untouched by the prose validator --

test("REGRESSION 5: sanitizeSolutionProse never touches expressions[].latex", () => {
  const solution = desmosSolution({
    expressions: [
      { latex: "\\frac{f^{\\prime\\prime}(0)}{2}+g_{1}", purpose: "Evaluate the derivative expression." },
      { latex: "y_{1}\\sim mx_{1}+b", purpose: "Fit the line through the given points." },
    ],
  });
  const sanitized = sanitizeSolutionProse(solution);
  assert.deepEqual(
    sanitized.expressions.map((e) => e.latex),
    solution.expressions.map((e) => e.latex),
    "latex fields are Desmos rows, required and untouched",
  );
  // Only the prose "purpose" sibling field is in scope; it was already clean here.
  assert.equal(sanitized.expressions[0].purpose, solution.expressions[0].purpose);
});

test("sanitizeProse rejects text where repair still leaves LaTeX behind", () => {
  // \prime with no base to attach to is not one of the repairable shapes.
  const stillDirty = "an unrepairable \\somecommand{x} in prose";
  assert.throws(
    () => sanitizeProse(stillDirty, "why"),
    (error: unknown) =>
      error instanceof ProseLatexError &&
      error.field === "why" &&
      /must be plain text, not LaTeX/.test(error.message),
  );
});

// --- 3. The full reported "why" paragraph renders clean, no "mean (f)(x)" ---

test("REGRESSION 3: the reported 'The idea' paragraph sanitizes and renders clean", () => {
  const reported = "a = \\frac{f^{\\prime}^{\\prime} \\left(0\\right)}{2} and b = f^{\\prime}(0)";
  const repaired = sanitizeProse(reported, "why");
  assert.equal(repaired, "a = f''(0)/2 and b = f'(0)");
  const rendered = renderThroughMathText(repaired);
  assert.doesNotMatch(rendered, /katex-error/, "no invalid-LaTeX passthrough");
  assert.doesNotMatch(visibleHtml(rendered), /\\/, "no backslash reaches the visibly-rendered HTML");

  // The separate reported mangling: "mean f(x)" must not become "mean (f)(x)".
  const structureSentence = "The two zeros mean f(x) = a(x+2)(x-8) for some integer a.";
  assert.equal(containsLatex(structureSentence), false, "this sentence never had LaTeX to begin with");
  const structureRendered = renderThroughMathText(structureSentence);
  assert.doesNotMatch(structureRendered, /mean\s*\(f\)/i);

  // End to end through the schema/solution object, as the student actually sees it.
  const solution = desmosSolution({ why: reported, structure: structureSentence });
  const sanitized = sanitizeSolutionProse(solution);
  assert.equal(sanitized.why, "a = f''(0)/2 and b = f'(0)");
  assert.equal(sanitized.structure, structureSentence);
  const finalRender = renderThroughMathText(sanitized.why);
  assert.doesNotMatch(finalRender, /katex-error/);
  assert.doesNotMatch(visibleHtml(finalRender), /\\/);
});

// --- 2. The verification-banner template never leaks LaTeX, in either state -

test("REGRESSION 2: reconcileWithCalculator's message is clean for both verified and contradicted", async () => {
  const { reconcileWithCalculator } = await import("../src/lib/answer-consistency");
  // A dirty result.detail simulates a model writing LaTeX where only a few
  // plain words belong; the banner template must not interpolate it verbatim
  // (this is the template's own defense, independent of the server validator).
  const dirtyDetail = "a + b computed as \\frac{g^{\\prime}^{\\prime}\\left(0\\right)}{2} + g^{\\prime}\\left(0\\right)";
  const base = desmosSolution({
    choices: [
      { label: "A", text: "-5" }, { label: "B", text: "-8" },
      { label: "C", text: "-12" }, { label: "D", text: "-15" },
    ],
    answer: "D) -15",
    result: { row: 1, value: -15, listIndex: null, answerFrom: "value", choiceLabel: "D", detail: dirtyDetail },
  });
  const verified = reconcileWithCalculator(base, { type: "Number", value: -15 });
  assert.equal(verified.status, "verified");
  if (verified.status === "verified") {
    assert.doesNotMatch(verified.message, /\\/, "verified message must contain no LaTeX control sequences");
  }
  const contradicted = reconcileWithCalculator(base, { type: "Number", value: -12 });
  assert.equal(contradicted.status, "contradicted");
  if (contradicted.status === "contradicted") {
    assert.doesNotMatch(contradicted.message, /\\/, "contradicted message must contain no LaTeX control sequences");
    assert.doesNotMatch(contradicted.readAnswer, /\\/);
    assert.doesNotMatch(contradicted.message, /solve again/i);
  }
});

test("displayProse repairs cleanly or falls back, but never leaks a backslash", () => {
  assert.equal(displayProse("plain text"), "plain text");
  assert.equal(displayProse("a + b computed as \\frac{g^{\\prime}^{\\prime}(0)}{2}"), "a + b computed as g''(0)/2");
  // A shape with nothing repairProseText knows how to fix falls back safely.
  const fallback = displayProse("\\somecommand{unrepairable}", "the requested value");
  assert.equal(fallback, "the requested value");
  assert.doesNotMatch(fallback, /\\/);
});
