import type { SolutionResult } from "./solver-schema";

export class ResultContractError extends Error {}

export function validateResultContract(result: SolutionResult, expressionCount: number) {
  if (!("type" in result)) return; // Existing history retains its original contract.
  const rows = [result.row, ...result.relatedRows].filter((row): row is number => row !== null);
  if (rows.some(row => row < 1 || row > expressionCount)) throw new ResultContractError("result.row/relatedRows must reference existing calculator rows.");
  if (new Set(result.relatedRows).size !== result.relatedRows.length) throw new ResultContractError("result.relatedRows must not contain duplicate rows.");
  if (!result.detail.trim()) throw new ResultContractError("result.detail must explain what to read.");
  if (result.type === "written") {
    if (result.row !== null || rows.length || result.value !== null || result.listIndex !== null || result.answerFrom !== "reasoning") throw new ResultContractError("A written result requires null row/value/listIndex, no relatedRows, and answerFrom reasoning.");
    return;
  }
  if (result.row === null) throw new ResultContractError(`${result.type} requires an existing calculator row.`);
  if (result.type === "numeric" || result.type === "list_entry") {
    if (result.value === null || !Number.isFinite(result.value)) throw new ResultContractError(`${result.type} requires a finite value.`);
    if (result.answerFrom === "reasoning") throw new ResultContractError(`${result.type} must identify a numeric value or choice position.`);
    if (result.type === "list_entry" && result.listIndex === null) throw new ResultContractError("list_entry requires listIndex.");
    if (result.type === "numeric" && result.answerFrom !== "value") throw new ResultContractError("A numeric scalar requires answerFrom value; use list_entry for choice positions.");
    if (result.type === "numeric" && result.listIndex !== null) throw new ResultContractError("A numeric scalar result cannot have listIndex; use list_entry.");
  } else {
    if (result.listIndex !== null) throw new ResultContractError("Graphical results cannot have listIndex.");
    if (result.answerFrom === "choice_position") throw new ResultContractError("Graphical results cannot select a choice by list position.");
    if (["intersection", "graph_overlap"].includes(result.type) && new Set(rows).size < 2) throw new ResultContractError(`${result.type} must identify both graph rows.`);
  }
}

export function isNumericResult(result: SolutionResult): boolean {
  return !("type" in result) || result.type === "numeric" || result.type === "list_entry";
}
