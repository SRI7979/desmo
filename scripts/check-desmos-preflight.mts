/**
 * Runs the app's own pre-flight engine (src/lib/desmos-engine.ts, bundled
 * unchanged) against the real Desmos API in headless Chrome. Unit tests use a
 * stand-in engine; this is the check that the stand-in behaves like Desmos.
 *
 *   npx tsx scripts/check-desmos-preflight.mts [--results=evals/results/<label>.json] [--write-fixtures]
 *
 * Checks the regression-test fixtures (the shipped nested-list plan, its
 * corrected form, every tangent and no-solution technique), then audits the
 * winning rows of an eval run: how many would have reached a student with an
 * error, and how long each pre-flight check takes. Needs Google Chrome (or
 * CHROME_PATH) and NEXT_PUBLIC_DESMOS_API_KEY in .env.local. No AI calls.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";

import { loadCases } from "../evals/benchmark/load-cases";
import { parseNumber } from "../src/lib/answer-consistency";
import { findDerivedConstants, findProseRows, findUndefinedVariables, normalizeDesmosExpressions } from "../src/lib/desmos-latex";
import { hasUnnecessaryCoefficientLists } from "../src/lib/regression-workflow";
import { findListShapeViolations, findRegressionDeterminacyViolations } from "../src/lib/solver-rules";
import { candidatesResponseSchema, selectMethods } from "../src/lib/strategy-selection";
import { candidatesResponse, CORRECTED_ROWS, NESTED_LIST_ROWS, NO_SOLUTION_QUESTION, noSolutionCandidates, TANGENT_QUESTION, tangentCandidates } from "../tests/method-fixtures";

type Plan = { label: string; rows: { latex: string; slider: { min: number; max: number; step: number } | null }[]; answerState: { param: string; value: number } | null };
type Checked = { label: string; verdict: { status: string; rows: number; errors?: { row: number; message: string }[]; evaluations?: Record<string, unknown> }; ms: number; updates: number; rows: string[] };

const args = process.argv.slice(2);
const resultsPath = args.find((arg) => arg.startsWith("--results="))?.split("=")[1] ?? "evals/results/before-enum.json";
const writeFixtures = args.includes("--write-fixtures");
// --cases: also run every benchmark case's gold rows through real Desmos.
const auditCases = args.includes("--cases");
// --plans=<file.json>: worked examples ({ plans: [{ source, context, rows, claimedResult, sliderRows }] })
// checked against the server's own static rules and the real engine.
const plansPath = args.find((arg) => arg.startsWith("--plans="))?.split("=")[1] ?? null;
type ExamplePlan = { source: string; context: string; rows: string[]; claimedResult: string; sliderRows: number[] };

/** Every static server rule a candidate's rows must pass, as the reasons it would be rejected. */
function staticFlags(plan: ExamplePlan): string[] {
  const rows = normalizeDesmosExpressions(plan.rows.map((latex, index) => ({
    latex,
    purpose: "",
    slider: plan.sliderRows.includes(index + 1) ? { min: -10, max: 10, step: 1 } : null,
  })));
  const flags: string[] = [];
  const prose = findProseRows(rows);
  if (prose.length) flags.push(`prose rows ${prose.join(",")}`);
  for (const { row, variables } of findUndefinedVariables(rows)) flags.push(`line ${row} undefined ${variables.join(",")}`);
  for (const violation of findListShapeViolations(rows)) flags.push(`line ${violation.row} list-shape ${violation.kind}`);
  for (const violation of findRegressionDeterminacyViolations(rows)) flags.push(`line ${violation.row} ${violation.kind}${violation.kind === "underdetermined" ? ` (${violation.params.join(",")} vs ${violation.constraints})` : ""}`);
  if (plan.context.trim()) {
    for (const { row, constants } of findDerivedConstants(rows, plan.context, null)) flags.push(`line ${row} hidden-derivation numbers ${constants.join(",")}`);
    if (hasUnnecessaryCoefficientLists(rows, plan.context)) flags.push("coefficient-lists");
  }
  return flags;
}
const chromePath = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const env = (() => { try { return readFileSync(path.join(process.cwd(), ".env.local"), "utf8"); } catch { return ""; } })();
const apiKey = process.env.NEXT_PUBLIC_DESMOS_API_KEY?.trim() || /^NEXT_PUBLIC_DESMOS_API_KEY=(.+)$/m.exec(env)?.[1]?.trim();
if (!apiKey) throw new Error("NEXT_PUBLIC_DESMOS_API_KEY missing from .env.local");

const bundle = await build({
  stdin: {
    contents: `export { createPreflightEngine, MATH_OPTIONS } from "./src/lib/desmos-engine";
export { calculatorPayload, verdictFromAnalysis } from "./src/lib/desmos-preflight";`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  globalName: "DesmoPreflight",
  platform: "browser",
  write: false,
  logLevel: "silent",
});
const engineScript = bundle.outputFiles[0].text;

// DESMOS_SCRIPT_FILE: a calculator.js already downloaded (e.g. with curl behind
// a TLS-intercepting proxy whose CA the browser does not trust), served locally.
const localScript = process.env.DESMOS_SCRIPT_FILE ? readFileSync(process.env.DESMOS_SCRIPT_FILE) : null;
const scriptSrc = localScript ? "/calculator.js" : `https://www.desmos.com/api/v1.11/calculator.js?apiKey=${encodeURIComponent(apiKey)}`;
const page = `<!doctype html><html><body>
<script src="${scriptSrc}"></script></body></html>`;
const server = http.createServer((request, response) => {
  if (localScript && request.url?.startsWith("/calculator.js")) {
    response.setHeader("content-type", "text/javascript");
    response.end(localScript);
    return;
  }
  response.setHeader("content-type", "text/html");
  response.end(page);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://localhost:${(server.address() as { port: number }).port}/`;

const chrome = spawn(chromePath, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${mkdtempSync(path.join(os.tmpdir(), "desmo-chrome-"))}`, "--no-first-run", "--no-default-browser-check", ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []), ...(process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`] : []), "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const wsUrl = await new Promise<string>((resolve, reject) => {
  let buffer = "";
  chrome.stderr!.on("data", (chunk) => {
    buffer += chunk;
    const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/);
    if (match) resolve(match[1]);
  });
  setTimeout(() => reject(new Error(`Chrome did not start: ${buffer.slice(0, 300)}`)), 15_000);
});
const targets = (await (await fetch(`http://127.0.0.1:${new URL(wsUrl).port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
const socket = new WebSocket(targets.find((target) => target.type === "page")!.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener("open", resolve));
let nextId = 0;
const pending = new Map<number, (value: { result?: { result?: { value?: unknown }; exceptionDetails?: unknown } }) => void>();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  pending.get(message.id)?.(message);
  pending.delete(message.id);
});
const send = (method: string, params: object = {}) =>
  new Promise<{ result?: { result?: { value?: unknown }; exceptionDetails?: unknown } }>((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
async function evaluate<T>(expression: string): Promise<T> {
  const reply = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails).slice(0, 600));
  return reply.result?.result?.value as T;
}

try {
  await send("Runtime.enable");
  const navigated = performance.now();
  await send("Page.navigate", { url: origin });
  for (let attempt = 0; attempt < 150 && !(await evaluate<boolean>("Boolean(window.Desmos)")); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const version = await evaluate<string>("window.Desmos?.version ?? 'not loaded'");
  if (version === "not loaded") throw new Error("The Desmos API did not load (network, or the API key).");
  const scriptReadyMs = Math.round(performance.now() - navigated);
  // A visible calculator as the solve page creates it (expressions list, keypad).
  const visibleCreateMs = await evaluate<number>(`(() => {
    const host = document.createElement("div");
    host.style.cssText = "width:900px;height:600px";
    document.body.appendChild(host);
    const started = performance.now();
    const calculator = Desmos.GraphingCalculator(host, { degreeMode: true, expressions: true, keypad: true, settingsMenu: true });
    const ms = performance.now() - started;
    calculator.destroy();
    host.remove();
    return ms;
  })()`);
  // The app's engine, exactly as bundled, as a global the checks below call.
  await evaluate(`${engineScript}\nwindow.DesmoPreflight = DesmoPreflight; true`);
  const created = await evaluate<number>(`(() => {
    const started = performance.now();
    window.engine = DesmoPreflight.createPreflightEngine(window.Desmos, document);
    return performance.now() - started;
  })()`);

  /** Runs one plan through the real engine, timing it and counting analysis updates. */
  const check = (plan: Plan) =>
    evaluate<Checked>(`(async () => {
      const plan = ${JSON.stringify(plan)};
      const payload = DesmoPreflight.calculatorPayload(plan.rows, plan.answerState);
      const started = performance.now();
      const verdict = await window.engine.check(payload);
      return { label: plan.label, verdict, ms: Math.round(performance.now() - started), updates: 0, rows: payload.items.map((item) => item.latex) };
    })()`);

  /** Raw analysis for a fixture, recorded under ids p1..pn (for tests/fixtures). */
  const record = (rows: string[]) =>
    evaluate<Record<string, unknown>>(`(async () => {
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;left:-10000px;width:400px;height:300px";
      document.body.appendChild(host);
      const calculator = Desmos.GraphingCalculator(host, { ...DesmoPreflight.MATH_OPTIONS, expressions: false });
      const payload = DesmoPreflight.calculatorPayload(${JSON.stringify(rows.map((latex) => ({ latex, slider: null })))}, null);
      calculator.setExpressions(payload.items.map((item, index) => ({ ...item, id: "p" + (index + 1) })));
      await new Promise((resolve) => setTimeout(resolve, 600));
      const analysis = JSON.parse(JSON.stringify(calculator.expressionAnalysis));
      calculator.destroy();
      host.remove();
      return { rows: payload.items.map((item) => item.latex), analysis };
    })()`);

  const methodPlans = (label: string, candidates: ReturnType<typeof tangentCandidates>, question: string): Plan[] =>
    selectMethods(candidatesResponseSchema.parse(candidatesResponse(candidates, { question })))
      .methods.filter((method) => method.rejected === null && method.rows.length > 0)
      .map((method) => ({ label: `${label}: ${method.techniqueId}`, rows: method.rows, answerState: method.answerState }));
  const plainRows = (rows: string[]) => rows.map((latex) => ({ latex, slider: null }));

  const fixtures: Plan[] = [
    { label: "shipped nested-list derivative regression", rows: plainRows(NESTED_LIST_ROWS), answerState: null },
    { label: "corrected two-row derivative regression", rows: plainRows(CORRECTED_ROWS), answerState: null },
    ...methodPlans("tangent", tangentCandidates(), TANGENT_QUESTION),
    ...methodPlans("no solution", noSolutionCandidates(), NO_SOLUTION_QUESTION),
    { label: "mismatched literal sides", rows: plainRows(["[a+b,c]\\sim[1,2,3]", "a"]), answerState: null },
    // s and y_1 enter only as their product; Desmos must still fit r = 3.
    { label: "small-system bracket regression (product unknowns)", rows: plainRows(["x_{1}=2", "[7rx_{1}+12sy_{1},3rx_{1}+4sy_{1}]\\sim[3,5]", "r"]), answerState: null },
  ];
  const fixtureResults: Checked[] = [];
  for (const plan of fixtures) fixtureResults.push(await check(plan));

  // Eval audit: every calculator plan the eval run would have shown: each
  // listed method when the run recorded them, else the winner.
  type Run = {
    id: string;
    result: {
      ok: boolean;
      techniqueId?: string;
      solution?: { expressions: { latex: string; slider?: Plan["rows"][number]["slider"] }[]; answerState: Plan["answerState"] };
      methods?: { techniqueId: string; rows: Plan["rows"]; answerState: Plan["answerState"] }[];
    };
  };
  const results = JSON.parse(readFileSync(resultsPath, "utf8")) as { label: string; fullResults: Run[] };
  const audit: Checked[] = [];
  for (const [index, run] of results.fullResults.entries()) {
    if (!run.result.ok) continue;
    const plans: Plan[] = run.result.methods
      ? run.result.methods.map((method) => ({ label: `${run.id} #${index + 1} ${method.techniqueId}`, rows: method.rows, answerState: method.answerState }))
      : run.result.solution
        ? [{
            label: `${run.id} #${index + 1} ${run.result.techniqueId}`,
            rows: run.result.solution.expressions.map((expression) => ({ latex: expression.latex, slider: expression.slider ?? null })),
            answerState: run.result.solution.answerState,
          }]
        : [];
    for (const plan of plans) if (plan.rows.length > 0) audit.push(await check(plan));
  }

  const times = audit.map((item) => item.ms).sort((a, b) => a - b);
  const percentile = (p: number) => times[Math.min(times.length - 1, Math.floor((p / 100) * times.length))];
  const erroring = audit.filter((item) => item.verdict.status === "error");
  console.log(JSON.stringify({ desmos: version, scriptReadyMs, visibleCalculatorCreateMs: Math.round(visibleCreateMs), engineCreateMs: Math.round(created) }, null, 1));
  console.log("\nFIXTURES (real engine):");
  for (const item of fixtureResults) {
    const detail = item.verdict.status === "error"
      ? item.verdict.errors!.map((error) => `line ${error.row}: ${error.message}`).join("; ")
      : Object.entries(item.verdict.evaluations ?? {}).filter(([, value]) => value).map(([row, value]) => `line ${row} = ${JSON.stringify((value as { value: unknown }).value)}`).join("; ");
    console.log(`  ${item.verdict.status.padEnd(7)} ${String(item.ms).padStart(4)}ms  ${item.label}${detail ? `  (${detail})` : ""}`);
  }
  console.log(`\nEVAL AUDIT (${results.label}: ${audit.length} calculator plans):`);
  console.log(`  clean ${audit.filter((item) => item.verdict.status === "clean").length}, error ${erroring.length}, timeout ${audit.filter((item) => item.verdict.status === "timeout").length}`);
  for (const item of erroring) {
    console.log(`  ERROR ${item.label}: ${item.verdict.errors!.map((error) => `line ${error.row} ${JSON.stringify(item.rows[error.row - 1])}: ${error.message}`).join("; ")}`);
  }
  console.log(`  pre-flight per check: p50 ${percentile(50)}ms, p95 ${percentile(95)}ms, max ${times.at(-1)}ms (includes the 60ms quiet window)`);

  if (auditCases) {
    // Every benchmark case's reference rows must run in real Desmos, and a
    // numeric reference must display the case's answer on its last row.
    const cases = (await loadCases()).filter((item) => item.goldRows.length > 0);
    let clean = 0;
    const problems: string[] = [];
    for (const item of cases) {
      const checked = await check({ label: item.id, rows: item.goldRows.map((latex) => ({ latex, slider: null })), answerState: null });
      if (checked.verdict.status !== "clean") {
        problems.push(`${item.id}: ${checked.verdict.status} ${checked.verdict.errors?.map((error) => `line ${error.row} ${JSON.stringify(checked.rows[error.row - 1])}: ${error.message}`).join("; ") ?? ""}`);
        continue;
      }
      clean += 1;
      if (item.expectedResultType === "numeric") {
        const last = (checked.verdict.evaluations ?? {})[String(item.goldRows.length)] as { value?: unknown } | null | undefined;
        const expected = parseNumber(item.correctAnswer);
        const shown = typeof last?.value === "number" ? last.value : null;
        if (expected !== null && (shown === null || Math.abs(shown - expected) > 1e-6 * Math.max(1, Math.abs(expected)))) {
          problems.push(`${item.id}: last row shows ${JSON.stringify(last?.value ?? null)}, answer is ${item.correctAnswer}`);
        }
      }
    }
    console.log(`\nBENCHMARK GOLD ROWS (${cases.length} calculator cases): ${clean} clean`);
    for (const problem of problems) console.log(`  ${problem}`);
  }

  if (plansPath) {
    const { plans } = JSON.parse(readFileSync(plansPath, "utf8")) as { plans: ExamplePlan[] };
    const findings: string[] = [];
    let engineErrors = 0;
    let staticRejects = 0;
    for (const plan of plans) {
      const flags = staticFlags(plan);
      const normalized = normalizeDesmosExpressions(plan.rows.map((latex, index) => ({ latex, purpose: "", slider: plan.sliderRows.includes(index + 1) ? { min: -10, max: 10, step: 1 } : null })));
      const checked = await check({ label: plan.source, rows: normalized.map((row) => ({ latex: row.latex, slider: row.slider ?? null })), answerState: null });
      const engine = checked.verdict.status === "error"
        ? checked.verdict.errors!.map((error) => `line ${error.row} ${JSON.stringify(checked.rows[error.row - 1])}: ${error.message}`).join("; ")
        : null;
      // A clean plan whose text states a number must display it on its last row.
      const stated = parseNumber(plan.claimedResult.replace(/^.*=\s*/, ""));
      const last = checked.verdict.status === "clean" ? ((checked.verdict.evaluations ?? {})[String(plan.rows.length)] as { value?: unknown } | null | undefined)?.value : undefined;
      const mismatch = stated !== null && typeof last === "number" && Math.abs(last - stated) > 1e-6 * Math.max(1, Math.abs(stated))
        ? `last row shows ${last}, text says ${plan.claimedResult}`
        : null;
      if (mismatch) flags.push(mismatch);
      if (engine) engineErrors += 1;
      if (flags.length) staticRejects += 1;
      if (engine || flags.length) {
        findings.push(`- ${plan.claimedResult.startsWith("COUNTER-EXAMPLE") ? "(counter-example) " : ""}${plan.source}\n    rows: ${plan.rows.join(" | ")}${flags.length ? `\n    server rules: ${flags.join("; ")}` : ""}${engine ? `\n    Desmos: ${engine}` : ""}`);
      }
    }
    console.log(`\nWORKED EXAMPLES (${plans.length} plans): ${engineErrors} error in real Desmos, ${staticRejects} fail a server rule`);
    console.log(findings.join("\n"));
  }

  if (writeFixtures) {
    const fixture = {
      _source: `expressionAnalysis recorded from the real Desmos API ${version} in headless Chrome by scripts/check-desmos-preflight.mts; row n was inserted as id p<n>.`,
      nestedList: await record(NESTED_LIST_ROWS),
      corrected: await record(CORRECTED_ROWS),
    };
    writeFileSync("tests/fixtures/desmos-analysis-v1.11.json", `${JSON.stringify(fixture, null, 2)}\n`);
    console.log("\nWrote tests/fixtures/desmos-analysis-v1.11.json");
  }
} finally {
  socket.close();
  chrome.kill();
  server.close();
}
