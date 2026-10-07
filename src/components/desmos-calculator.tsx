"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "./theme-provider";
import type { RowEvaluation } from "@/lib/answer-consistency";
import { displayColor, MATH_OPTIONS, type DesmosCalculatorInstance } from "@/lib/desmos-engine";
import { ROW_ID_PREFIX, verdictFromAnalysis, type DesmosAnalysis } from "@/lib/desmos-preflight";
import type { AnswerState } from "@/lib/solver-schema";
import {
  expressionsKey,
  usePublishCalculatorRows,
  useCalculatorTrace,
  type CalculatorRows,
} from "./calculator-verification";
import { recordVisibleError, usePreflightGate } from "./preflight-gate";
import styles from "./desmos-calculator.module.css";

type Bounds = { left: number; right: number; bottom: number; top: number };

type DesmosInstance = DesmosCalculatorInstance & { selectedExpressionId?: string };

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

const rowIdPattern = new RegExp(`^${ROW_ID_PREFIX}(\\d+)$`);

/** The rows this component inserted, as Desmos currently holds them. */
function loadedRows(instance: DesmosInstance): string {
  return instance
    .getExpressions()
    .filter((item) => item.id && rowIdPattern.test(item.id))
    .map((item) => `${item.id}=${item.latex ?? ""}`)
    .join("\n");
}

/** Collects what Desmos computed for the rows this component inserted. */
function collectRows(analysis: DesmosAnalysis, key: string): CalculatorRows {
  const rows: CalculatorRows["rows"] = {};
  for (const [id, item] of Object.entries(analysis)) {
    const match = id.match(rowIdPattern);
    if (!match || !item) continue;
    const evaluation = item.evaluation as RowEvaluation | undefined;
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

const isDark = () => document.documentElement.dataset.theme === "dark";

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
  const [expanded, setExpanded] = useState(false);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const { resolvedTheme } = useTheme();
  // Rows this component pulled after the visible calculator flagged them.
  const [blockedKey, setBlockedKey] = useState<string | null>(null);
  const apiKey = process.env.NEXT_PUBLIC_DESMOS_API_KEY?.trim();
  const publishRows = usePublishCalculatorRows();
  const { selection, select, traceId } = useCalculatorTrace();
  // The batch is built exactly as the hidden pre-flight instance received it
  // (normalized LaTeX, the slider at the answer state), and it is inserted
  // only once that instance reported every row clean. Nothing that errors in
  // Desmos is ever shown; an older saved method that no longer runs is
  // hidden with an explanation instead.
  const { payload, gate } = usePreflightGate(expressions, answerState);
  const blocked = blockedKey === payload.key;
  const insertable = gate.status === "clean" && !blocked;
  // The analysis observer is registered once; it reads the latest batch here.
  // Once the student edits a loaded row, its values no longer describe the
  // explanation, so verification stops until the entries are restored.
  const loaded = useRef<{ key: string; rows: string; payloadKey: string; ids: string[]; colors: string[] } | null>(null);

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
        ...MATH_OPTIONS,
        autosize: false,
        expressions: true,
        expressionsCollapsed: false,
        settingsMenu: true,
        keypad: true,
        fontSize: 17,
        invertedColors: isDark(),
      });
      calculatorRef.current = instance;
      instance.observe("selectedExpressionId.trace", () => {
        const batch = loaded.current;
        // Keep the last traced row when focus moves into its explanation.
        // A different/user-created row still clears the link below.
        if (!instance?.selectedExpressionId) return;
        const match = instance?.selectedExpressionId?.match(rowIdPattern);
        select(batch && instance && loadedRows(instance) === batch.rows && match
          ? { key: batch.key, row: Number(match[1]) }
          : null);
      });
      let tripwire: ReturnType<typeof setTimeout> | undefined;
      instance.observe("expressionAnalysis", () => {
        if (!active || !instance) return;
        const analysis = instance.expressionAnalysis;
        const batch = loaded.current;
        const unedited = batch !== null && loadedRows(instance) === batch.rows;
        // Tripwire, defense in depth: the hidden check ran the same engine on
        // the same batch, so an unedited loaded row should never error here.
        // If one still does once the analysis settles, the rows come out and
        // the batch is never shown again.
        clearTimeout(tripwire);
        if (batch && unedited && verdictFromAnalysis(analysis, batch.ids)?.status === "error") {
          tripwire = setTimeout(() => {
            const current = loaded.current;
            if (!active || !instance || current !== batch || loadedRows(instance) !== batch.rows) return;
            const verdict = verdictFromAnalysis(instance.expressionAnalysis, batch.ids);
            if (verdict?.status !== "error") return;
            recordVisibleError(batch.payloadKey, verdict);
            loaded.current = null;
            instance.setBlank();
            publishRows(null);
            setLineCount(0);
            setExpressionError(false);
            setBlockedKey(batch.payloadKey);
          }, 150);
        }
        setExpressionError(Object.values(analysis).some((item) => item?.isError));
        if (batch) setEntriesEdited(!unedited);
        publishRows(batch === null || !unedited ? null : collectRows(analysis, batch.key));
      });
      // Editing a valid expression may leave its computed result unchanged, so
      // expressionAnalysis alone does not report every student edit.
      instance.observeEvent("change.desmo", () => {
        if (!active || !instance) return;
        const batch = loaded.current;
        if (!batch) return;
        const changed = loadedRows(instance) !== batch.rows;
        setEntriesEdited(changed);
        if (changed) { publishRows(null); select(null); }
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
      instance?.unobserve("selectedExpressionId.trace");
      instance?.unobserveEvent("change.desmo");
      instance?.destroy();
      loaded.current = null;
      publishRows(null);
      select(null);
    };
  }, [scriptReady, publishRows, select]);

  // Change only the visible calculator's palette. The hidden pre-flight math
  // instance stays untouched, and no expressions are cleared or revalidated:
  // the loaded rows are recolored in place, so a student's edits survive.
  useEffect(() => {
    const calculator = calculatorRef.current;
    const dark = resolvedTheme === "dark";
    calculator?.updateSettings?.({ invertedColors: dark });
    const rows = loaded.current;
    if (!calculator?.setExpression || !rows) return;
    rows.ids.forEach((id, index) => calculator.setExpression!({ id, color: displayColor(rows.colors[index], dark) }));
  }, [resolvedTheme, scriptReady]);

  useEffect(() => {
    if (!expanded) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setExpanded(false);
      expandButtonRef.current?.focus();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [expanded]);

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
        select(null);
        calculator.setBlank();
        calculator.setMathBounds(defaultBounds);
      } catch {
        setError("The calculator could not reset. Reload it and try again.");
        return;
      }

      if (!insertable || payload.items.length === 0) return;

      try {
        const dark = isDark();
        calculator.setExpressions(payload.items.map((item) => ({ ...item, color: displayColor(item.color, dark) })));
        // Keep the public key tied to the canonical solution. loadedRows still
        // proves that the actual sanitized calculator rows were not edited.
        loaded.current = {
          key: expressionsKey(expressions),
          rows: loadedRows(calculator),
          payloadKey: payload.key,
          ids: payload.items.map((item) => item.id),
          colors: payload.items.map((item) => item.color),
        };
        calculator.setMathBounds(validBounds(bounds));
        setLineCount(payload.items.length);
      } catch {
        loaded.current = null;
        setError("Could not add these lines. Try solving again.");
      }
    });

    return () => {
      active = false;
    };
  }, [scriptReady, expressions, payload, insertable, bounds, revision, replay, publishRows, select]);

  const unavailableMessage = !apiKey
    ? "Add NEXT_PUBLIC_DESMOS_API_KEY to .env.local, then restart the dev server to load the calculator."
    : error;
  const withheld = payload.items.length > 0 && (blocked || gate.status === "error" || gate.status === "unverified");
  const status = unavailableMessage
    ? "Calculator unavailable"
    : !scriptReady
      ? "Loading calculator…"
      : withheld
        ? "Lines not shown"
        : expressionError
          ? "Check the flagged line"
          : entriesEdited
            ? "Entries edited"
          : lineCount > 0
            ? `${lineCount} ${lineCount === 1 ? "line" : "lines"} added`
            : "Ready";

  return (
    <>
    {expanded && <div className={styles.fullscreenBackdrop} aria-hidden="true" onClick={() => setExpanded(false)} />}
    <div className={`${styles.shell} ${expanded ? styles.expanded : ""}`} data-testid="desmos-calculator">
      <div className={styles.graphHeader}>
        <div className={styles.graphName} data-state={unavailableMessage ? "error" : scriptReady ? "ready" : "loading"}><span className={styles.graphDot} aria-hidden="true" />Desmos</div>
        <div className={styles.graphControls}>
          <button type="button" className={styles.graphIconButton} title="Reset graph view" aria-label="Reset graph view" disabled={!scriptReady || !!unavailableMessage} onClick={() => calculatorRef.current?.setMathBounds(validBounds(bounds))}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 11a8 8 0 1 1 2.1 6.6M4 5v6h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button ref={expandButtonRef} type="button" className={styles.graphIconButton} title={expanded ? "Exit full screen" : "Full screen"} aria-label={expanded ? "Exit full screen" : "Full screen"} aria-pressed={expanded} onClick={() => setExpanded((value) => !value)}>
            {expanded ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 3v6H3m12 12v-6h6M3 9l6-6m6 18 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg> : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 3H3v6m12 12h6v-6M3 3l6 6m12 12-6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
          </button>
        </div>
      </div>
      <div className={styles.traceBar}>
        <span className={styles.traceMark} aria-hidden="true">↳</span>
        {selection && selection.key === expressionsKey(expressions) && !entriesEdited && insertable && lineCount > 0 ? (
          <button type="button" onClick={() => {
            const row = document.getElementById(`${traceId}-row-${selection.row}`);
            row?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
            row?.focus({ preventScroll: true });
          }}>Line {String(selection.row).padStart(2, "0")} <span>View its explanation</span> <span aria-hidden="true">↗</span></button>
        ) : <span>Select a calculator line to trace its reasoning</span>}
      </div>
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
            !scriptReady || !!unavailableMessage || !insertable
          }
          onClick={() => setReplay((value) => value + 1)}
        >
          <span aria-hidden="true">↻</span> Restore entries
        </button>
      </div>
      {withheld && !unavailableMessage && scriptReady && (
        <p className={styles.expressionWarning} role="status" data-testid="rows-withheld">
          {gate.status === "unverified"
            ? "These lines could not be checked in Desmos, so they are not shown. Reload to try again."
            : "These lines did not run cleanly in Desmos, so they are not shown. Solve the problem again for a working method."}
        </p>
      )}
      {expressionError && !withheld && !unavailableMessage && (
        <p className={styles.expressionWarning} role="status">
          Check the flagged line in Desmos, or restore the entries.
        </p>
      )}
    </div>
    </>
  );
}
