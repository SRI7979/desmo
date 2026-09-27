import type { Solution } from "@/lib/solver-schema";

export const METHOD_LABELS: Record<Solution["method"], string> = {
  desmos: "Desmos",
  mental_math: "Mental math",
  plug_in_answers: "Plug in the choices",
  shortcut: "Take a shortcut",
  algebra: "Simple algebra",
};
