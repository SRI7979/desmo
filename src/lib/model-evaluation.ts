// A deliberately small arithmetic parser. It proves a readout is the fitted
// expression with a supplied input substituted; it never evaluates user code
// or accepts equality from a few numerical samples.
type Node = number | string | { op: string; left: Node; right: Node };
function operation(op: string, left: Node, right: Node): Node {
  if (typeof left === "number" && typeof right === "number") {
    const value = op === "+" ? left + right : op === "-" ? left - right : op === "*" ? left * right : op === "/" ? left / right : left ** right;
    if (Number.isFinite(value)) return value;
  }
  return { op, left, right };
}
function parse(source: string, replace?: {name: string; value: number}): Node | null {
  const tokens = source.replace(/\\(?:left|right)/g, "").replace(/\\(?:cdot|times)/g, "*").replace(/\s+/g, "").match(/\\frac|[A-Za-z](?:_\{[^{}]+\})?|\d+(?:\.\d+)?|./g) ?? [];
  let i = 0;
  const primary = (depth: number): Node => {
    if (depth > 40) throw new Error("depth");
    const token = tokens[i++];
    if (token === "-" || token === "+") return operation(token, 0, expression(25, depth + 1));
    if (token === "\\frac") return operation("/", primary(depth + 1), primary(depth + 1));
    if (token === "(" || token === "{") {
      const value = expression(0, depth + 1);
      if (tokens[i++] !== (token === "(" ? ")" : "}")) throw new Error("group");
      return value;
    }
    if (/^\d/.test(token ?? "")) return Number(token);
    if (/^[A-Za-z](?:_\{[^{}]+\})?$/.test(token ?? "")) return replace?.name === token ? replace.value : token;
    throw new Error("unsupported");
  };
  const expression = (min: number, depth: number): Node => {
    let left = primary(depth);
    while (i < tokens.length) {
      const token = tokens[i];
      const implicit = /^[A-Za-z\d({]/.test(token) || token === "\\frac";
      const op = implicit ? "*" : token;
      const priority = ({"+":10,"-":10,"*":20,"/":20,"^":30} as Record<string,number>)[op];
      if (priority === undefined || priority < min) break;
      if (!implicit) i++;
      left = operation(op, left, expression(priority + (op === "^" ? 0 : 1), depth + 1));
    }
    return left;
  };
  try { const value = expression(0,0); return i === tokens.length ? value : null; } catch { return null; }
}

export function isRequestedModelEvaluation(latex: string, expressions: ReadonlyArray<{latex:string}>, question: string): boolean {
  const alias = latex.match(/^\s*([A-Za-z])_\{(-?\d+(?:\.\d+)?)\}\s*=([\s\S]+)$/);
  if (!alias) return false;
  const argument = Number(alias[2]);
  const request = new RegExp(`\\b${alias[1]}\\s*\\(\\s*${alias[2].replace(".","\\.")}\\s*\\)`);
  if (!request.test(question)) return false;
  const readout = parse(alias[3]);
  if (readout === null) return false;
  const inputs = expressions.flatMap(({latex}) => {
    const match = latex.match(/^\s*([xy](?:_\{\d+\})?)\s*=\s*(?:\\left)?\[/);
    return match ? [match[1]] : [];
  });
  return expressions.some(({latex}) => {
    const sides = latex.split(/\\sim|~/);
    return sides.length === 2 && inputs.some(name => sides.some(side => {
      if (!side.includes(name)) return false;
      const model = parse(side, {name, value:argument});
      return model !== null && JSON.stringify(model) === JSON.stringify(readout);
    }));
  });
}
