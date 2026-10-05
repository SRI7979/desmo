"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useId,
  useState,
  type ReactNode,
} from "react";
import type { RowEvaluation } from "@/lib/answer-consistency";

export type CalculatorRow = {
  isError: boolean;
  evaluation: RowEvaluation | null;
};

/** What the live calculator computed for the rows it currently holds. */
export type CalculatorRows = {
  /** Identifies the expression batch so stale rows never verify a new solution. */
  key: string;
  rows: Record<number, CalculatorRow>;
};

type ContextValue = {
  rows: CalculatorRows | null;
  publish: (rows: CalculatorRows | null) => void;
  selection: { key: string; row: number } | null;
  select: (selection: { key: string; row: number } | null) => void;
  traceId: string;
};

const CalculatorVerificationContext = createContext<ContextValue>({
  rows: null,
  publish: () => undefined,
  selection: null,
  select: () => undefined,
  traceId: "desmo-trace",
});

export function expressionsKey(
  expressions: ReadonlyArray<{ latex: string }>,
): string {
  return expressions.map((expression) => expression.latex).join("\n");
}

function sameRows(left: CalculatorRows | null, right: CalculatorRows | null) {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.key === right.key && JSON.stringify(left.rows) === JSON.stringify(right.rows);
}

/** Shares Desmos row evaluations between the calculator and the explanation. */
export function CalculatorVerificationProvider({ children }: { children: ReactNode }) {
  const [rows, setRows] = useState<CalculatorRows | null>(null);
  const [selection, setSelection] = useState<{ key: string; row: number } | null>(null);
  const traceId = useId();
  const select = useCallback((next: { key: string; row: number } | null) => {
    setSelection((previous) => previous?.key === next?.key && previous?.row === next?.row ? previous : next);
  }, []);
  const publish = useCallback((next: CalculatorRows | null) => {
    setRows((previous) => (sameRows(previous, next) ? previous : next));
  }, []);
  const value = useMemo(() => ({ rows, publish, selection, select, traceId }), [rows, publish, selection, select, traceId]);
  return (
    <CalculatorVerificationContext.Provider value={value}>
      {children}
    </CalculatorVerificationContext.Provider>
  );
}

export function useCalculatorRows(): CalculatorRows | null {
  return useContext(CalculatorVerificationContext).rows;
}

export function usePublishCalculatorRows() {
  return useContext(CalculatorVerificationContext).publish;
}

/** Selection is tied to the expression batch, just like verification. */
export function useCalculatorTrace() {
  const { selection, select, traceId } = useContext(CalculatorVerificationContext);
  return { selection, select, traceId };
}
