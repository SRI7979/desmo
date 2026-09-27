/** Presentation only: never changes the expressions sent to the calculator. */
export type MathTextPart = { type: "text" | "math"; value: string };
type Token = { value: string; start: number; end: number };
type Formula = { tex: string; math: boolean; inner?: Formula; grouped?: boolean };

const products = new Set(["ab", "ac", "ad", "ax", "ay", "bc", "bx", "by", "cx", "cy", "dx", "dy", "kx", "ky", "kb", "mx", "my", "mn", "nx", "ny", "px", "py", "rx", "ry", "sx", "sy", "xy", "xz", "yz", "xyz"]);
const functions = new Set(["sqrt", "sin", "cos", "tan", "log", "ln", "abs", "min", "max", "mean", "median", "count", "floor", "ceil", "round"]);
const operators: Record<string, { priority: number; tex: string }> = {
  "→": { priority: 1, tex: "\\Rightarrow" },
  "=": { priority: 2, tex: "=" }, "<": { priority: 2, tex: "<" }, ">": { priority: 2, tex: ">" },
  "<=": { priority: 2, tex: "\\le" }, "≤": { priority: 2, tex: "\\le" },
  ">=": { priority: 2, tex: "\\ge" }, "≥": { priority: 2, tex: "\\ge" },
  "!=": { priority: 2, tex: "\\ne" }, "≠": { priority: 2, tex: "\\ne" },
  "~": { priority: 2, tex: "\\sim" }, "≈": { priority: 2, tex: "\\approx" },
  "+": { priority: 10, tex: "+" }, "-": { priority: 10, tex: "-" }, "−": { priority: 10, tex: "-" },
  "*": { priority: 20, tex: "\\cdot" }, "×": { priority: 20, tex: "\\times" },
  "/": { priority: 20, tex: "/" }, "÷": { priority: 20, tex: "/" },
  "^": { priority: 30, tex: "^" }, "_": { priority: 30, tex: "_" },
};
const tokenPattern = /\d+(?:\.\d+)?|\\[a-zA-Z]+|[a-zA-Z]+|<=|>=|!=|[^\s]/g;
const isVariable = (value: string) => /^[a-zA-Z]$/.test(value) || products.has(value) || /^[πθ]$/.test(value);

class FormulaParser {
  position: number;
  constructor(private tokens: Token[], start: number) { this.position = start; }

  private primary(depth: number): Formula | null {
    if (depth > 24) return null;
    const token = this.tokens[this.position];
    if (!token) return null;
    const v = token.value;
    if (["+", "-", "−"].includes(v)) {
      this.position++;
      const value = this.expression(25, depth + 1);
      return value ? { tex: `${v === "−" ? "-" : v}${value.tex}`, math: true } : null;
    }
    if (v === "(" || v === "[" || v === "{") {
      this.position++;
      const close = { "(": ")", "[": "]", "{": "}" }[v];
      const first = this.expression(0, depth + 1);
      if (!first) return null;
      const values = [first];
      while (this.tokens[this.position]?.value === ",") {
        this.position++;
        const next = this.expression(0, depth + 1);
        if (!next) return null;
        values.push(next);
      }
      if (this.tokens[this.position]?.value !== close) return null;
      this.position++;
      return { tex: `\\left${v === "{" ? "\\{" : v}${values.map(x => x.tex).join(",\\,")}\\right${close === "}" ? "\\}" : close}`, math: values.length > 1 || first.math, inner: values.length === 1 ? first : undefined, grouped: true };
    }
    const name = v.replace(/^\\/, "");
    if (name === "frac") {
      this.position++;
      if (this.tokens[this.position]?.value !== "{") return null;
      const numerator = this.primary(depth + 1);
      if (this.tokens[this.position]?.value !== "{") return null;
      const denominator = this.primary(depth + 1);
      return numerator && denominator ? { tex: `\\frac{${(numerator.inner ?? numerator).tex}}{${(denominator.inner ?? denominator).tex}}`, math: true } : null;
    }
    // "mean", "count", "min", "max", etc. are also ordinary English words;
    // only treat one as a function call when it is actually invoked as one
    // ("mean(L)"), never when it merely precedes some other primary ("the two
    // zeros mean f(x) = ..." must not swallow "f" as mean's argument).
    if (functions.has(name) && this.tokens[this.position + 1]?.value === "(") {
      this.position++;
      const argument = this.primary(depth + 1);
      if (!argument) return null;
      const inner = (argument.inner ?? argument).tex;
      return { tex: name === "sqrt" ? `\\sqrt{${inner}}` : `\\operatorname{${name}}${argument.grouped ? argument.tex : `\\left(${inner}\\right)`}`, math: true };
    }
    if (/^\d/.test(v) || isVariable(v)) {
      this.position++;
      let tex = v === "π" ? "\\pi" : v === "θ" ? "\\theta" : v;
      // "by" and "my" are ordinary words outside an algebraic expression.
      let math = /^\d/.test(v) || (products.has(v) && !["by", "my"].includes(v));
      const next = this.tokens[this.position]?.value;
      if (next === "%" || next === "°") {
        tex += next === "%" ? "\\%" : "^{\\circ}";
        math = true;
        this.position++;
      }
      if (next === "²" || next === "³") {
        tex += next === "²" ? "^{2}" : "^{3}";
        math = true;
        this.position++;
      }
      // Consecutive primes are ONE superscript with a repeated \prime, e.g.
      // f'' -> f^{\prime\prime}; stacking ^{\prime}^{\prime} is invalid TeX.
      let primes = 0;
      while (["'", "′"].includes(this.tokens[this.position]?.value)) {
        primes++;
        this.position++;
      }
      if (primes > 0) {
        tex += `^{${"\\prime".repeat(primes)}}`;
        math = true;
      }
      let subscript = "";
      while (/^[₀-₉]$/.test(this.tokens[this.position]?.value ?? "")) {
        subscript += "₀₁₂₃₄₅₆₇₈₉".indexOf(this.tokens[this.position++].value);
      }
      if (subscript) { tex += `_{${subscript}}`; math = true; }
      return { tex, math };
    }
    return null;
  }

  expression(minimum = 0, depth = 0): Formula | null {
    let left = this.primary(depth);
    if (!left) return null;
    while (this.position < this.tokens.length) {
      const start = this.position;
      const next = this.tokens[start];
      const operator = operators[next.value];
      const prior = this.tokens[start - 1];
      // Permit spaces inside algebra, but don't turn English "a 3-inch..."
      // or a choice label followed by a number into implicit multiplication.
      const spacedProduct: boolean = (left.math || /^[bfgkmnpqrstuvwxyz]$/.test(prior.value)) &&
        (/^[bfgkmnpqrstuvwxyz]$/.test(next.value) || next.value === "(" || next.value === "[");
      const implicit: boolean = !operator && (prior.end === next.start || spacedProduct) &&
        (isVariable(next.value) || /^\d/.test(next.value) || next.value === "(" || next.value === "[");
      const priority = implicit ? 20 : operator?.priority;
      if (priority === undefined || priority < minimum) break;
      if (!implicit) this.position++;
      const right = this.expression(priority + (next.value === "^" ? 0 : 1), depth + 1);
      if (!right) { this.position = start; break; }
      if (!implicit && operator.tex === "/") {
        left = { tex: `\\frac{${(left.inner ?? left).tex}}{${(right.inner ?? right).tex}}`, math: true };
      } else if (!implicit && ["^", "_"].includes(next.value)) {
        left = { tex: `${left.tex}${next.value}{${(right.inner ?? right).tex}}`, math: true };
      } else {
        left = { tex: `${left.tex}${implicit ? " " : ` ${operator.tex} `}${right.tex}`, math: true };
      }
    }
    return left;
  }
}

function splitPlainText(text: string): MathTextPart[] {
  const tokens: Token[] = Array.from(text.matchAll(tokenPattern), match => ({ value: match[0], start: match.index!, end: match.index! + match[0].length }));
  const parts: MathTextPart[] = [];
  let written = 0;
  for (let index = 0; index < tokens.length;) {
    // A possessive ending is prose, not the variable s ("the choice's x-value").
    if (/^s$/i.test(tokens[index].value) && /[a-zA-Z]['’]$/.test(text.slice(Math.max(0, tokens[index].start - 2), tokens[index].start))) {
      index++;
      continue;
    }
    const parser = new FormulaParser(tokens, index);
    const formula = parser.expression();
    if (formula && (formula.math || /^[bfgkmnpqrstuvwxyz]$/.test(tokens[index].value))) {
      const start = tokens[index].start;
      const end = tokens[parser.position - 1].end;
      if (start > written) parts.push({ type: "text", value: text.slice(written, start) });
      parts.push({ type: "math", value: formula.tex });
      written = end;
      index = parser.position;
    } else {
      index++;
    }
  }
  if (written < text.length) parts.push({ type: "text", value: text.slice(written) });
  return parts;
}

/** Handle explicit math delimiters and legacy answers saved as plain algebra. */
export function splitMathText(text: string): MathTextPart[] {
  const result: MathTextPart[] = [];
  const delimiters = /\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$(?!\d)/g;
  let written = 0;
  for (const match of text.matchAll(delimiters)) {
    result.push(...splitPlainText(text.slice(written, match.index)));
    result.push({ type: "math", value: match[1] ?? match[2] ?? match[3] ?? match[4] });
    written = match.index! + match[0].length;
  }
  result.push(...splitPlainText(text.slice(written)));
  return result;
}

export function splitAnswerLabel(answer: string): { label: string | null; text: string } {
  const prefix = answer.match(/^\s*(?:choice\s+)?([A-H])\s*[).:]\s*([\s\S]+)$/i);
  if (prefix) return { label: prefix[1].toUpperCase(), text: prefix[2] };
  const suffix = answer.match(/^(.+?)\s*\(choice\s+([A-H])\)\s*$/i);
  if (suffix) return { label: suffix[2].toUpperCase(), text: suffix[1] };
  return { label: null, text: answer };
}
