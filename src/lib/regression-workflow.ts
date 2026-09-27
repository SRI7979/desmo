import type { DesmosExpression } from "./solver-schema";

/**
 * Small systems should keep each equation intact in a bracket regression.
 * Recognize disposable numeric coefficient lists, not data tables, sampled
 * identities, answer-choice lists, or lists reused by the rest of a solution.
 * Reject rather than rewriting rows: the retry must supply matching purposes
 * and result references for its new canonical plan.
 */
export function hasUnnecessaryCoefficientLists(
  expressions: DesmosExpression[],
  question: string,
): boolean {
  if ((question.match(/=/g) ?? []).length < 2) return false;
  const rows = expressions.map(({ latex }) => latex.replace(/\\(?:left|right)/g, "").replace(/\s+/g, ""));
  const fits = rows.map((row, index) => /~|\\sim/.test(row) ? index : -1).filter(index => index >= 0);
  if (fits.length !== 1) return false;
  const fit = fits[0];
  const definitions: { name: string; length: number }[] = [];
  for (let index = 0; index < rows.length; index++) {
    const match = rows[index].match(/^([a-zA-Z](?:_\{[a-zA-Z0-9]+\})?)=\[([^\[\]]+)\]$/);
    if (!match || /^[xy](?:_|$)/i.test(match[1])) continue;
    const values = match[2].split(",");
    if (values.length < 2 || values.length > 3 || values.some(value => !/^[+-]?\d+(?:\.\d+)?$/.test(value))) continue;
    const escaped = match[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const reference = new RegExp(`${escaped}(?![0-9_])`, "g");
    const references = rows.flatMap((row, other) => other === index ? [] : Array.from(row.matchAll(reference), () => other));
    if (references.length === 1 && references[0] === fit) definitions.push({ name: match[1], length: values.length });
  }
  return definitions.some(definition => definitions.filter(other => other.length === definition.length).length >= 2);
}
