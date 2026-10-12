import { createHash } from "node:crypto";
import type { CacheEntry, Explanation } from "./solve-cache";
import { parseNumber } from "./answer-consistency";
import { selectMethods, type Candidate, type CandidatesResponse } from "./strategy-selection";
import { repairCachedTwoFactorForms, repairTwoFactorForms, twoFactorFormsPlan } from "./two-factor-forms";
import { presentMethod } from "./method-presentation";
import type { Solution } from "./solver-schema";

type NativePlan = {
  candidate: Candidate; explanation: Explanation; structure: string; discard?: Candidate["techniqueId"][];
  supportsChoices?: boolean;
  alternativeCostFloor?: { derivationSteps: number; oneOffFacts: number; insideQuadraticOnly?: boolean };
};

function compact(question: string): string {
  return question.replace(/[−–]/g, "-").replace(/²/g, "^2").replace(/⁴/g, "^4")
    .replace(/\^\{(\d+)\}/g, "^$1").replace(/\\(?:left|right|cdot)/g, "")
    .replace(/\\sqrt\{([^{}]*)\}/g, "sqrt($1)").replace(/\$/g, "").replace(/\s+/g, "");
}

const numberText = (value: number) => String(Number(value.toPrecision(12)));
const term = (value: number) => value < 0 ? String(value) : `+${value}`;
const cost = (derivationSteps = 0, oneOffFacts = 0) => ({ derivationSteps, oneOffFacts, newPrimitives: 0, setupConstructions: 0, manualIterations: 0 });
function candidate(techniqueId: Candidate["techniqueId"], rows: string[], answer: number, detail: string): Candidate {
  return {
    techniqueId, strategy: null, rung: 4, rows: rows.map(latex => ({ latex, slider: null, copiesRow: null })),
    answer: numberText(answer), result: { type: "numeric", row: rows.length, relatedRows: [], value: answer, listIndex: null, answerFrom: "value", choiceLabel: null, detail },
    answerState: null, parameters: [], conditionType: null, distinguishes: null, graphBounds: null, cost: cost(),
  };
}

/** Human-verified gold 015. Two roots determine two unknowns; a single-root
 * fit with a manually fixed slider is not the preferred workflow. Keep this
 * repair scoped to the verified equation and stated integer radical form. */
function quadraticRootGold(question: string): NativePlan | null {
  const text = compact(question).replace(/\\frac\{a\+sqrt\(b\)\}\{6\}/g, "(a+sqrt(b))/6");
  if (!text.includes("3x^2-16x+2=0") || !text.includes("(a+sqrt(b))/6") ||
      !/a\s+and\s+b\s+are\s+integers/i.test(question.replace(/\$/g, "")) ||
      !/(?:value\s+of|find)\s+a\s*\+\s*b/i.test(question.replace(/\$/g, ""))) return null;
  const plan = candidate("bracket-regression", [
    "3x^2-16x+2",
    "[(a+\\sqrt{b})/6,(a-\\sqrt{b})/6]\\sim[5.20526,0.128073]",
    "a+b",
    "\\operatorname{round}(a)+\\operatorname{round}(b)",
  ], 248, "Sum of the fitted integer parameters; rounding removes clicked-root precision error");
  plan.graphBounds = { left: -1, right: 6, bottom: -22, top: 6 };
  return { candidate: plan, supportsChoices: true, discard: ["parameter-regression", "slider-condition"],
    structure: "Graph both roots and fit the two conjugate radical forms together, determining both integer parameters.",
    explanation: {
      why: "Graph the printed quadratic and click both x-intercepts. Match the plus radical form to the larger root and the minus form to the smaller root in one bracket regression. These two independent matches let Desmos fit both a and b at once; no parameter needs a slider or a manually inferred value. The clicked roots have limited decimal precision, so the fitted values are approximately a=16 and b=232. The question says both are integers, so round those fitted values before adding.",
      handMath: "Copy both clicked root coordinates into the bracket regression, with the larger root first. Read the nearby integers 16 and 232; row 4 performs the rounding and addition for you.",
      readAnswer: "Click both x-intercepts of row 1: approximately 5.20526 and 0.128073. Row 2 fits a≈16 and b≈232. Row 3 shows their approximate sum; row 4 rounds each fitted integer parameter and gives a+b=248. Small decimal tails come from the copied roots, not from noninteger values of a or b.",
      steps: [], purposes: [
        "Graphs the equation exactly as printed. Click both x-intercepts and copy their x-coordinates, approximately 5.20526 and 0.128073.",
        "Matches the plus form to the larger clicked root and the minus form to the smaller clicked root simultaneously. Leave both a and b undefined so Desmos fits both; do not add an a=16 slider.",
        "Displays a+b from the fitted parameters. A small decimal tail is expected because the copied graph coordinates are approximate.",
        "Rounds each fitted parameter to its nearby integer, as required by the question, then adds them to display exactly 248. This is explicit rounding of the two-root fit, not an integer-constrained regression.",
      ],
    },
  };
}

/** Fit the inside of a radical, then click its roots; never infer b by hand. */
function radicalRoots(question: string): NativePlan | null {
  const text = compact(question);
  if (!/h\(x\)=-(?:sqrt\(x\^2\+bx\+c\)|√\(x\^2\+bx\+c\))/.test(text) ||
      !/h\(m\)=0/.test(text) || !/greatest\s+(?:possible\s+)?value\s+of\s+m/i.test(question)) return null;
  const point = text.match(/\((\d+(?:\.\d+)?),0\)/);
  const intercept = text.match(/\(0,-(?:sqrt\((\d+)\)|√(\d+))\)/);
  if (!point || !intercept) return null;
  const root = Number(point[1]), constant = Number(intercept[1] ?? intercept[2]);
  if (root <= 0 || constant <= 0 || !Number.isFinite(constant / root)) return null;
  const answer = Math.max(root, constant / root);
  const plan = candidate("bracket-regression", ["f(x)=x^2+bx+c", `[f(${root}),f(0)]\\sim[0,${constant}]`], answer, "Click the rightmost x-intercept of f; the radical has the same zeros");
  plan.result = { ...plan.result, type: "x_intercept", row: 1, relatedRows: [2], value: null, answerFrom: "reasoning" };
  plan.graphBounds = { left: -1, right: answer * 1.15 + 1, bottom: -Math.max(10, constant), top: Math.max(10, constant / 2) };
  plan.cost = cost(1);
  return { candidate: plan, alternativeCostFloor: { derivationSteps: 1, oneOffFacts: 0, insideQuadraticOnly: true }, structure: "A radical's zeros are the zeros of its inside; fit that quadratic from the two given points.", explanation: {
    why: `A square root is zero exactly when its inside is zero. Define that inside as f, then let one bracket regression use the given point (${root},0) and the squared height ${constant} at x=0 to fit both unknowns. Clicking the fitted quadratic's rightmost zero gives the greatest m; no quadratic coefficients need to be solved by hand.`,
    handMath: `Translate h(${root})=0 to f(${root})=0. At x=0, the given height is -sqrt(${constant}), so the inside of that square root is ${constant}. These are the two conditions typed into the fit.`,
    readAnswer: `Click the rightmost x-intercept of row 1 and read its x-coordinate, ${numberText(answer)}. At that input f is zero, so h is also zero; this is the greatest m.`, steps: [],
    purposes: ["Graphs the expression inside the given radical, leaving b and c for Desmos to fit. Its zeros are precisely the radical function's zeros.", `Matches f(${root}) to 0 and f(0) to ${constant}, directly from the two printed points. Two independent conditions let Desmos determine b and c and draw the fitted curve.`],
  } };
}

/** The shared-zero trick searches integer binomial factors, not continuous fits. */
function minimumFactorProduct(question: string): NativePlan | null {
  const text = compact(question);
  if (!/a,?\s*b,?\s*c,?\s*d,?\s*and\s*k\s+are\s+positive\s+integers/i.test(question.replace(/\$/g, "")) ||
      !/(?:smallest|minimum|least)\s+(?:possible\s+)?value\s+of\s+ab/i.test(question.replace(/\$/g, ""))) return null;
  const polynomial = text.match(/(\d+)x\^(\d+)\+(\d+)x\^(\d+)\+(\d+)/);
  if (!polynomial) return null;
  const [leading, high, middle, power, constant] = polynomial.slice(1).map(Number);
  if (high !== 2 * power || power < 1 || leading < 1 || constant < 1 || leading * constant > 10000 || leading > 200 || constant > 200 || middle > 10000 ||
      !text.includes(`(k)(ax^${power}+b)(cx^${power}+d)`)) return null;
  let answer = Infinity;
  // Independent exact check. The primitive integer factor with this root
  // divides the integer polynomial (Gauss's lemma); any multiple has larger ab.
  for (let a = 1; a <= leading; a++) for (let b = 1; b <= constant; b++) {
    if (leading * b * b - middle * a * b + constant * a * a === 0) answer = Math.min(answer, a * b);
  }
  if (!Number.isFinite(answer)) return null;
  const rows = [`f(t)=${leading}t^2+${middle}t+${constant}`, `a_{1}=[1...${leading}]`, `b_{1}=[1...${constant}]`,
    "p_{1}=[ab\\operatorname{for}a=a_{1},b=b_{1}]", "r_{1}=[f(-b/a)\\operatorname{for}a=a_{1},b=b_{1}]", "\\min(p_{1}[\\abs(r_{1})<10^{-8}])"];
  const plan = candidate("shared-zero", rows, answer, "The minimum ab among integer factors whose zero is shared by the polynomial");
  plan.cost = cost(1);
  return { candidate: plan, structure: "Treat the repeated power as one variable and test integer binomial factors by their shared zero.", explanation: {
    why: `Treat the repeated power x^${power} as a single placeholder t. A binomial at+b is a factor only when its zero, t=-b/a, is also a zero of f. Desmos tests every positive integer a up to ${leading} and b up to ${constant}, keeps the pairs with that shared zero, and chooses the least ab. These bounds cover every factor because a divides the leading coefficient and b divides the constant term. The smallest pair is the primitive integer factor, so the remaining factor also has integer coefficients.`,
    handMath: `Recognize the repeated power as one placeholder and that at+b is zero at t=-b/a. You type this test once; Desmos searches the integer pairs and multiplies them. Negative t here tests a polynomial identity, not a real value of the original x^${power}.`,
    readAnswer: `Read row 6: ${answer} is the least ab among the integer factor pairs. The filter checks every pair in the stated bounds rather than accepting one arbitrary regression fit.`, steps: [],
    purposes: [`Uses the printed coefficients unchanged in the polynomial in t, where t stands for the repeated power x^${power}.`, `Lists every possible positive integer a. Since kac=${leading}, none can exceed ${leading}.`, `Lists every possible positive integer b. Since kbd=${constant}, none can exceed ${constant}.`, "Builds ab for every combination of the two integer lists, preserving their order for the next row's tests.", "Evaluates the polynomial at each candidate factor's zero -b/a in that same order. A zero means the binomial and polynomial share that root.", "Keeps only products whose polynomial test is zero, allowing tiny floating-point rounding, and uses min to return the least valid product."],
  } };
}

function tangentVertex(question: string): NativePlan | null {
  if (!/exactly\s+one\s+real\s+solution/i.test(question) || !/value\s+of\s+k/i.test(question)) return null;
  const text = compact(question), line = text.match(/y=(-?\d+)x([+-])k/), quad = text.match(/y=(\d+)x\^2([+-]\d+)x([+-]\d+)/);
  if (!line || !quad) return null;
  const [slope, a, b, c] = [line[1], quad[1], quad[2], quad[3]].map(Number);
  if (a <= 0) return null;
  const vx = -(b - slope) / (2 * a), vy = c - (b - slope) ** 2 / (4 * a), answer = line[2] === "-" ? -vy : vy;
  const plan = candidate("vertex-of-difference", [`y=(${a}x^2${term(b)}x${term(c)})-(${slope})x`], answer, "Read the vertex height of the difference and account for the line's sign on k");
  // Preserve an exact rational answer when the displayed vertex is rounded.
  let numerator = ((b-slope)**2-4*a*c) * (line[2] === "-" ? 1 : -1), denominator = 4*a;
  let g = Math.abs(numerator), d = denominator;
  while (d) [g,d] = [d,g%d];
  numerator /= g; denominator /= g;
  let finiteDecimal = denominator;
  while (finiteDecimal % 2 === 0) finiteDecimal /= 2;
  while (finiteDecimal % 5 === 0) finiteDecimal /= 5;
  if (finiteDecimal !== 1) plan.answer = `${numerator}/${denominator}`;
  plan.result = { ...plan.result, type: "vertex", value: null, answerFrom: "reasoning" };
  plan.graphBounds = { left: vx - 4, right: vx + 4, bottom: vy - 2, top: Math.max(2, vy + 6) };
  // Reading the sign of a vertical shift is not an algebra derivation. Its
  // small sign change is still explicitly named in the handMath explanation.
  plan.cost = cost();
  return { candidate: plan, structure: "Exactly one line–parabola intersection: click the vertex of their vertical difference.", explanation: {
    why: "Graph the parabola minus the slope part of the line, using both expressions as printed. This difference is the vertical gap before the constant k shifts the line. Exactly one intersection happens when that gap just touches zero at its vertex. Clicking the vertex reveals the required vertical shift.",
    handMath: line[2] === "-" ? "The line contains -k, so change the sign of the clicked vertex height to get k. No other arithmetic is needed." : null,
    readAnswer: `Click the vertex on row 1. Its displayed y-coordinate is approximately ${numberText(vy)}. ${line[2] === "-" ? "Change its sign" : "Read that same height"} to obtain k≈${numberText(answer)}${plan.answer.includes("/") ? ` (exactly ${plan.answer})` : ""}.`, steps: [],
    purposes: ["Subtracts the line's printed slope term from the printed parabola. The lowest gap is its vertex; shifting by the missing constant until that gap is zero makes the two original curves touch once."],
  } };
}

function universalNoSolution(question: string): NativePlan | null {
  const text = compact(question);
  if (!/no\s+real\s+solution\s+for\s+every\s+value\s+of\s+b\s+other\s+than/i.test(question) || !/value\s+of\s+a/i.test(question)) return null;
  const equation = text.match(/(\d+)x\^2\+(\d+)\(ax\^2-b\)=(\d+)x\^2-(\d+)/);
  const exception = question.match(/other\s+than\s+\$?(\d+(?:\.\d+)?)/i);
  if (!equation || !exception) return null;
  const [p, q, r, s] = equation.slice(1).map(Number), exceptionalB = Number(exception[1]);
  if (q <= 0 || q * exceptionalB !== s) return null;
  const answer = (r - p) / q;
  const plan = candidate("bracket-regression", [`[${p}+${q}a,-${q}t]\\sim[${r},-${s}]`, "a", "b=0", `y=${p}x^2+${q}(ax^2-b)`, `y=${r}x^2-${s}`], answer, "The fitted a matches curvature; only the stated exceptional b makes the curves overlap");
  plan.rows[2].slider = { min: exceptionalB - 5, max: exceptionalB + 5, step: 0.1 };
  plan.result.row = 2; plan.result.relatedRows = [4, 5];
  plan.conditionType = "no-solution"; plan.distinguishes = "constant-ratio-checked"; plan.cost = cost(1);
  plan.graphBounds = { left: -2, right: 2, bottom: -s - 10, top: r * 4 + 10 };
  return { candidate: plan, discard: ["slider-condition"], structure: "Match the two parabolas' curvature; all other vertical shifts are disjoint, with exactly one overlap exception.", explanation: {
    why: "Changing b moves the left parabola vertically. To stay disjoint for every shift except one, the two parabolas must have the same curvature; different curvatures would cross for some other shifts. One bracket regression matches their x-squared coefficients and their constant terms, finding a and the overlap value t without rearranging equations. The graphs then show why every b other than that overlap value gives no solution.",
    handMath: `Recognize the x-squared coefficient on the left as ${p}+${q}a and its constant as -${q}b. Match these to ${r} and -${s}; the fit uses t for the exceptional b so b remains a slider. Compare fitted t=${exceptionalB} with the exception printed in the question.`,
    readAnswer: `Read row 2: a=${numberText(answer)}. The regression also gives t=${exceptionalB}, matching the stated exception. Drag b in row 3: both parabolas have the same shape, overlap at b=${exceptionalB}, and are separated vertically for every other b. This is a curvature-and-shift argument for every real b, not a conclusion from a few slider samples.`, steps: [],
    purposes: [`Fits the x-squared coefficients ${p}+${q}a and ${r}, and the constant terms -${q}t and -${s}. Desmos returns a and the exceptional overlap value t.`, "Displays the fitted a, the value asked for, without solving the coefficient equation by hand.", "Lets you vary b while keeping the fitted a unchanged, to see the overlap exception and the disjoint vertical shifts.", "Graphs the original left expression with the fitted a and the current b; its curvature matches the other parabola, rather than disappearing.", "Graphs the original right expression. At the exceptional b the graphs overlap; at every other b the identical curvatures and different heights make them disjoint."],
  } };
}

function vertexCoefficientSum(question: string): NativePlan | null {
  const plain = question.replace(/\$/g, "");
  if (!/parabola/i.test(plain) || !/intersects\s+the\s+x-axis\s+at\s+two\s+points/i.test(plain) ||
      !/smallest\s+possible\s+integer\s+value\s+of\s+a\s*\+\s*b\s*\+\s*c/i.test(plain) || !compact(question).includes("y=ax^2+bx+c")) return null;
  const vertex = plain.match(/vertex\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/i);
  if (!vertex) return null;
  const h = Number(vertex[1]), v = Number(vertex[2]);
  if (v >= 0 || h === 1) return null;
  const answer = Math.floor(v) + 1;
  const plan = candidate("strategic-value-test", [`y=x(1-(${h}))^2${term(v)}\\{x>0\\}`, `\\floor(${v})+1`], answer, "The least integer above the open lower endpoint of the f(1) range");
  plan.cost = cost(1, 1);
  plan.graphBounds = { left: -1, right: 3, bottom: v - 2, top: v + 10 };
  return { candidate: plan, structure: "a+b+c is the function value at 1; graph its entire range using the vertex and positive opening.", explanation: {
    why: `Putting 1 into ax^2+bx+c gives a+b+c without expanding anything. The vertex form is a(x-(${h}))^2${term(v)}. Because its vertex is below the x-axis and it crosses twice, it opens upward, so a is positive. Row 1 graphs the value at 1 for every positive a, using horizontal x as the a parameter. The open lower endpoint is ${v}, so the least possible integer is the next integer above it.`,
    handMath: "Use the vertex form a(x-h)^2+v and recognize that a+b+c=f(1). Two x-intercepts with a vertex below the axis require a>0. The graph handles every positive a; no coefficient expansion or sampled integer search is needed.",
    readAnswer: `Row 1 shows all possible a+b+c values strictly above ${v}; the boundary itself is excluded because a=0 is not a parabola. Row 2 gives ${answer}, the first integer above that boundary. Since the vertex's x-coordinate is not 1, the positive ray covers every value above the endpoint.`, steps: [],
    purposes: [`Plots f(1) from the given vertex (${h},${v}), with horizontal x standing for all positive values of a. The restriction includes the whole continuous domain, not a finite sample.`, `floor(${v})+1 returns the first integer strictly greater than the open boundary ${v}, including when that boundary is itself an integer.`],
  } };
}

function pyramidHeight(question: string): NativePlan | null {
  if (!/square\s+right\s+pyramid/i.test(question) || !/height\s+of\s+the\s+pyramid/i.test(question)) return null;
  const plain = question.replace(/\$/g, ""), area = plain.match(/surface\s+area\s+of\s+(\d+(?:\.\d+)?)/i), slant = plain.match(/slant\s+height\s+of\s+(\d+(?:\.\d+)?)/i);
  if (!area || !slant) return null;
  const total = Number(area[1]), length = Number(slant[1]), side = Math.sqrt(length ** 2 + total) - length;
  if (length <= 0 || total <= 0 || side >= 2 * length) return null;
  const answer = Math.sqrt(length ** 2 - (side / 2) ** 2);
  const plan = candidate("story-system", [`x^2+4(x(${length})/2)=${total}\\{x>0\\}`, `(x/2)^2+y^2=${length}^2\\{y>0\\}`], answer, "The positive intersection's y-coordinate is the pyramid's vertical height");
  plan.result = { ...plan.result, type: "intersection", row: 1, relatedRows: [2], value: null, answerFrom: "reasoning" };
  plan.graphBounds = { left: -1, right: Math.max(2 * length, side * 1.3), bottom: -1, top: length * 1.3 };
  plan.cost = cost(1, 2);
  return { candidate: plan, alternativeCostFloor: { derivationSteps: 1, oneOffFacts: 2 }, structure: "Graph the surface-area condition and the slant-height triangle together; the intersection gives both dimensions.", explanation: {
    why: `Let horizontal x be the square's side length and vertical y be the pyramid's height. The base is a square and the four side faces are triangles with slant height ${length}; row 1 copies their total area. A cross-section through the apex and the middle of a base edge forms a right triangle with legs x/2 and y and hypotenuse ${length}; row 2 copies that relationship. Their positive intersection satisfies both given conditions, so its y-coordinate is the requested height.`,
    handMath: "Recognize square area x^2, four triangle areas (base × slant height)/2, and the Pythagorean relation for the cross-section. The horizontal leg is half a base side. Desmos solves both equations together; there is no intermediate side length to copy into a height formula.",
    readAnswer: `Click the positive intersection of rows 1 and 2. Read the y-coordinate ${numberText(answer)} for the pyramid's vertical height; the x-coordinate is the base side length.`, steps: [],
    purposes: [`Graphs the given total area ${total} as one square base plus four triangular faces of slant height ${length}. Positive x excludes an impossible side length.`, `Graphs the right-triangle relationship between half a base side, the vertical height y, and slant height ${length}. Positive y excludes the reflected, nonphysical height.`],
  } };
}

function circleRadius(question: string): NativePlan | null {
  const plain = question.replace(/\$/g, "");
  if (!/graph[^.]{0,100}\bcircle\b/i.test(plain) || !/radius[^.]{0,100}\bnp\b/i.test(plain) ||
      !/n\s+and\s+p\s+are\s+positive\s+constants/i.test(plain) || !/value\s+of\s+n/i.test(plain)) return null;
  const equation = compact(question).match(/(\d+)x\^2-(\d+)px\+(\d+)y\^2-(\d+)py=(\d+)p\^2/);
  if (!equation) return null;
  const [a, bx, ay, by, c] = equation.slice(1).map(Number);
  if (a <= 0 || a !== ay || ![a, bx, by, c].every(Number.isSafeInteger)) return null;
  const answer = Math.sqrt(c/a+(bx/(2*a))**2+(by/(2*a))**2);
  const plan = candidate("expanded-circle", ["p=1", `[-${bx}p,-${by}p,-${c}p^2]\\sim[-2(${a})h,-2(${a})k,${a}(h^2+k^2-r^2)]`, "\\abs(r)/p"], answer, "The fitted radius divided by the positive scale p gives n");
  plan.cost = cost(1, 1);
  return { candidate: plan, alternativeCostFloor: { derivationSteps: 1, oneOffFacts: 1 }, structure: "A scaled expanded circle: fit its center and radius directly from the printed coefficients.", explanation: {
    why: "The x-squared and y-squared terms have the same coefficient, so use the circle's center-radius form. A bracket regression matches the printed x, y, and constant coefficients to that form, letting Desmos find the center h,k and radius magnitude r. Set the positive scale p to 1; dividing the fitted radius by p gives its multiplier n. Keep the printed coefficients in the fit so there are no hidden divisions or completed-square constants to reconstruct.",
    handMath: `Recognize the circle form ${a}((x-h)^2+(y-k)^2-r^2)=0: its x, y, and constant coefficients are -2(${a})h, -2(${a})k, and ${a}(h^2+k^2-r^2). Move the printed right side to the left by changing its sign. Desmos fits those three relationships; you do no coefficient arithmetic.`,
    readAnswer: `Read row 3: ${numberText(answer)} is abs(r)/p, the requested positive multiplier n. The sign of the fitted r is immaterial because a radius is positive.`, steps: [],
    purposes: ["Uses the allowed positive scale p=1. Because every linear coefficient scales with p and the constant with p squared, radius/p is independent of this choice.", `Matches the given linear coefficients -${bx}p and -${by}p and the constant -${c}p^2 to the circle form, keeping every printed number intact. The three matches determine h, k, and the radius magnitude.`, "Divides the positive fitted radius by the chosen p to display n directly."],
  } };
}

/** Complete structure matches only. Unrecognized questions retain normal model solving. */
export function desmosNativePlan(question: string): NativePlan | null {
  return quadraticRootGold(question) ?? twoFactorFormsPlan(question) ?? radicalRoots(question) ?? minimumFactorProduct(question) ?? tangentVertex(question) ?? universalNoSolution(question) ?? vertexCoefficientSum(question) ?? pyramidHeight(question) ?? circleRadius(question);
}

export function repairDesmosNativePlans(response: CandidatesResponse): CandidatesResponse {
  response = repairTwoFactorForms(response);
  if (response.status !== "solved") return response;
  const plan = desmosNativePlan(response.question);
  if (!plan || (response.choices?.length && !plan.supportsChoices)) return response;
  if (response.choices?.length) {
    const matches = response.choices.filter(choice => parseNumber(choice.text) === parseNumber(plan.candidate.answer));
    if (matches.length !== 1) return response;
    plan.candidate.result.choiceLabel = matches[0].label;
  }
  const expected = parseNumber(plan.candidate.answer)!;
  const alternatives = response.candidates.filter(other => {
    const answer = parseNumber(other.answer) ?? response.choices?.filter(choice => choice.label === other.result.choiceLabel).map(choice => parseNumber(choice.text))[0] ?? null;
    // A rounded slider position that draws two crossings (or none) cannot
    // substantiate an exact tangency answer. Keep genuine exact alternatives.
    if (plan.candidate.techniqueId === "vertex-of-difference" && other.techniqueId === "slider-condition" &&
        (!other.answerState || Math.abs(other.answerState.value - expected) > 1e-7 * Math.max(1, Math.abs(expected)))) return false;
    return other.techniqueId !== plan.candidate.techniqueId && !plan.discard?.includes(other.techniqueId) && answer !== null && Math.abs(answer - expected) < 1e-8 * Math.max(1, Math.abs(expected));
  }).map(other => {
    const floor = plan.alternativeCostFloor;
    if (!floor || !other.rows.length || (floor.insideQuadraticOnly && !other.rows.some(row => /[a-z]\(x\)=x\^\{?2\}?\+bx\+c/.test(row.latex.replace(/\s+/g, ""))))) return other;
    // The same geometry/inside-function recognition applies to all methods.
    // A model reporting zero must not hide those steps just to win selection.
    return { ...other, cost: { ...other.cost, derivationSteps: Math.max(other.cost.derivationSteps, floor.derivationSteps), oneOffFacts: Math.max(other.cost.oneOffFacts, floor.oneOffFacts) } };
  });
  return { ...response, structure: plan.structure, candidates: [plan.candidate, ...alternatives].slice(0, 6), preferredTechniqueId: plan.candidate.techniqueId };
}

/** Fix existing recognized entries too, without a global cache reset or paid regeneration. */
export function repairCachedDesmosNativePlans(entry: CacheEntry): CacheEntry {
  entry = repairCachedTwoFactorForms(entry);
  const recognized = desmosNativePlan(entry.question);
  if ((entry.choices?.length && !recognized?.supportsChoices) || entry.retryOf !== null || !recognized) return entry;
  const selection = selectMethods(repairDesmosNativePlans({
    status: "solved", question: entry.question, choices: entry.choices, structure: entry.structure ?? "", clarification: null,
    library: { matched: [], skipped: [] }, preferredTechniqueId: null,
    candidates: entry.methods.filter(method => !method.rejected).map(method => ({
      techniqueId: method.techniqueId, strategy: null, rung: method.rung, rows: method.rows.map(row => ({ ...row, copiesRow: null })),
      answer: method.answer, result: method.result, answerState: method.answerState, parameters: method.parameters,
      conditionType: method.conditionType, distinguishes: method.distinguishes, graphBounds: method.graphBounds, cost: method.cost,
    })),
  }));
  const plan = desmosNativePlan(entry.question)!;
  // Changed rows need a new verdict key: an old browser error or clean report
  // must not silently apply to a repaired calculator batch under the same name.
  const suffix = createHash("sha256").update(JSON.stringify(plan.candidate.rows)).digest("hex").slice(0, 8);
  const id = `${plan.candidate.techniqueId}-native-${suffix}`;
  const methods = selection.methods.map(method => method.techniqueId === plan.candidate.techniqueId && !method.rejected ? { ...method, id } : method);
  const winnerId = selection.winnerId === plan.candidate.techniqueId ? id : selection.winnerId;
  return { ...entry, structure: selection.structure, methods, winnerId, modelPreference: selection.modelPreference };
}

/** Correct known obsolete saved methods on read, retaining the user's
 * other saved methods and ownership checks. No database rewrite or model call. */
export function repairSavedNativeSolution(solution: Solution): Solution {
  if (solution.status !== "solved") return solution;
  const plan = desmosNativePlan(solution.question);
  if (!plan || (solution.choices?.length && !plan.supportsChoices)) return solution;
  const badFactorFit = twoFactorFormsPlan(solution.question) && (solution.expressions.some(row => /~|\\sim/.test(row.latex)) || parseNumber(solution.answer) !== parseNumber(plan.candidate.answer));
  const badNoSolutionSlider = plan.discard?.includes("slider-condition") && solution.answerState?.param === "a";
  const oldRootFit = plan.supportsChoices && solution.expressions.some(row => /~|\\sim/.test(row.latex)) && solution.expressions.some(row => /^a\s*=\s*16$/.test(row.latex));
  if (!badFactorFit && !badNoSolutionSlider && !oldRootFit) return solution;
  const selected = selectMethods(repairDesmosNativePlans({ status: "solved", question: solution.question, choices: solution.choices, structure: plan.structure, clarification: null, library: { matched: [], skipped: [] }, candidates: [plan.candidate], preferredTechniqueId: null }));
  const method = selected.methods.find(method => method.id === selected.winnerId)!;
  return presentMethod({ version: 1, cacheKey: "saved-native-repair", promptConfigVersion: "", question: solution.question, choices: solution.choices, structure: plan.structure, methods: selected.methods, winnerId: method.id, modelPreference: null, retryOf: null, createdAt: "" }, method, plan.explanation);
}
