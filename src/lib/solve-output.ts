import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { compactStrategyPortfolioSchema, selectCompactStrategy, StrategySelectionError } from "./strategy-selection";
import type { SolveMode } from "./solver-schema";
import { extractNumbers, numbersMatch, parseNumber } from "./answer-consistency";

export class SolveValidationError extends Error {
  constructor(readonly stage: string, message: string, readonly issues?: unknown) { super(message); }
}
type ModelResponse = { status?: string; incomplete_details?: unknown; output?: { type: string; content?: { type: string; text?: string }[] }[] };
export function modelOutputText(response: unknown): string {
  return (response as ModelResponse).output?.flatMap(item => item.type === "message" ? (item.content ?? []).flatMap(part => part.type === "output_text" ? [part.text ?? ""] : []) : []).join("") ?? "";
}

/** Only metadata that already follows from the returned plan is repaired. */
function repairMetadata(input: unknown): { value: unknown; repairs: string[] } {
  const repairs: string[] = [];
  if (!input || typeof input !== "object") return {value:input,repairs};
  const value = structuredClone(input) as Record<string, unknown>;
  const solution = value.solution as Record<string, unknown> | null;
  if (!solution || typeof solution !== "object" || value.status !== "solved") return {value,repairs};
  const set = (object: Record<string,unknown>, key:string, content:unknown) => {
    if (object[key] === undefined) { object[key]=content; repairs.push(`Missing ${key} was derived from the solution metadata.`); }
  };
  if (Array.isArray(solution.expressions) && solution.expressions.length) set(solution,"steps",[]);
  set(solution,"graphBounds",null);
  set(solution,"readAnswer",null);
  if (!solution.result && typeof solution.readAnswer === "string" && Array.isArray(solution.expressions)) {
    const references=[...solution.readAnswer.matchAll(/\b(?:line|row)\s+(\d+)\b/gi)].map(match => Number(match[1]));
    const row=references.length === 1 ? references[0] : 0;
    const latex=solution.expressions[row-1]?.latex;
    const answer=typeof solution.answer === "string" ? solution.answer.trim() : "";
    const value=parseNumber(answer);
    // Explicit row, function evaluation, and stated answer recover metadata;
    // never guess a row from its position or invent a missing mathematical step.
    if (typeof latex === "string" && /^[A-Za-z]\(-?\d+(?:\.\d+)?\)$/.test(latex.replace(/\s+/g,"")) && value !== null && extractNumbers(solution.readAnswer).some(number => numbersMatch(number,value))) {
      solution.result={type:"numeric",row,relatedRows:[],value,listIndex:null,answerFrom:"value",choiceLabel:null,detail:latex};
      repairs.push("Missing result metadata was recovered from the explicit function-evaluation row and read instruction.");
    }
  }
  const result=solution.result as Record<string,unknown> | null;
  if (result && typeof result === "object") {
    for (const key of ["value","listIndex","choiceLabel"]) set(result,key,null);
    if (typeof result.type === "string") set(result,"relatedRows",[]);
    if (result.type === "written") set(result,"row",null);
    if (typeof result.row === "number" && result.row >= 1 && Array.isArray(solution.expressions) && result.row <= solution.expressions.length) set(result,"detail",`the output on line ${result.row}`);
    if ((!solution.answer || !String(solution.answer).trim()) && result.answerFrom === "value" && typeof result.value === "number" && Number.isFinite(result.value)) {
      solution.answer=String(result.value); repairs.push("Missing numeric answer was derived from result.value.");
    }
  }
  return {value,repairs};
}

export function validateModelResponse(response: unknown, mode: SolveMode) {
  const raw=response as ModelResponse;
  if (raw.status !== "completed") throw new SolveValidationError("model_output",`Response status ${raw.status}; incomplete_details=${JSON.stringify(raw.incomplete_details ?? null)}`);
  let input: unknown;
  try { input=JSON.parse(modelOutputText(raw)); }
  catch(error) { throw new SolveValidationError("json",error instanceof Error ? error.message : "Invalid JSON"); }
  const repaired=repairMetadata(input);
  const parsed=compactStrategyPortfolioSchema.safeParse(repaired.value);
  if (!parsed.success) throw new SolveValidationError("zod",parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; "),parsed.error.issues);
  try {
    const result=selectCompactStrategy(parsed.data,{mode});
    if (result.strategySelection) result.strategySelection.repairs.push(...repaired.repairs);
    return result;
  } catch(error) {
    if (error instanceof StrategySelectionError) throw new SolveValidationError(error.stage,error.message);
    throw error;
  }
}

export async function logSolveRejection(id:string, mode:SolveMode, attempt:number, raw:unknown, error:SolveValidationError) {
  if (process.env.NODE_ENV !== "development" && process.env.DESMO_DIAGNOSTICS !== "1") return;
  const rejection={id,mode,attempt,stage:error.stage,message:error.message,issues:error.issues};
  console.error("[desmo:solve]",JSON.stringify(rejection));
  try {
    const directory=path.join(process.cwd(),".desmo-debug");
    await mkdir(directory,{recursive:true});
    // No request headers, credentials, image bytes, or auth session are logged.
    await writeFile(path.join(directory,`${id}-${mode}-${attempt}.json`),JSON.stringify({rejection,response:raw},null,2),{mode:0o600});
  } catch { console.error("[desmo:solve] Could not write local diagnostic file."); }
}
