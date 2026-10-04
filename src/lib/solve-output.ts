import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseNumber } from "./answer-consistency";
import { explanationSchema, type Explanation } from "./solve-cache";
import { candidatesResponseSchema, type CandidatesResponse } from "./strategy-selection";

export class SolveValidationError extends Error {
  constructor(readonly stage: string, message: string, readonly issues?: unknown) {
    super(message);
  }
}

type ModelResponse = {
  status?: string;
  incomplete_details?: unknown;
  output?: { type: string; content?: { type: string; text?: string }[] }[];
};

export function modelOutputText(response: unknown): string {
  return (
    (response as ModelResponse).output
      ?.flatMap((item) =>
        item.type === "message"
          ? (item.content ?? []).flatMap((part) => (part.type === "output_text" ? [part.text ?? ""] : []))
          : [],
      )
      .join("") ?? ""
  );
}

function parseModelJson(response: unknown): unknown {
  const raw = response as ModelResponse;
  if (raw.status !== "completed") {
    throw new SolveValidationError(
      "model_output",
      `Response status ${raw.status}; incomplete_details=${JSON.stringify(raw.incomplete_details ?? null)}`,
    );
  }
  try {
    return JSON.parse(modelOutputText(raw));
  } catch (error) {
    throw new SolveValidationError("json", error instanceof Error ? error.message : "Invalid JSON");
  }
}

function zodIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`).join("; ");
}

/** A row Desmos draws in the plane: an equation or inequality in x and/or y. */
function isGraphRow(row: unknown): boolean {
  const latex = row && typeof row === "object" ? (row as { latex?: unknown }).latex : null;
  return typeof latex === "string" && /[=<>]|\\le|\\ge/.test(latex) && /(?<![A-Za-z\\])[xy](?![A-Za-z_])/.test(latex) && !/\\sim|~/.test(latex);
}

/** Only metadata that already follows from a candidate's own plan is repaired. */
function repairCandidates(input: unknown): { value: unknown; repairs: string[] } {
  const repairs: string[] = [];
  if (!input || typeof input !== "object") return { value: input, repairs };
  const value = structuredClone(input) as Record<string, unknown>;
  if (value.status !== "solved" || !Array.isArray(value.candidates)) return { value, repairs };
  value.candidates.forEach((candidate: unknown, index: number) => {
    if (!candidate || typeof candidate !== "object") return;
    const item = candidate as Record<string, unknown>;
    const result = item.result as Record<string, unknown> | undefined;
    const set = (object: Record<string, unknown>, key: string, content: unknown) => {
      if (object[key] === undefined) {
        object[key] = content;
        repairs.push(`Candidate ${index + 1}: missing ${key} was derived from its own plan.`);
      }
    };
    if (Array.isArray(item.rows)) {
      for (const row of item.rows) {
        if (row && typeof row === "object") {
          (row as Record<string, unknown>).slider ??= null;
          (row as Record<string, unknown>).copiesRow ??= null;
        }
      }
    }
    set(item, "graphBounds", null);
    if (!result || typeof result !== "object") return;
    for (const key of ["value", "listIndex", "choiceLabel"]) set(result, key, null);
    set(result, "relatedRows", []);
    const rows = Array.isArray(item.rows) ? item.rows.length : 0;
    const statedValue = typeof item.answer === "string" ? parseNumber(item.answer.replace(/^\s*[A-D]\)\s*/i, "")) : null;
    const agreesWithAnswer = (value: unknown) =>
      value === null || (typeof value === "number" && statedValue !== null && Math.abs(statedValue - value) <= 1e-9 * Math.max(1, Math.abs(statedValue)));
    // With no calculator rows nothing is displayed to read, so a paper
    // candidate's readout can only be written; its number is the stated answer.
    if (rows === 0 && (result.type === "numeric" || result.type === "list_entry") && result.row === null &&
        result.listIndex === null && agreesWithAnswer(result.value)) {
      repairs.push(`Candidate ${index + 1}: a ${result.type} readout with no calculator rows was relabeled written.`);
      Object.assign(result, { type: "written", answerFrom: "reasoning", value: null });
    }
    // A written readout names no rows; a calculator plan that reasons over its
    // displayed values keeps them in its rows, not in the readout.
    if (rows > 0 && result.type === "written" && (result.row !== null || (Array.isArray(result.relatedRows) && result.relatedRows.length > 0)) &&
        result.value === null && result.listIndex === null && result.answerFrom === "reasoning") {
      repairs.push(`Candidate ${index + 1}: the rows named by its written readout were dropped from the readout.`);
      Object.assign(result, { row: null, relatedRows: [] });
    }
    // A graphical readout that lists its graphs only in relatedRows: the first is its row.
    const graphicalType = typeof result.type === "string" && !["numeric", "list_entry", "written"].includes(result.type);
    if (graphicalType && result.row === null && Array.isArray(result.relatedRows) && result.relatedRows.length > 0 &&
        result.relatedRows.every((row) => typeof row === "number" && row >= 1 && row <= rows)) {
      const [first, ...rest] = result.relatedRows as number[];
      repairs.push(`Candidate ${index + 1}: the ${result.type} readout's row was missing; line ${first}, the first graph it names, is its row.`);
      Object.assign(result, { row: first, relatedRows: rest });
    }
    if (result.type === "written") set(result, "row", null);
    // A paper result has no calculator readout. Models sometimes duplicate its
    // already-stated numeric answer in `value`; remove only that redundant
    // metadata when it agrees with the answer. A disagreement still fails the
    // result contract instead of silently changing the student's answer.
    if (
      result.type === "written" &&
      Array.isArray(item.rows) && item.rows.length === 0 &&
      result.answerFrom === "reasoning" &&
      result.row === null &&
      Array.isArray(result.relatedRows) && result.relatedRows.length === 0 &&
      (result.listIndex === undefined || result.listIndex === null) &&
      typeof result.value === "number" && Number.isFinite(result.value) &&
      typeof item.answer === "string"
    ) {
      const stated = parseNumber(item.answer.replace(/^\s*[A-D]\)\s*/i, ""));
      if (stated !== null && Math.abs(stated - result.value) <= 1e-9 * Math.max(1, Math.abs(stated))) {
        result.value = null;
        repairs.push(`Candidate ${index + 1}: removed a redundant numeric value from its written result; the stated answer already supplies it.`);
      }
    }
    const rowCount = Array.isArray(item.rows) ? item.rows.length : 0;
    // An answer written "C) 7" names its choice even when the readout's label was left empty.
    const labels = Array.isArray(value.choices)
      ? (value.choices as unknown[]).flatMap((choice) => (choice && typeof choice === "object" && typeof (choice as { label?: unknown }).label === "string" ? [(choice as { label: string }).label.trim().toUpperCase()] : []))
      : [];
    const letter = typeof item.answer === "string" ? /^\s*(?:\(([A-H])\)|([A-H])(?:[).:]|$))/i.exec(item.answer) : null;
    const stated = (letter?.[1] ?? letter?.[2])?.toUpperCase();
    if ((result.choiceLabel === null || result.choiceLabel === undefined) && stated && labels.includes(stated) && result.answerFrom !== "choice_position") {
      result.choiceLabel = stated;
      repairs.push(`Candidate ${index + 1}: the readout's choice label was taken from its answer, ${stated}.`);
    }
    // Readout-type slips whose meaning is unambiguous from the result itself.
    if (result.type === "numeric" && typeof result.listIndex === "number" && typeof result.value === "number" && result.answerFrom !== "reasoning") {
      // A numeric readout that names a list entry is a list entry.
      result.type = "list_entry";
      repairs.push(`Candidate ${index + 1}: a numeric result reading entry ${result.listIndex} of a list was relabeled list_entry.`);
    }
    const graphical = typeof result.type === "string" && !["numeric", "list_entry", "written"].includes(result.type);
    if (graphical && result.answerFrom === "choice_position" && typeof result.choiceLabel === "string" && result.choiceLabel && (result.listIndex === null || result.listIndex === undefined)) {
      // A graph cannot select by list position; the named choice is the reasoning's conclusion.
      result.answerFrom = "reasoning";
      repairs.push(`Candidate ${index + 1}: a graphical result naming choice ${result.choiceLabel} reads it by reasoning, not by list position.`);
    }
    if (
      (result.type === "intersection" || result.type === "graph_overlap") &&
      rowCount === 2 &&
      (item.rows as unknown[]).every((row) => isGraphRow(row)) &&
      typeof result.row === "number" &&
      Array.isArray(result.relatedRows) &&
      result.relatedRows.filter((row) => row !== result.row).length === 0
    ) {
      // With exactly two rows, the other graph is the only one the result can mean.
      result.relatedRows = [result.row === 1 ? 2 : 1];
      repairs.push(`Candidate ${index + 1}: the ${result.type} names its only other row, ${result.row === 1 ? 2 : 1}.`);
    }
    if (typeof result.row === "number" && result.row >= 1 && result.row <= rowCount) {
      set(result, "detail", `the output on line ${result.row}`);
    }
    const answer = typeof item.answer === "string" ? item.answer.trim() : "";
    if (!answer && result.answerFrom === "value" && typeof result.value === "number" && Number.isFinite(result.value)) {
      item.answer = String(result.value);
      repairs.push(`Candidate ${index + 1}: missing numeric answer was derived from result.value.`);
    }
  });
  return { value, repairs };
}

/** Call 1: model_output → json → zod, with the narrow metadata repair above. */
export function validateCandidatesResponse(response: unknown): { parsed: CandidatesResponse; repairs: string[] } {
  const repaired = repairCandidates(parseModelJson(response));
  const parsed = candidatesResponseSchema.safeParse(repaired.value);
  if (!parsed.success) throw new SolveValidationError("zod", zodIssues(parsed.error), parsed.error.issues);
  return { parsed: parsed.data, repairs: repaired.repairs };
}

/** Call 2: the explanation for one already-selected method. */
export function validateExplanationResponse(response: unknown): Explanation {
  const parsed = explanationSchema.safeParse(parseModelJson(response));
  if (!parsed.success) throw new SolveValidationError("zod", zodIssues(parsed.error), parsed.error.issues);
  return parsed.data;
}

function diagnosticsEnabled(): boolean {
  return process.env.NODE_ENV === "development" || process.env.DESMO_DIAGNOSTICS === "1";
}

export async function logSolveRejection(id: string, attempt: number, raw: unknown, error: SolveValidationError) {
  if (!diagnosticsEnabled()) return;
  const rejection = { id, attempt, stage: error.stage, message: error.message, issues: error.issues };
  console.error("[desmo:solve]", JSON.stringify(rejection));
  try {
    const directory = path.join(process.cwd(), ".desmo-debug");
    await mkdir(directory, { recursive: true });
    // No request headers, credentials, image bytes, or auth session are logged.
    await writeFile(path.join(directory, `${id}-${attempt}.json`), JSON.stringify({ rejection, response: raw }, null, 2), {
      mode: 0o600,
    });
  } catch {
    console.error("[desmo:solve] Could not write local diagnostic file.");
  }
}

/** The server's argmin always wins; a differing model preference is only logged. */
export function logSelectionDisagreement(id: string, preferred: string, winner: string) {
  if (!diagnosticsEnabled()) return;
  console.info("[desmo:selection]", JSON.stringify({ id, modelPreferred: preferred, serverSelected: winner }));
}
