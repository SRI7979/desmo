"use client";

import Script from "next/script";
import { useEffect, useMemo, useRef, useState } from "react";
import { applyAnswerState, type RowEvaluation } from "@/lib/answer-consistency";
import { normalizeDesmosExpressions } from "@/lib/desmos-latex";
import type { AnswerState } from "@/lib/solver-schema";
import {
  expressionsKey,
  usePublishCalculatorRows,
  type CalculatorRows,
} from "./calculator-verification";
import styles from "./desmos-calculator.module.css";

type Bounds = { left: number; right: number; bottom: number; top: number };

type ExpressionAnalysis = Record<
  string,
  { isError?: boolean; evaluation?: RowEvaluation }
>;

type DesmosInstance = {
  expressionAnalysis: ExpressionAnalysis;
  getExpressions: () => Array<{ id?: string; latex?: string }>;
  observe: (name: string, callback: () => void) => void;
  unobserve: (name: string) => void;
  observeEvent: (name: string, callback: () => void) => void;
  unobserveEvent: (name: string) => void;
  setBlank: () => void;
  setExpressions: (expressions: Array<{
    id: string;
    latex: string;
    color: string;
    sliderBounds?: { min: number; max: number; step: number };
  }>) => void;
  setMathBounds: (bounds: Bounds) => void;
  resize: () => void;
  destroy: () => void;
};

declare global {
  interface Window {
    Desmos?: {
      GraphingCalculator: (
        container: HTMLElement,
        options: {
          autosize: boolean;
          expressions: boolean;
          expressionsCollapsed: boolean;
          settingsMenu: boolean;
          keypad: boolean;
          fontSize: number;
          degreeMode: boolean;
          clearIntoDegreeMode: boolean;
          enableRepeatFunction: boolean;
          forceEnableGeometryFunctions: boolean;
        },
      ) => DesmosInstance;
    };
  }
}

type Props = {
  expressions: Array<{
    latex: string;
    purpose: string;
    slider?: { min: number; max: number; step: number } | null;
  }>;
  bounds: Bounds | null;
  revision: number;
  /** Moves this parameter's slider to this value before the student sees it. */
  answerState?: AnswerState | null;
};

const defaultBounds: Bounds = { left: -10, right: 10, bottom: -10, top: 10 };
const expressionColors = ["#169ed5", "#8a5ce6", "#e78a29", "#229b6b"];

const rowIdPattern = /^desmo_(\d+)$/;

/** The rows this component inserted, as Desmos currently holds them. */
function loadedRows(instance: DesmosInstance): string {
  return instance
    .getExpressions()
    .filter((item) => item.id && rowIdPattern.test(item.id))
    .map((item) => `${item.id}=${item.latex ?? ""}`)
    .join("\n");
}

/** Collects what Desmos computed for the rows this component inserted. */
function collectRows(analysis: ExpressionAnalysis, key: string): CalculatorRows {
  const rows: CalculatorRows["rows"] = {};
  for (const [id, item] of Object.entries(analysis)) {
    const match = id.match(rowIdPattern);
    if (!match) continue;
    const evaluation = item.evaluation;
    rows[Number(match[1])] = {
      isError: Boolean(item.isError),
      evaluation:
        evaluation?.type === "Number" && Number.isFinite(evaluation.value)
          ? { type: "Number", value: evaluation.value }
          : evaluation?.type === "ListOfNumber" && Array.isArray(evaluation.value)
            ? { type: "ListOfNumber", value: [...evaluation.value] }
            : null,
    };
  }
  return { key, rows };
}

function validBounds(bounds: Bounds | null): Bounds {
  return bounds &&
    Object.values(bounds).every(Number.isFinite) &&
    bounds.left < bounds.right &&
    bounds.bottom < bounds.top
    ? bounds
    : defaultBounds;
}

export default function DesmosCalculator({
  expressions,
  bounds,
  revision,
  answerState = null,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const calculatorRef = useRef<DesmosInstance | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expressionError, setExpressionError] = useState(false);
  const [entriesEdited, setEntriesEdited] = useState(false);
  const [replay, setReplay] = useState(0);
  const [lineCount, setLineCount] = useState(0);
  const apiKey = process.env.NEXT_PUBLIC_DESMOS_API_KEY?.trim();
  const publishRows = usePublishCalculatorRows();
  // Defense in depth for an already-open solve or older saved response. The
  // server normalizes new/saved data too, but the calculator never receives
  // visually similar Unicode operators directly.
  const executableExpressions = useMemo(
    () => normalizeDesmosExpressions(expressions),
    [expressions],
  );
  // The live calculator opens with the answer's slider position, not whatever
  // non-answer starting value the row itself was written with; the written
  // explanation panel still shows the model's original row untouched.
  const loadedExpressions = useMemo(
    () => applyAnswerState(executableExpressions, answerState),
    [executableExpressions, answerState],
  );
  // The analysis observer is registered once; it reads the latest batch here.
  // Once the student edits a loaded row, its values no longer describe the
  // explanation, so verification stops until the entries are restored.
  const loaded = useRef<{ key: string; rows: string } | null>(null);

  useEffect(() => {
    if (!apiKey || scriptReady) return;
    const timeout = window.setTimeout(() => {
      setError(
        "Desmos is taking too long to load. Check your connection and reload.",
      );
    }, 20_000);
    return () => window.clearTimeout(timeout);
  }, [apiKey, scriptReady]);

  useEffect(() => {
    if (!scriptReady || !containerRef.current) return;

    let active = true;
    let observer: ResizeObserver | undefined;
    let instance: DesmosInstance | undefined;

    try {
      if (!window.Desmos) throw new Error("Desmos did not initialize");
      instance = window.Desmos.GraphingCalculator(containerRef.current, {
        autosize: false,
        expressions: true,
        expressionsCollapsed: false,
        settingsMenu: true,
        keypad: true,
        fontSize: 15,
        degreeMode: true,
        clearIntoDegreeMode: true,
        enableRepeatFunction: true,
        forceEnableGeometryFunctions: true,
      });
      calculatorRef.current = instance;
      instance.observe("expressionAnalysis", () => {
        if (active && instance) {
          setExpressionError(
            Object.values(instance.expressionAnalysis).some(
              (item) => item.isError,
            ),
          );
          const batch = loaded.current;
          if (batch) setEntriesEdited(loadedRows(instance) !== batch.rows);
          publishRows(
            batch === null || loadedRows(instance) !== batch.rows
              ? null
              : collectRows(instance.expressionAnalysis, batch.key),
          );
        }
      });
      // Editing a valid expression may leave its computed result unchanged, so
      // expressionAnalysis alone does not report every student edit.
      instance.observeEvent("change.desmo", () => {
        if (!active || !instance) return;
        const batch = loaded.current;
        if (!batch) return;
        const changed = loadedRows(instance) !== batch.rows;
        setEntriesEdited(changed);
        if (changed) publishRows(null);
      });
      observer = new ResizeObserver(() => {
        if (active) instance?.resize();
      });
      observer.observe(containerRef.current);
      instance.resize();
    } catch {
      queueMicrotask(() => {
        if (active)
          setError(
            "The calculator could not start. Check your Desmos API key and reload.",
          );
      });
    }

    return () => {
      active = false;
      observer?.disconnect();
      calculatorRef.current = null;
      instance?.unobserve("expressionAnalysis");
      instance?.unobserveEvent("change.desmo");
      instance?.destroy();
      loaded.current = null;
      publishRows(null);
    };
  }, [scriptReady, publishRows]);

  useEffect(() => {
    const calculator = calculatorRef.current;
    if (!scriptReady || !calculator) return;

    let active = true;

    // Load all dependencies together so regressions do not wait on animated rows.
    queueMicrotask(() => {
      if (!active) return;
      try {
        setError(null);
        setExpressionError(false);
        setEntriesEdited(false);
        setLineCount(0);
        loaded.current = null;
        publishRows(null);
        calculator.setBlank();
        calculator.setMathBounds(defaultBounds);
      } catch {
        setError("The calculator could not reset. Reload it and try again.");
        return;
      }

      if (loadedExpressions.length === 0) return;

      try {
        calculator.setExpressions(
          loadedExpressions.map((expression, index) => ({
            id: `desmo_${index + 1}`,
            latex: expression.latex,
            color: expressionColors[index % expressionColors.length],
            ...(expression.slider &&
            expression.slider.min < expression.slider.max &&
            expression.slider.step > 0
              ? { sliderBounds: expression.slider }
              : {}),
          })),
        );
        // Keep the public key tied to the canonical solution. loadedRows still
        // proves that the actual sanitized calculator rows were not edited.
        loaded.current = { key: expressionsKey(expressions), rows: loadedRows(calculator) };
        calculator.setMathBounds(validBounds(bounds));
        setLineCount(loadedExpressions.length);
      } catch {
        loaded.current = null;
        setError("Could not add these lines. Try solving again.");
      }
    });

    return () => {
      active = false;
    };
  }, [scriptReady, expressions, loadedExpressions, bounds, revision, replay, publishRows]);

  const unavailableMessage = !apiKey
    ? "Add NEXT_PUBLIC_DESMOS_API_KEY to .env.local, then restart the dev server to load the calculator."
    : error;
  const status = unavailableMessage
    ? "Calculator unavailable"
    : !scriptReady
      ? "Loading calculator…"
      : expressionError
        ? "Check the flagged line"
        : entriesEdited
          ? "Entries edited"
        : lineCount > 0
          ? `${lineCount} ${lineCount === 1 ? "line" : "lines"} added`
          : "Ready";

  return (
    <div className={styles.shell} data-testid="desmos-calculator">
      {apiKey && (
        <Script
          id="desmo-desmos-api"
          src={`https://www.desmos.com/api/v1.11/calculator.js?apiKey=${encodeURIComponent(apiKey)}`}
          strategy="afterInteractive"
          onReady={() => {
            setError(null);
            setScriptReady(true);
          }}
          onError={() =>
            setError(
              "Desmos could not load. Check your internet connection and API key, then reload.",
            )
          }
        />
      )}
      <div className={styles.calculatorFrame}>
        <div
          ref={containerRef}
          className={styles.calculator}
          aria-label="Interactive Desmos graphing calculator"
        />
        {(!scriptReady || unavailableMessage) && (
          <div className={styles.placeholder}>
            <p>{unavailableMessage || "Loading calculator…"}</p>
            {unavailableMessage && apiKey && (
              <button
                className={styles.reload}
                type="button"
                onClick={() => window.location.reload()}
              >
                Reload calculator
              </button>
            )}
          </div>
        )}
      </div>
      <div className={styles.toolbar}>
        <span
          className={styles.status}
          role="status"
          aria-live="polite"
          data-testid="desmos-status"
        >
          <span
            className={`${styles.statusDot} ${unavailableMessage ? styles.errorDot : entriesEdited ? styles.editedDot : ""}`}
          />
          {status}
        </span>
        <button
          type="button"
          className={styles.replay}
          title="Restore the original loaded equations"
          disabled={
            !scriptReady || !!unavailableMessage || expressions.length === 0
          }
          onClick={() => setReplay((value) => value + 1)}
        >
          <span aria-hidden="true">↻</span> Restore entries
        </button>
      </div>
      {expressionError && !unavailableMessage && (
        <p className={styles.expressionWarning} role="status">
          Check the flagged line in Desmos, or solve again.
        </p>
      )}
    </div>
  );
}
