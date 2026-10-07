import { verdictFromAnalysis, type CalculatorItem, type CalculatorPayload, type DesmosAnalysis, type PreflightVerdict } from "./desmos-preflight";

/**
 * The slice of the Desmos API (v1.11) the app uses. Kept here, not in a
 * component, so the pre-flight engine runs unchanged in the browser and in
 * scripts/check-desmos-preflight.mts (headless Chrome against the real API).
 */
export type DesmosCalculatorInstance = {
  expressionAnalysis: DesmosAnalysis;
  getExpressions: () => Array<{ id?: string; latex?: string }>;
  observe: (name: string, callback: () => void) => void;
  unobserve: (name: string) => void;
  observeEvent: (name: string, callback: () => void) => void;
  unobserveEvent: (name: string) => void;
  setBlank: () => void;
  setExpressions: (expressions: CalculatorItem[]) => void;
  setMathBounds: (bounds: { left: number; right: number; bottom: number; top: number }) => void;
  /** Display settings only. The hidden pre-flight calculator never uses this. */
  updateSettings?: (settings: Record<string, unknown>) => void;
  /** Updates one existing row's display properties (its color for the theme); visible calculator only. */
  setExpression?: (expression: { id: string; color?: string }) => void;
  resize: () => void;
  destroy: () => void;
};

/**
 * Desmos's dark mode (invertedColors) inverts every color it draws, which
 * turns the Desmo cyan orange. The visible calculator pre-inverts its row
 * colors in dark mode so they render as the colors the light theme shows.
 */
export function displayColor(color: string, dark: boolean): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)?.[1];
  if (!dark || !hex) return color;
  return `#${(0xffffff - Number.parseInt(hex, 16)).toString(16).padStart(6, "0")}`;
}

export type DesmosApi = {
  GraphingCalculator: (container: HTMLElement, options: Record<string, unknown>) => DesmosCalculatorInstance;
};

declare global {
  interface Window {
    Desmos?: DesmosApi;
  }
}

/**
 * Options that change how rows evaluate. The visible calculator and the
 * hidden pre-flight instance share them, so a batch that is clean in one is
 * clean in the other (degree mode in particular changes trig results).
 */
export const MATH_OPTIONS = {
  degreeMode: true,
  clearIntoDegreeMode: true,
  enableRepeatFunction: true,
  forceEnableGeometryFunctions: true,
} as const;

export type PreflightTiming = {
  /** Wait this long after the last analysis update before reading the verdict. */
  quietMs: number;
  /** Give up (a "timeout" verdict, never treated as clean) after this long. */
  timeoutMs: number;
};

export const DEFAULT_TIMING: PreflightTiming = { quietMs: 60, timeoutMs: 4000 };

export type PreflightEngine = {
  check: (payload: CalculatorPayload) => Promise<PreflightVerdict>;
  destroy: () => void;
};

/**
 * One hidden calculator, reused for every check and run one batch at a time.
 * Desmos analyzes asynchronously, so a check waits until every inserted row
 * has an analysis entry and no update has arrived for `quietMs` (dependent
 * rows such as a readout of a fitted parameter settle after the fit). Each
 * check inserts its rows under fresh ids, so a late analysis of the previous
 * batch can never be read as this batch's result.
 */
export function createPreflightEngine(desmos: DesmosApi, doc: Document, timing: PreflightTiming = DEFAULT_TIMING): PreflightEngine {
  const host = doc.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.setAttribute("data-desmo-preflight", "");
  host.inert = true;
  // Off-screen rather than display:none, so the calculator lays out normally.
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:480px;height:320px;overflow:hidden;pointer-events:none;";
  doc.body.appendChild(host);
  const calculator = desmos.GraphingCalculator(host, {
    ...MATH_OPTIONS,
    autosize: false,
    expressions: false,
    settingsMenu: false,
    keypad: false,
  });
  let batch = 0;
  let queue: Promise<unknown> = Promise.resolve();

  function run(payload: CalculatorPayload): Promise<PreflightVerdict> {
    batch += 1;
    const ids = payload.items.map((_, index) => `preflight${batch}_${index + 1}`);
    return new Promise((resolve) => {
      let quiet: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(quiet);
        clearTimeout(limit);
        calculator.unobserve("expressionAnalysis");
        resolve(verdictFromAnalysis(calculator.expressionAnalysis, ids) ?? { status: "timeout", rows: ids.length });
      };
      const limit = setTimeout(finish, timing.timeoutMs);
      const update = () => {
        if (verdictFromAnalysis(calculator.expressionAnalysis, ids) === null) return;
        clearTimeout(quiet);
        quiet = setTimeout(finish, timing.quietMs);
      };
      calculator.setBlank();
      calculator.observe("expressionAnalysis", update);
      calculator.setExpressions(payload.items.map((item, index) => ({ ...item, id: ids[index] })));
      update();
    });
  }

  return {
    check(payload) {
      if (payload.items.length === 0) return Promise.resolve({ status: "clean", rows: 0, evaluations: {} });
      const next = queue.then(() => run(payload));
      queue = next.catch(() => undefined);
      return next;
    },
    destroy() {
      calculator.destroy();
      host.remove();
    },
  };
}
