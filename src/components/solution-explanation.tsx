"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MathExpression from "@/components/math-expression";
import MathText from "@/components/math-text";
import {
  expressionsKey,
  useCalculatorRows,
} from "@/components/calculator-verification";
import { reconcileWithCalculator, type CalculatorCheck } from "@/lib/answer-consistency";
import type { Solution } from "@/lib/solver-schema";
import { splitAnswerLabel } from "@/lib/math-text";
import styles from "./solution-explanation.module.css";

// "unverified" renders nothing; only "contradicted" gets a banner treatment.
const checkStyles: Record<"contradicted", string> = {
  contradicted: styles.checkContradicted,
};

// The current solve and saved history render the same canonical solution.
export default function SolutionExplanation({ solution }: { solution: Solution }) {
  const calculatorRows = useCalculatorRows();
  const [copyStatus, setCopyStatus] = useState<{ row: number; ok: boolean } | null>(null);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyTimeout.current) clearTimeout(copyTimeout.current); }, []);
  async function copyLine(latex: string, row: number) {
    let ok = false;
    try { await navigator.clipboard.writeText(latex); ok = true; } catch { /* The formula remains selectable. */ }
    setCopyStatus({ row, ok });
    if (copyTimeout.current) clearTimeout(copyTimeout.current);
    copyTimeout.current = setTimeout(() => setCopyStatus(null), 2500);
  }
  // Only rows computed for THIS expression batch may confirm or correct it.
  const check = useMemo<CalculatorCheck>(() => {
    if (
      solution.status !== "solved" ||
      solution.expressions.length === 0 ||
      !solution.result ||
      solution.result.row === null ||
      !calculatorRows ||
      calculatorRows.key !== expressionsKey(solution.expressions)
    ) {
      return { status: "unverified" };
    }
    const row = calculatorRows.rows[solution.result.row];
    if (!row || row.isError) return { status: "unverified" };
    return reconcileWithCalculator(solution, row.evaluation);
  }, [solution, calculatorRows]);

  if (solution.status === "needs_clarification") {
    return (
      <div className={styles.clarification} role="status">
        <h3>Check your upload</h3>
        <p><MathText>{solution.clarification || "Upload one complete, readable math question with its answer choices."}</MathText></p>
        {solution.question && (
          <details>
            <summary>What we could read</summary>
            <p><MathText>{solution.question}</MathText></p>
          </details>
        )}
      </div>
    );
  }

  const answer = check.status === "contradicted" ? check.answer : solution.answer;
  const readAnswer = check.status === "contradicted" ? check.readAnswer : solution.readAnswer;
  const formattedAnswer = splitAnswerLabel(answer);

  return (
    <div className={styles.solution}>
      <div className={styles.answerBox} data-testid="answer">
        <div className={styles.answerHeading}>
          <span className={styles.eyebrow}>Answer</span>
          {formattedAnswer.label && <span className={styles.answerChoice}>Choice {formattedAnswer.label}</span>}
          {check.status === "verified" && (
            <span className={styles.verifiedBadge} data-testid="verified-badge" title={check.message}>
              <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true">
                <path d="M3 8.5 6.2 12 13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Verified in Desmos
            </span>
          )}
        </div>
        <div className={styles.answerValue}><MathText>{formattedAnswer.text}</MathText></div>
      </div>
      {check.status === "contradicted" && (
        <p
          className={`${styles.calculatorCheck} ${checkStyles.contradicted}`}
          role="status"
          data-testid="calculator-check"
          data-status={check.status}
        >
          <MathText>{check.message}</MathText>
        </p>
      )}
      {(solution.why || solution.structure) && (
        <section className={styles.structureNote} aria-labelledby="idea-title" data-testid="structure">
          <h3 id="idea-title">The idea</h3>
          <p><MathText>{solution.why || solution.structure || ""}</MathText></p>
        </section>
      )}
      {solution.expressions.length > 0 ? (
        <>
          <div className={styles.sectionHeading}><h3>In Desmos</h3><span>{solution.expressions.length} {solution.expressions.length === 1 ? "line" : "lines"}</span></div>
          <ol className={styles.expressionSteps} aria-label="Desmos line explanations">
            {solution.expressions.map((expression, index) => (
              <li key={index} data-testid="explanation-line">
                <div className={styles.lineHeading}>
                  <span className={styles.lineLabel}><span>{index + 1}</span>Line {index + 1}</span>
                  <button type="button" className={styles.copyButton} onClick={() => copyLine(expression.latex, index)} aria-label={`Copy line ${index + 1}`}>
                    <svg viewBox="0 0 20 20" width="15" height="15" fill="none" aria-hidden="true"><rect x="7" y="7" width="9" height="10" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M11 4V3H5a2 2 0 0 0-2 2v7h1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                    {copyStatus?.row === index ? copyStatus.ok ? "Copied" : "Select to copy" : "Copy"}
                  </button>
                </div>
                <div className={styles.equation} tabIndex={0} aria-label={`Desmos line ${index + 1}`}><MathExpression latex={expression.latex} /></div>
                <p><MathText>{expression.purpose}</MathText></p>
              </li>
            ))}
          </ol>
          <div className={styles.readAnswer}>
            <span className={styles.readIcon} aria-hidden="true">↳</span>
            <div><h3>Read the result</h3><p><MathText>{readAnswer ?? "Read the requested value in the calculator."}</MathText></p></div>
          </div>
        </>
      ) : (
        <>
        <div className={styles.sectionHeading}><h3>Walkthrough</h3><span>{solution.steps.length} {solution.steps.length === 1 ? "step" : "steps"}</span></div>
        <ol className={styles.steps}>
          {solution.steps.map((step, index) => (
            <li key={index}><span className={styles.stepNumber}>{index + 1}</span><p><MathText>{step}</MathText></p></li>
          ))}
        </ol>
        </>
      )}
      {solution.choices && solution.choices.length > 0 && (
        <details className={styles.transcription}>
          <summary>Answer choices</summary>
          <ul className={styles.choiceList}>
            {solution.choices.map((choice) => (
              <li key={choice.label} className={formattedAnswer.label === choice.label ? styles.selectedChoice : undefined}>
                <span className={styles.choiceLabel}>{choice.label}</span><div><MathText>{choice.text}</MathText></div>
              </li>
            ))}
          </ul>
        </details>
      )}
      <details className={styles.transcription}>
        <summary>Question text</summary>
        <p><MathText>{solution.question}</MathText></p>
      </details>
      <span className={styles.srOnly} role="status">{copyStatus ? copyStatus.ok ? `Line ${copyStatus.row + 1} copied.` : "Clipboard is unavailable. Select the equation to copy it." : ""}</span>
    </div>
  );
}
