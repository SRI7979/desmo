import { parseNumber } from "./answer-consistency";
import { findTranscriptionConflicts, isIntegerFactorExtremumQuestion, StrategySelectionError, type CandidatesResponse, type Candidate } from "./strategy-selection";

type Pair = { x: number; y: number };

function numbers(list: string): number[] | null {
  const values = list.split(",").map((value) => Number(value.trim().replace(/[−–]/g, "-")));
  return values.length > 0 && values.every(Number.isFinite) ? values : null;
}

/**
 * The table, read from the transcription only. The model's own rows are never
 * a source of data: they may hold values it computed (f(1)=15 from g(1)=5).
 */
function questionPoints(question: string): Pair[] {
  const gValues = [
    ...[...question.matchAll(/\bg\s*\(\s*(-?\d+(?:\.\d+)?)\s*\)\s*=\s*(-?\d+(?:\.\d+)?)/gi)].map((match) => ({ x: Number(match[1]), y: Number(match[2]) })),
    // "x: 1 → g(x)=5"
    ...[...question.matchAll(/\bx\s*[:=]\s*(-?\d+(?:\.\d+)?)\s*(?:→|->|,|;|\|)\s*g\s*\(\s*x\s*\)\s*=\s*(-?\d+(?:\.\d+)?)/gi)].map((match) => ({ x: Number(match[1]), y: Number(match[2]) })),
  ].filter((point, index, all) => all.findIndex((other) => other.x === point.x) === index);
  if (gValues.length >= 2) return gValues;

  const tableStart = question.search(/\b(?:table|g\s+passes\s+through)\b/i);
  if (tableStart < 0) return [];
  const table = question.slice(tableStart);
  const pairs = [...table.matchAll(/\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g)]
    .map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
  if (pairs.length >= 2) return pairs;

  const markdownRows = [...table.matchAll(/\|\s*(-?\d+(?:\.\d+)?)\s*\|\s*(-?\d+(?:\.\d+)?)\s*\|/g)]
    .map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
  if (markdownRows.length >= 2) return markdownRows;

  const xValues = table.match(/\bx\s*(?:values?)?\s*[:=]\s*\[?\s*((?:-?\d+(?:\.\d+)?\s*,\s*)+-?\d+(?:\.\d+)?)\s*\]?/i);
  const yValues = table.match(/\bg\s*\(\s*x\s*\)\s*(?:values?)?\s*[:=]\s*\[?\s*((?:-?\d+(?:\.\d+)?\s*,\s*)+-?\d+(?:\.\d+)?)\s*\]?/i);
  const xs = xValues ? numbers(xValues[1]) : null;
  const ys = yValues ? numbers(yValues[1]) : null;
  return xs && ys && xs.length === ys.length ? xs.map((x, index) => ({ x, y: ys[index] })) : [];
}

function parseProblem(question: string) {
  let text = question.replace(/[−–]/g, "-").replace(/\s+/g, " ");
  text = text.replace(/\\frac\s*\{\s*f\s*\(\s*x\s*\)\s*\}\s*\{\s*x\s*([+-])\s*(\d+(?:\.\d+)?)\s*\}/i, "f(x)/(x $1 $2)");
  if (!/\bf\b[^.?!]{0,160}\bquadratic\b/i.test(text) && !/\bquadratic\b[^.?!]{0,160}\bf\b/i.test(text)) return null;
  const denominator = text.match(/\bg\s*\(\s*x\s*\)\s*=\s*f\s*\(\s*x\s*\)\s*\/\s*\(\s*x\s*([+-])\s*(\d+(?:\.\d+)?)\s*\)/i);
  const intercept = text.match(/y[- ]intercept[^.?!]{0,180}?\bf\b[^.?!]{0,100}?\(\s*0\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/i)
    ?? text.match(/\bf\s*\(\s*0\s*\)\s*=\s*(-?\d+(?:\.\d+)?)/i);
  const target = text.match(/\bwhat\s+is\s+(?:the\s+value\s+of\s+)?g\s*\(\s*(-?\d+(?:\.\d+)?)\s*\)/i);
  if (!denominator || !intercept || !target) return null;
  const signedShift = Number(denominator[2]) * (denominator[1] === "-" ? -1 : 1);
  return { shift: signedShift, intercept: Number(intercept[1]), target: Number(target[1]) };
}

/**
 * The model can confuse a stated intercept of f with a table value of g.
 * When the question and candidate rows expose this exact structure, rebuild
 * the regression from the actual g-pairs and keep the intercept as f(0).
 */
export function repairQuadraticRationalIntercept(response: CandidatesResponse): CandidatesResponse {
  if (response.status !== "solved") return response;
  const problem = parseProblem(response.question);
  if (!problem) return response;

  const conflicts = findTranscriptionConflicts(response.question);
  if (conflicts.length) {
    throw new StrategySelectionError(
      `The transcription gives two different values for ${conflicts.map(({ name, input, values }) => `${name}(${input}) (${values.join(" and ")})`).join(", ")}. Transcribe each table cell once, exactly as printed under its header, and never add values you computed to the question text.`,
      "transcription_conflict",
    );
  }
  const points = questionPoints(response.question);
  if (points.length < 2) {
    throw new StrategySelectionError(
      "The table's paired x and g(x) values were not transcribed. Include every table row in question, then provide a Desmos regression method.",
      "semantic_inputs",
    );
  }
  let pair: [Pair, Pair] | null = null;
  for (let left = 0; left < points.length && !pair; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      const determinant = points[left].x ** 2 * points[right].x - points[right].x ** 2 * points[left].x;
      if (Math.abs(determinant) >= 1e-12) {
        pair = [points[left], points[right]];
        break;
      }
    }
  }
  if (!pair) throw new StrategySelectionError("The table does not provide two independent inputs for the quadratic fit.", "semantic_inputs");
  const [p1, p2] = pair;
  const determinant = p1.x ** 2 * p2.x - p2.x ** 2 * p1.x;

  const u1 = p1.y * (p1.x + problem.shift) - problem.intercept;
  const u2 = p2.y * (p2.x + problem.shift) - problem.intercept;
  const a = (u1 * p2.x - u2 * p1.x) / determinant;
  const b = (p1.x ** 2 * u2 - p2.x ** 2 * u1) / determinant;
  if (points.some(({ x, y }) => !Number.isFinite((a * x ** 2 + b * x + problem.intercept) / (x + problem.shift)) || Math.abs((a * x ** 2 + b * x + problem.intercept) / (x + problem.shift) - y) > 1e-7)) {
    throw new StrategySelectionError("The transcribed table values disagree with the stated quadratic rational function; recheck the image and table rows.", "semantic_inputs");
  }
  const resultValue = (a * problem.target ** 2 + b * problem.target + problem.intercept) / (problem.target + problem.shift);
  if (!Number.isFinite(resultValue)) {
    throw new StrategySelectionError("The requested input makes g undefined; recheck the denominator and requested value.", "semantic_inputs");
  }
  const interceptTerm = problem.intercept < 0 ? `${problem.intercept}` : `+${problem.intercept}`;
  const denominator = (x: number | string) => problem.shift < 0 ? `${x}${problem.shift}` : `${x}+${problem.shift}`;

  const candidate: Candidate = {
    techniqueId: "parameter-regression",
    strategy: null,
    rung: 4,
    rows: [
      { latex: `f(x)=a x^{2}+b x${interceptTerm}`, slider: null, copiesRow: null },
      { latex: `x_{1}=[${p1.x},${p2.x}]`, slider: null, copiesRow: null },
      { latex: `y_{1}=[${p1.y},${p2.y}]`, slider: null, copiesRow: null },
      {
        latex: `y_{1}\\sim\\frac{f(x_{1})}{${denominator("x_{1}")}}`,
        slider: null,
        copiesRow: null,
      },
      { latex: `g(x)=\\frac{f(x)}{${denominator("x")}}`, slider: null, copiesRow: null },
      {
        latex: `g(${problem.target})`,
        slider: null,
        copiesRow: null,
      },
    ],
    answer: resultValue.toPrecision(12).replace(/\.?0+$/, ""),
    result: {
      type: "numeric",
      row: 6,
      value: resultValue,
      listIndex: null,
      answerFrom: "value",
      choiceLabel: null,
      detail: `g(${problem.target}) from the fitted quadratic`,
      relatedRows: [],
    },
    answerState: null,
    parameters: [],
    conditionType: null,
    distinguishes: null,
    graphBounds: null,
    cost: { derivationSteps: 0, newPrimitives: 0, oneOffFacts: 0, setupConstructions: 0, manualIterations: 0 },
  };

  const alternatives = response.candidates
    .filter((other) => {
      if (other.techniqueId === candidate.techniqueId) return false;
      const answer = parseNumber(other.answer);
      return answer !== null && Math.abs(answer - resultValue) <= 1e-8 * Math.max(1, Math.abs(resultValue));
    })
    .map((other) => other.rows.length === 0
      ? { ...other, cost: { ...other.cost, derivationSteps: Math.max(4, other.cost.derivationSteps) } }
      : other);
  if (alternatives.every((other) => other.rows.length > 0) && !alternatives.some((other) => other.techniqueId === "substitution")) {
    alternatives.push({
      techniqueId: "substitution",
      strategy: null,
      rung: 2,
      rows: [],
      answer: candidate.answer,
      result: {
        type: "written", row: null, relatedRows: [], value: null, listIndex: null,
        answerFrom: "reasoning", choiceLabel: null,
        detail: `the value after solving for the quadratic and evaluating g(${problem.target})`,
      },
      answerState: null,
      parameters: [],
      conditionType: null,
      distinguishes: null,
      graphBounds: null,
      cost: { derivationSteps: 4, newPrimitives: 0, oneOffFacts: 0, setupConstructions: 0, manualIterations: 0 },
    });
  }
  alternatives.sort((left, right) => Number(left.rows.length > 0) - Number(right.rows.length > 0));
  // The transcription is never rewritten: the table came from it, unchanged.
  return { ...response, candidates: [candidate, ...alternatives].slice(0, 6), preferredTechniqueId: candidate.techniqueId };
}

type FactorExtremum = { leading: number; constant: number; exponent: number; kind: "max" | "min" };

/** Only recognize the complete two-binomial pattern; other factoring questions
 * should keep their model candidates rather than receive a guessed formula. */
function parseIntegerFactorExtremum(question: string): FactorExtremum | null {
  if (!isIntegerFactorExtremumQuestion(question)) return null;
  const superscripts = "⁰¹²³⁴⁵⁶⁷⁸⁹";
  const compact = question
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (digits) => `^${[...digits].map((digit) => superscripts.indexOf(digit)).join("")}`)
    .replace(/\^\{(\d+)\}|\^\((\d+)\)/g, (_all, braces: string | undefined, parens: string | undefined) => `^${braces ?? parens}`)
    .replace(/\\(?:left|right|cdot)/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
  const polynomial = compact.match(/(\d+)x\^(\d+)\+kx\^(\d+)\+(\d+)/);
  if (!polynomial) return null;
  const [, leadingText, highPowerText, exponentText, constantText] = polynomial;
  const [leading, highPower, exponent, constant] = [leadingText, highPowerText, exponentText, constantText].map(Number);
  if (!Number.isSafeInteger(leading) || !Number.isSafeInteger(constant) ||
      leading < 1 || constant < 1 || leading > 10000 || constant > 10000 ||
      !Number.isInteger(exponent) || exponent < 1 || highPower !== 2 * exponent ||
      !compact.includes(`ax^${exponent}+b`) || !compact.includes(`cx^${exponent}+d`)) return null;
  const kind = /\b(?:minimum|least)\b/i.test(question) ? "min" : "max";
  return { leading, constant, exponent, kind };
}

function signedDivisors(value: number): number[] {
  const result: number[] = [];
  for (let divisor = 1; divisor <= value; divisor += 1) {
    if (value % divisor === 0) result.push(-divisor, divisor);
  }
  return result;
}

/** Independent answer check for Desmos-retry candidates, whose rows may use
 * a different method after the canonical list method failed in the browser. */
export function expectedIntegerFactorExtremumAnswer(question: string): number | null {
  const problem = parseIntegerFactorExtremum(question);
  if (!problem) return null;
  const { leading, constant, kind } = problem;
  const constantDivisors = signedDivisors(constant);
  const coefficients = signedDivisors(leading).flatMap((a) =>
    constantDivisors.map((b) => (a + b) * (leading / a + constant / b) - leading - constant),
  );
  const answer = kind === "max" ? Math.max(...coefficients) : Math.min(...coefficients);
  return Number.isSafeInteger(answer) ? answer : null;
}

/**
 * An identity regression can return any exact factorization, even when the
 * question asks for the greatest/least middle coefficient. Enumerate every
 * signed integer divisor pair instead. Evaluating both sides at x^n=1 gives
 * k=(a+b)(c+d)-leading-constant; Desmos performs the enumeration and max/min.
 */
export function repairIntegerFactorExtremum(response: CandidatesResponse): CandidatesResponse {
  if (response.status !== "solved") return response;
  const problem = parseIntegerFactorExtremum(response.question);
  if (!problem) return response;
  const { leading, constant, kind } = problem;
  const answer = expectedIntegerFactorExtremumAnswer(response.question);
  if (answer === null) return response;

  const candidate: Candidate = {
    techniqueId: "integer-list-filter",
    strategy: null,
    rung: 4,
    rows: [
      { latex: `a_{1}=\\operatorname{join}([-${leading}...-1],[1...${leading}])`, slider: null, copiesRow: null },
      { latex: `b_{1}=\\operatorname{join}([-${constant}...-1],[1...${constant}])`, slider: null, copiesRow: null },
      { latex: `a_{2}=a_{1}[\\operatorname{mod}(${leading},a_{1})=0]`, slider: null, copiesRow: null },
      { latex: `b_{2}=b_{1}[\\operatorname{mod}(${constant},b_{1})=0]`, slider: null, copiesRow: null },
      {
        latex: `k_{1}=\\left((p+q)\\left(\\frac{${leading}}{p}+\\frac{${constant}}{q}\\right)-${leading}-${constant}\\right)\\operatorname{for}p=a_{2},q=b_{2}`,
        slider: null,
        copiesRow: null,
      },
      { latex: `\\operatorname{${kind}}(k_{1})`, slider: null, copiesRow: null },
    ],
    answer: String(answer),
    result: {
      type: "numeric", row: 6, relatedRows: [], value: answer, listIndex: null,
      answerFrom: "value", choiceLabel: null,
      detail: `the ${kind === "max" ? "greatest" : "least"} coefficient from every integer factor pair`,
    },
    answerState: null,
    parameters: [],
    conditionType: null,
    distinguishes: null,
    graphBounds: null,
    cost: { derivationSteps: 1, newPrimitives: 0, oneOffFacts: 0, setupConstructions: 0, manualIterations: 0 },
  };
  return {
    ...response,
    structure: `Two integer binomial factors of a quadratic in x^${problem.exponent}; compare every integer factorization.`,
    candidates: [candidate],
    preferredTechniqueId: candidate.techniqueId,
  };
}
