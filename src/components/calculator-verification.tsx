"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
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
};

const CalculatorVerificationContext = createContext<ContextValue>({
  rows: null,
  publish: () => undefined,
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
  const publish = useCallback((next: CalculatorRows | null) => {
    setRows((previous) => (sameRows(previous, next) ? previous : next));
  }, []);
  const value = useMemo(() => ({ rows, publish }), [rows, publish]);
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
