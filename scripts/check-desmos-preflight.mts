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

import { candidatesResponseSchema, selectMethods } from "../src/lib/strategy-selection";
import { candidatesResponse, CORRECTED_ROWS, NESTED_LIST_ROWS, NO_SOLUTION_QUESTION, noSolutionCandidates, TANGENT_QUESTION, tangentCandidates } from "../tests/method-fixtures";

type Plan = { label: string; rows: { latex: string; slider: { min: number; max: number; step: number } | null }[]; answerState: { param: string; value: number } | null };
type Checked = { label: string; verdict: { status: string; rows: number; errors?: { row: number; message: string }[]; evaluations?: Record<string, unknown> }; ms: number; updates: number; rows: string[] };

const args = process.argv.slice(2);
const resultsPath = args.find((arg) => arg.startsWith("--results="))?.split("=")[1] ?? "evals/results/before-enum.json";
const writeFixtures = args.includes("--write-fixtures");
const chromePath = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const env = readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
const apiKey = /^NEXT_PUBLIC_DESMOS_API_KEY=(.+)$/m.exec(env)?.[1]?.trim();
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

const page = `<!doctype html><html><body>
<script src="https://www.desmos.com/api/v1.11/calculator.js?apiKey=${encodeURIComponent(apiKey)}"></script></body></html>`;
const server = http.createServer((_request, response) => {
  response.setHeader("content-type", "text/html");
  response.end(page);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://localhost:${(server.address() as { port: number }).port}/`;

const chrome = spawn(chromePath, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${mkdtempSync(path.join(os.tmpdir(), "desmo-chrome-"))}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
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
  await send("Page.navigate", { url: origin });
  for (let attempt = 0; attempt < 150 && !(await evaluate<boolean>("Boolean(window.Desmos)")); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const version = await evaluate<string>("window.Desmos?.version ?? 'not loaded'");
  if (version === "not loaded") throw new Error("The Desmos API did not load (network, or the API key).");
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
  console.log(JSON.stringify({ desmos: version, engineCreateMs: Math.round(created) }, null, 1));
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
