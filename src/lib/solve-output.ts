import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

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
    if (result.type === "written") set(result, "row", null);
    const rowCount = Array.isArray(item.rows) ? item.rows.length : 0;
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
