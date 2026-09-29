import assert from "node:assert/strict";
import { test } from "node:test";

import { findDerivedConstants, findDerivedDefinitions, findUndefinedVariables, normalizeDesmosExpressions, unwrapSyntheticResultAlias } from "../src/lib/desmos-latex";

function expressions(...latex: string[]) {
  return latex.map((line, index) => ({
    latex: line,
    purpose: `Explanation for line ${index + 1}; keep x1 wording unchanged.`,
  }));
}

function normalize(...latex: string[]) {
  return normalizeDesmosExpressions(expressions(...latex)).map(
    (expression) => expression.latex,
  );
}

test("plain declared lists and implicit multiplication references become valid subscripts", () => {
  assert.deepEqual(
    normalize("x1=[-6,0]", "y1=[0,-9]", "y1~m*x1+b", "y1~mx1+b"),
    [
      "x_{1}=[-6,0]",
      "y_{1}=[0,-9]",
      "y_{1}~mx_{1}+b",
      "y_{1}~mx_{1}+b",
    ],
  );
});

test("recognizes TeX brackets and declarations after their references", () => {
  assert.deepEqual(
    normalize(
      String.raw`y1\sim mx1+b`,
      String.raw`x1 = \left[-6,0\right]`,
      String.raw`y1=\left [0,-9\right]`,
    ),
    [
      String.raw`y_{1}\sim mx_{1}+b`,
      String.raw`x_{1} = \left[-6,0\right]`,
      String.raw`y_{1}=\left [0,-9\right]`,
    ],
  );
});

test("normalizes plain, unbraced TeX, and Unicode references to the same declared list", () => {
  assert.deepEqual(
    normalize("x_1=[1,2]", "y₁=[3,4]", "y1+y_1+y₁+y_{1}~x1+x_1+x₁+x_{1}"),
    [
      "x_{1}=[1,2]",
      "y_{1}=[3,4]",
      "y_{1}+y_{1}+y_{1}+y_{1}~x_{1}+x_{1}+x_{1}+x_{1}",
    ],
  );
});

test("already canonical TeX equations remain unchanged", () => {
  const original = [
    String.raw`x_{1}=\left[1,2,3\right]`,
    String.raw`y_{1}=\left[4,5,6\right]`,
    String.raw`y_{1}\sim mx_{1}+b`,
    String.raw`f(x)=\frac{12x+28}{4}`,
  ];
  assert.deepEqual(normalize(...original), original);
});

test("normalizes Unicode operators that render correctly but Desmos rejects", () => {
  assert.deepEqual(
    normalize(
      "(a·3²+b×3+c)÷(3+2)",
      "x−4≤7",
      "x≥2",
      "x≠3",
      "2π",
      "y₁≈mx₁+b",
    ),
    [
      String.raw`(a\cdot 3^{2}+b\cdot 3+c)/(3+2)`,
      String.raw`x-4\le 7`,
      String.raw`x\ge 2`,
      String.raw`x\ne 3`,
      String.raw`2\pi `,
      String.raw`y₁\sim mx₁+b`,
    ],
  );
});

test("display-size fraction commands become executable Desmos fractions", () => {
  const original = [
    String.raw`\sin^{-1}\left(\tfrac{1}{2}\right)`,
    String.raw`\dfrac{3}{4}+\frac{1}{2}`,
  ];
  const expected = [
    String.raw`\sin^{-1}\left(\frac{1}{2}\right)`,
    String.raw`\frac{3}{4}+\frac{1}{2}`,
  ];
  assert.deepEqual(normalize(...original), expected);
  assert.deepEqual(normalize(...expected), expected);
});

test("multi-digit identifiers are matched as a whole without changing x10 for x1", () => {
  assert.deepEqual(normalize("x1=[1,2]", "x1+x10+x11+x100"), [
    "x_{1}=[1,2]",
    "x_{1}+x10+x11+x100",
  ]);
  assert.deepEqual(
    normalize("x10=[1,2]", "y₁₂=[3,4]", "x10+x1+x100+y12+y₁₂+y_12"),
    [
      "x_{10}=[1,2]",
      "y_{12}=[3,4]",
      "x_{10}+x1+x100+y_{12}+y_{12}+y_{12}",
    ],
  );
});

test("preserves numeric coefficients, powers, and undeclared indexed expressions", () => {
  assert.deepEqual(
    normalize("x1=[1,2]", "12x+x^2+x2+x_2+x₂+2x1+a1+a_1"),
    ["x_{1}=[1,2]", "12x+x^2+x2+x_2+x₂+2x_{1}+a1+a_1"],
  );
});

test("scalar assignments to letter-digit names become subscripts; undeclared x2 stays a product", () => {
  // x1=4 would graph the vertical line x=4 in Desmos, not define a constant.
  assert.deepEqual(
    normalize("x1=4", "y2=5", "x2+y2", "[x1,y2]", "x^2+12x"),
    ["x_{1}=4", "y_{2}=5", "x2+y_{2}", "[x_{1},y_{2}]", "x^2+12x"],
  );
});

test("preserves TeX commands and log bases while normalizing mathematical arguments", () => {
  assert.deepEqual(
    normalize(
      "x1=[1,2]",
      String.raw`\max(x1,x10)+\log_2(x1)+\frac{12x}{x^2}+\left(x1\right)+\operatorname{max}(x1)`,
      String.raw`\max1+\x1+\xy1+x1`,
    ),
    [
      "x_{1}=[1,2]",
      String.raw`\max(x_{1},x10)+\log_2(x_{1})+\frac{12x}{x^2}+\left(x_{1}\right)+\operatorname{max}(x_{1})`,
      String.raw`\max1+\x1+\xy1+x_{1}`,
    ],
  );
});

test("turns bare named built-ins into executable Desmos LaTeX", () => {
  assert.deepEqual(
    normalize(
      "V=[10,20,30]",
      "F=[2,3,1]",
      "mean(repeat(V,F))",
      "distance((1,2),(4,6))+count([1,2,3])",
      "ceil(437/48)+floor(437/48)+gcd(12,18)+lcm(4,6)+mod(7,3)",
      "polygon((1,2),(7,2),(4,8))",
    ),
    [
      "V=[10,20,30]",
      "F=[2,3,1]",
      String.raw`\operatorname{mean}(\operatorname{repeat}(V,F))`,
      String.raw`\operatorname{distance}((1,2),(4,6))+\operatorname{count}([1,2,3])`,
      String.raw`\operatorname{ceil}(437/48)+\operatorname{floor}(437/48)+\operatorname{gcd}(12,18)+\operatorname{lcm}(4,6)+\operatorname{mod}(7,3)`,
      String.raw`\operatorname{polygon}((1,2),(7,2),(4,8))`,
    ],
  );
});

test("named built-in normalization is idempotent and leaves commands alone", () => {
  const original = [
    String.raw`\operatorname{mean}(L)`,
    String.raw`\sin(x)+\cos(x)+\sqrt{x}`,
    "xmean(L)+meanValue+mymean(L)",
  ];
  assert.deepEqual(normalize(...original), original);
  assert.deepEqual(normalize(...normalize(...original)), original);
});

test("is idempotent and preserves purposes without mutating input", () => {
  const original = expressions("x1=[1,2]", "y1=[3,4]", "y1~mx1+b");
  const before = structuredClone(original);
  const normalized = normalizeDesmosExpressions(original);
  assert.deepEqual(original, before);
  assert.deepEqual(normalizeDesmosExpressions(normalized), normalized);
  assert.deepEqual(
    normalized.map((expression) => expression.purpose),
    original.map((expression) => expression.purpose),
  );
  normalized[0].purpose = "Edited later.";
  assert.deepEqual(original, before);
});

test("flags rows whose letters are neither coordinates, defined, nor fitted", () => {
  const rows = (latex: string[]) => findUndefinedVariables(latex.map((item) => ({ latex: item })));
  // The reported trap: substituting y=19 leaves two non-coordinate unknowns.
  assert.deepEqual(rows(["-q-19w=-337", "2q-19w=47"]), [
    { row: 1, variables: ["q", "w"] },
    { row: 2, variables: ["q", "w"] },
  ]);
  // Its repair: coefficient lists plus one regression fit q and w.
  assert.deepEqual(rows(["a_{1}=[-1,2]", "c_{1}=[-337,47]", "c_{1}\\sim a_{1}q-19w", "w"]), []);
  assert.deepEqual(rows(["y=\\frac{337-x}{w}"]), [{ row: 1, variables: ["w"] }]);
  assert.deepEqual(rows(["x_{1}=[1...5]", "r+s"]), [{ row: 2, variables: ["r", "s"] }]);
  assert.deepEqual(rows(["h(3)"]), [{ row: 1, variables: ["h"] }]);
  assert.deepEqual(rows(["y=\\theta x"]), [{ row: 1, variables: ["\\theta"] }]);
});

test("accepts coordinates, definitions, bound names, constants, and regression parameters", () => {
  const valid: string[][] = [
    ["x_{1}=[1...5]", "\\frac{12x_{1}+28}{4}-\\frac{s}{13}\\sim r(x_{1}-8)", "r+s"],
    [
      "x_{1}=[-6,0]", "y_{1}=[0,-9]", "y_{1}\\sim mx_{1}+b", "f(x)=-1.5x-9",
      "t=[-432,-9,72,288]", "g(x)=\\frac{-sx+t}{48}", "g'(0)\\sim f'(0)", "g(0)-f(0)",
    ],
    ["f(x)=3(kx+13)", "g(x)=\\frac{48}{17}x+36", "f'(x)\\sim g'(x)"],
    ["19350\\sim24000-5x_{1}", "12840\\sim24000-p930"],
    ["y=x^2-4x+1", "y=2x+8"],
    ["3x+2y=17", "x^2+y^2=25", "y=x^2\\left\\{x>0\\right\\}"],
    ["A=[2,4,6,8]", "f(x)=x^2-6x+8", "f(A)"],
    ["\\sum_{n=1}^{20}(2n+1)", "\\left[n^{2}\\operatorname{for}n=\\left[1...5\\right]\\right]"],
    ["a_{2}=[1,2,3]", "b_{2}=[1,5]", "k_{1}=(p+q)\\operatorname{for}p=a_{2},q=b_{2}", "\\operatorname{max}(k_{1})"],
    ["f(a,b)=a+b", "f(2,3)", "\\frac{d}{dx}f(2,x)"],
    ["L=[4,7,9]", "\\operatorname{mean}(L)", "\\operatorname{polygon}((1,2),(7,2),(4,8))", "abs(-3)"],
    ["e^2+\\pi", "y=e^x", "\\sin(30)", "\\tan^{-1}(3/4)", "(3\\cos(t),3\\sin(t))"],
    ["y1~m*x1+b"],
  ];
  for (const plan of valid) {
    assert.deepEqual(findUndefinedVariables(plan.map((latex) => ({ latex }))), [], plan.join(" | "));
  }
});

test("multi-letter names a model invents become valid subscripted Desmos names", () => {
  // Observed in production: Desmos reads diff as d·i·f·f, so the plan was unusable.
  assert.deepEqual(
    normalize(
      "A=[2,4,6,9]",
      "S=6/A",
      "diff=abs(S-f'(0))",
      "match=A[diff=0]",
      "cost(x)=2x+diff",
      "cost(3)",
      "mean(A)",
    ),
    [
      "A=[2,4,6,9]",
      "S=6/A",
      "d_{iff}=\\operatorname{abs}(S-f'(0))",
      "m_{atch}=A[d_{iff}=0]",
      "c_{ost}(x)=2x+d_{iff}",
      "c_{ost}(3)",
      "\\operatorname{mean}(A)",
    ],
  );
  // Reserved words and TeX commands are never treated as invented names.
  assert.deepEqual(normalize("\\sin(30)", "min(A)", "for=3"), ["\\sin(30)", "\\operatorname{min}(A)", "for=3"]);
});

test("every calculator row taught by the new library strategies passes the syntax-safety scan", () => {
  const plans: Record<string, string[]> = {
    "bounded extremum (12)": ["y=-2x^2+12x+7\\left\\{0\\le x\\le 5\\right\\}", "f(x)=-2x^2+12x+7", "f(0)", "f(5)"],
    "equivalent forms (60)": ["x_{1}=[1...5]", "2(x_{1}-3)^2+5 ~ ax_{1}^2+bx_{1}+c", "a+b+c"],
    "vertex from standard (60)": ["x_{1}=[1...5]", "3x_{1}^2-24x_{1}+50 ~ a(x_{1}-h)^2+k", "(h,k)"],
    "coefficient lists (61)": ["a_{1}=[-1,2]", "c_{1}=[-337,47]", "c_{1}\\sim a_{1}q-19w", "w"],
    "nuisance product (61/009)": ["a_{1}=[7,3]", "b_{1}=[12,4]", "c_{1}=[3,5]", "c_{1}\\sim 2a_{1}r+b_{1}p", "r"],
    "factorization identity (72/010)": ["x_{1}=[1...5]", "34x_{1}^2+bx_{1}+70\\sim(2x_{1}+p)(17x_{1}+q)", "P=[1,2,5,7,10,14,35,70]", "Q=70/P", "2Q+17P"],
    "packed conditions (73/011)": ["f(x)=\\frac{x^2+ax+b}{x+c}", "[f(5),f(6),4+c]\\sim[0,0,0]", "a+b+c"],
    "strategic value (74/012)": ["b=1.5", "f(x)=15b^x", "\\frac{f(1)-f(0)}{f(0)}100", "[100(b-1),100b,100(1-b),b-1]"],
    "shared zero (75/013)": ["y=3(-2x)^2+25(-2x)+14x"],
    "shared zero with choices (75)": ["B=[1,2,3,4]", "3(-2B)^2+25(-2B)+14B"],
  };
  for (const [name, plan] of Object.entries(plans)) {
    assert.deepEqual(findUndefinedVariables(plan.map((latex) => ({ latex }))), [], name);
  }
});

test("double equals inside a list filter becomes Desmos's single equals", () => {
  assert.deepEqual(normalize("t=[2,4,6,9]", "match=t[S==m]"), ["t=[2,4,6,9]", "m_{atch}=t[S=m]"]);
});

test("letter-plus-digit names become subscripts, since r2 means r·2 to Desmos", () => {
  assert.deepEqual(
    normalize("r2=\\operatorname{distance}((5,4),(11,8))^2", "n=\\frac{r2-41}{14}", "x1=[1,2]", "2r2+r22"),
    ["r_{2}=\\operatorname{distance}((5,4),(11,8))^2", "n=\\frac{r_{2}-41}{14}", "x_{1}=[1,2]", "2r_{2}+r22"],
  );
});

test("a slider annotation written as LaTeX text becomes the slider field", () => {
  const [row, plain] = normalizeDesmosExpressions([
    { latex: "b=1\\ \\left(\\text{slider: min }1,\\ \\text{max }10,\\ \\text{step }1\\right)", purpose: "" },
    { latex: "y=3x^2+25x+14b", purpose: "" },
  ]);
  assert.equal(row.latex, "b=1");
  assert.deepEqual(row.slider, { min: 1, max: 10, step: 1 });
  assert.equal(plain.slider, undefined);
  const kept = normalizeDesmosExpressions([
    { latex: "k=0 (\\text{slider: min -5, max 5, step 1})", purpose: "", slider: { min: 0, max: 3, step: 1 } },
  ])[0];
  assert.equal(kept.latex, "k=0");
  assert.deepEqual(kept.slider, { min: 0, max: 3, step: 1 }, "an explicit slider field wins over the annotation");
});

test("constants the question never states expose a plan derived off-screen", () => {
  const rows = (latex: string[], purpose = "") => latex.map((item) => ({ latex: item, purpose }));
  const circle = "x^2 + y^2 - 10x - 8y - 14n = 0 represents circle A. Point (11, 8) lies on circle B, which has the same center and twice the diameter. What is n?";
  // Completing the square off-screen produced 41 and 52; neither is in the question.
  assert.deepEqual(findDerivedConstants(rows(["52\\sim4\\left(41-14n\\right)"]), circle, null), [
    { row: 1, constants: [41, 52] },
  ]);
  // The library's routes for the same question use only givens and small numbers.
  assert.deepEqual(findDerivedConstants(rows(["n=1", "x^2+y^2-10x-8y-14n=0", "\\operatorname{midpoint}((5,4),(11,8))"]), circle, null), []);
  assert.deepEqual(findDerivedConstants(rows(["8^2+6^2-10(8)-8(6)-14n\\sim0"]), circle, null), []);
  // Expanding (x-5)(x-6) by hand leaves 30 behind.
  assert.deepEqual(findDerivedConstants(rows(["y=x^2-11x+30"]), "zeros at x=5 and x=6", null), [{ row: 1, constants: [30] }]);
  // Divisors of a given (factor pairs), sample lists, percents, thousands, and copied fits are fine.
  assert.deepEqual(findDerivedConstants(rows(["P=[1,2,5,7,10,14,35,70]", "Q=70/P", "2Q+17P"]), "34z^14+bz^7+70", [{ label: "A", text: "184" }]), []);
  assert.deepEqual(findDerivedConstants(rows(["x_{1}=[1...5]", "(12x_{1}+28)/4-s/13\\sim r(x_{1}-8)"]), "(12x+28)/4 - s/13 = r(x-8)", null), []);
  assert.deepEqual(findDerivedConstants(rows(["\\frac{f(1)-f(0)}{f(0)}100"]), "f(x)=15b^x", null), []);
  assert.deepEqual(findDerivedConstants(rows(["19350\\sim24000-5x_{1}"]), "24,000 bushels; 19,350 remained after 5 hours", null), []);
  assert.deepEqual(findDerivedConstants(rows(["f(x)=-1.5x-9"], "Copy the fitted equation displayed by the regression."), "(-6,0) and (0,-9)", null), []);
});

test("a value defined by a formula in a fitted parameter is a derived formula", () => {
  const rows = (latex: string[]) => latex.map((item) => ({ latex: item }));
  assert.deepEqual(findDerivedDefinitions(rows(["x_{1}=[-4,2]", "y_{1}=[2,11]", "y_{1}\\sim m x_{1}+b", "a=6/m"])), [
    { row: 4, parameters: ["m"] },
  ]);
  // Evaluating the fitted model, copying a displayed fit, or reading a bare expression is not derivation.
  for (const plan of [
    ["x_{1}=[1...5]", "(12x_{1}+28)/4-s/13\\sim r(x_{1}-8)", "r+s"],
    ["x_{1}=[1,2,-1]", "y_{1}=[2,7,4]", "y_{1}\\sim ax_{1}^2+bx_{1}+c", "f(x)=ax^2+bx+c", "f(4)"],
    ["x_{1}=[-6,0]", "y_{1}=[0,-9]", "y_{1}\\sim mx_{1}+b", "f(x)=-1.5x-9", "g(x)=\\frac{-sx+t}{48}", "t=[-432,-9,72,288]", "g'(0)\\sim f'(0)", "g(0)-f(0)"],
    ["n=0", "x^2+y^2-10x-8y-14n=0", "\\operatorname{midpoint}((5,4),(11,8))"],
    ["P=[1,2,5,7,10,14,35,70]", "Q=70/P", "2Q+17P"],
  ]) {
    assert.deepEqual(findDerivedDefinitions(rows(plan)), [], plan.join(" | "));
  }
});

test("only a synthetic result alias can be unwrapped", () => {
  const question = "Line m is 6x-ay=15. What is a?";
  assert.equal(unwrapSyntheticResultAlias("R=3k", question), "3k");
  assert.equal(unwrapSyntheticResultAlias("a=6/m", question), null);
  assert.equal(unwrapSyntheticResultAlias("f(x)=mx+b", question), null);
});

test("multiplication stars become juxtaposition unless that would change the meaning", () => {
  // The reported row: A*(1+2)*(1-8) reads as a harder setup than it is.
  assert.deepEqual(
    normalize("A=[2,3,4,5]", "f_{1}=A*(1+2)*(1-8)", "S=f_{1}-f_{0}"),
    ["A=[2,3,4,5]", "f_{1}=A(1+2)(1-8)", "S=f_{1}-f_{0}"],
  );
  assert.deepEqual(
    normalize("y=m*x+b", "x*y", "2*\\pi", "3*\\sqrt{2}", "(1+2)*(3+4)", "4\\cdot x", "5\\times(2+1)"),
    ["y=mx+b", "xy", "2\\pi", "3\\sqrt{2}", "(1+2)(3+4)", "4x", "5(2+1)"],
  );
  // 23 is not 2*3, x-3 is not x*-3, 2.5 is not 2*.5, and f(3) calls f.
  assert.deepEqual(
    normalize("2*3", "x*2", "x*-3", "2*.5"),
    ["2*3", "x*2", "x*-3", "2*.5"],
  );
  assert.deepEqual(
    normalize("f(x)=x^2+1", "f*(3)", "g_{1}(x)=2x", "g_{1}*(4)", "L=[1,2]", "\\operatorname{mean}*(L)"),
    ["f(x)=x^2+1", "f*(3)", "g_{1}(x)=2x", "g_{1}*(4)", "L=[1,2]", "\\operatorname{mean}*(L)"],
  );
});
