import assert from "node:assert/strict";
import { test } from "node:test";
import katex from "katex";
import { splitAnswerLabel, splitMathText } from "../src/lib/math-text";

const formulas = (text: string) => splitMathText(text).filter(p => p.type === "math").map(p => p.value);

test("typesets legacy polynomial answers and keeps choice letters separate", () => {
  assert.deepEqual(splitAnswerLabel("D) 3x^2 + 25x + 14b"), { label: "D", text: "3x^2 + 25x + 14b" });
  assert.deepEqual(formulas("3x^2 + 25x + 14b"), ["3 x^{2} + 25 x + 14 b"]);
  assert.deepEqual(splitAnswerLabel("7 (choice C)"), { label: "C", text: "7" });
  assert.deepEqual(splitAnswerLabel("403"), { label: null, text: "403" });
});

test("fractions retain grouped numerators, denominators, signs, and precedence", () => {
  assert.deepEqual(formulas("so (k-7)/6 must be a positive integer"), ["\\frac{k - 7}{6}"]);
  assert.deepEqual(formulas("b = (2k - 14)/12 = (k - 7)/6"), ["b = \\frac{2 k - 14}{12} = \\frac{k - 7}{6}"]);
  assert.deepEqual(formulas("x=-2b"), ["x = -2 b"]);
  assert.deepEqual(formulas("(3 x + 1)/2"), ["\\frac{3 x + 1}{2}"]);
  assert.deepEqual(formulas("a/(b/c)"), ["\\frac{a}{\\frac{b}{c}}"]);
});

test("supports powers, subscripts, derivative notation, coordinates, and functions", () => {
  for (const input of ["x_1", "x_{1}", "x₁"]) assert.deepEqual(formulas(input), ["x_{1}"]);
  assert.deepEqual(formulas("sqrt(9)"), ["\\sqrt{9}"]);
  assert.deepEqual(formulas("max(3,4)"), ["\\operatorname{max}\\left(3,\\,4\\right)"]);
  assert.deepEqual(formulas("x² + y³"), ["x^{2} + y^{3}"]);
  assert.deepEqual(formulas("(7,22)"), ["\\left(7,\\,22\\right)"]);
  assert.deepEqual(formulas("f'(0)"), ["f^{\\prime} \\left(0\\right)"]);
  assert.deepEqual(formulas("50%"), ["50\\%"]);
  assert.deepEqual(formulas(String.raw`\frac{16}{17}`), [String.raw`\frac{16}{17}`]);
});

test("preserves prose and currency, and supports explicit math delimiters", () => {
  assert.deepEqual(splitMathText("A positive integer; choose the correct answer."), [{ type: "text", value: "A positive integer; choose the correct answer." }]);
  assert.equal(splitMathText("A 3-inch pan")[0].value, "A ");
  assert.deepEqual(formulas(String.raw`Read \(x^2\), then $\frac{1}{2}$ and \[y_1\].`), ["x^2", String.raw`\frac{1}{2}`, "y_1"]);
  const price = splitMathText("Pay $3 and $4.");
  assert.equal(price.filter(p => p.type === "text").map(p => p.value).join(""), "Pay $ and $.");
  assert.deepEqual(formulas("Pay $3 and $4."), ["3", "4"]);
  assert.deepEqual(formulas("Divide by 6."), ["6"]);
  assert.deepEqual(formulas("Use the choice's x-coefficient."), ["x"]);
  assert.deepEqual(formulas("Use the choice’s x-coefficient."), ["x"]);
  assert.deepEqual(formulas("y = 2by"), ["y = 2 by"]);
});

test("the reported broken walkthrough produces valid KaTeX without raw powers or division", () => {
  const examples = [
    "If x+2b is a factor then x=-2b is a root; substituting gives b(12b-2k+14)=0 so (k-7)/6 must be a positive integer; only k=25 yields b=3.",
    "Set x = -2b (zero of x+2b) and evaluate 3x^2 + kx + 14b with the choice's x-coefficient.",
    "3(-2b)^2 + k(-2b) + 14b = 12b^2 - 2kb + 14b = b(12b - 2k + 14).",
    "Since b>0, require 12b - 2k + 14 = 0 → b = (2k -14)/12 = (k-7)/6.",
    "Test k values: k=7 → b=0 (not positive); k=16 → b=9/6 (not integer); k=18 → 11/6 (no); k=25 → (25-7)/6 = 18/6 = 3.",
  ];
  for (const text of examples) {
    const parts = splitMathText(text);
    assert.doesNotMatch(parts.filter(p => p.type === "text").map(p => p.value).join(""), /\^|\//);
    for (const part of parts.filter(p => p.type === "math")) {
      assert.doesNotThrow(() => katex.renderToString(part.value, { throwOnError: true, trust: false }));
    }
  }
});

test("does not evaluate input or introduce trusted HTML", () => {
  const source = '<script>alert("x")</script>';
  const parts = splitMathText(source);
  assert.ok(parts.some(p => p.type === "text" && p.value.includes("script")));
  const hostile = formulas(String.raw`\(\href{javascript:alert(1)}{click}\)`)[0];
  const rendered = katex.renderToString(hostile, { trust: false, throwOnError: false });
  assert.doesNotMatch(rendered, /href="javascript:/);
});

// --- A3: LaTeX must never leak into prose, and it must be valid where it IS used ---

test("consecutive primes are one valid superscript, not an invalid stacked one", () => {
  // g^{\prime}^{\prime} is a KaTeX "Double superscript" parse error; a single
  // superscript containing both \prime commands is the correct, valid form.
  assert.deepEqual(formulas("f''(0)"), ["f^{\\prime\\prime} \\left(0\\right)"]);
  assert.deepEqual(formulas("g'''(0)"), ["g^{\\prime\\prime\\prime} \\left(0\\right)"]);
  assert.deepEqual(formulas("f'(0)"), ["f^{\\prime} \\left(0\\right)"], "a single prime is unaffected");
  for (const tex of formulas("a = f''(0)/2 and b = f'(0)")) {
    const html = katex.renderToString(tex, { throwOnError: false, strict: "ignore", trust: false, maxSize: 10, maxExpand: 1000 });
    assert.doesNotMatch(html, /katex-error/, `"${tex}" must be valid, parseable LaTeX`);
  }
});

test('a function name that is also an English word ("mean") is only a call when actually invoked', () => {
  // Root cause of the reported "mean (f)(x)" mangling: "mean" is a recognized
  // Desmos statistics function, so the parser treated ordinary prose "mean
  // f(x)" as a call to mean(f), stealing "f" as its argument and leaving the
  // real "(x) = ..." clause behind as stray, unmatched-looking text.
  const rendered = (text: string) => splitMathText(text).map((p) => p.type === "math" ? `[${p.value}]` : p.value).join("");
  const sentence = "The two zeros mean f(x) = a(x+2)(x-8) for some integer a.";
  const output = rendered(sentence);
  assert.doesNotMatch(output, /mean\s*\(f\)/i, "must not mangle into \"mean (f)(x)\"");
  assert.match(output, /^The two zeros mean \[f/, "\"mean\" stays plain English; \"f(x)...\" is recognized separately");
  // A genuine call is still recognized.
  assert.deepEqual(formulas("Use mean(L) to find the average."), ["\\operatorname{mean}\\left(L\\right)"]);
  assert.deepEqual(formulas("count the integers"), [], "\"count\" alone, with no call, is not math");
});
