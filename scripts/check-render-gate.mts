/**
 * End-to-end check of the rendering gate: the real DesmosCalculator and
 * SolutionExplanation components (bundled unchanged with React) render a
 * solution against the real Desmos API in headless Chrome, and the check
 * reads what the student would see. A raw, ungated calculator given the same
 * rows is the control that proves the warning-triangle detector works.
 *
 *   npx tsx scripts/check-render-gate.mts [--screenshots=<dir>]
 *
 * Needs Google Chrome (or CHROME_PATH) and NEXT_PUBLIC_DESMOS_API_KEY in
 * .env.local. No AI calls; nothing is written unless --screenshots is given.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";

import { CORRECTED_ROWS, NESTED_LIST_ROWS } from "../tests/method-fixtures";

const args = process.argv.slice(2);
const screenshotDir = args.find((arg) => arg.startsWith("--screenshots="))?.split("=")[1] ?? null;
const chromePath = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const env = (() => { try { return readFileSync(path.join(process.cwd(), ".env.local"), "utf8"); } catch { return ""; } })();
const apiKey = process.env.NEXT_PUBLIC_DESMOS_API_KEY?.trim() || /^NEXT_PUBLIC_DESMOS_API_KEY=(.+)$/m.exec(env)?.[1]?.trim();
if (!apiKey) throw new Error("NEXT_PUBLIC_DESMOS_API_KEY missing from .env.local");

function solution(rows: string[], answer: string) {
  return {
    status: "solved", question: "The line y = 6x - k and y = 3x^2 + 13x + 2 meet exactly once. What is k?", choices: null,
    structure: "a line tangent to a parabola", trick: "Derivative regression", answer, method: "desmos",
    why: "Tangent means equal value and equal slope at the touching point.", steps: [], readAnswer: "Read k.",
    expressions: rows.map((latex, index) => ({ latex, purpose: `Line ${index + 1}.` })),
    result: { type: "numeric", row: rows.length, relatedRows: [], value: 25 / 12, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "k" },
    answerState: null, parameters: [], conditionType: null, distinguishes: null, graphBounds: null, clarification: null,
  };
}

const harness = `
import { createRoot } from "react-dom/client";
import { CalculatorVerificationProvider } from "@/components/calculator-verification";
import DesmosCalculator from "@/components/desmos-calculator";
import SolutionExplanation from "@/components/solution-explanation";
const cases = ${JSON.stringify({ shipped: solution(NESTED_LIST_ROWS, "25/12"), corrected: solution(CORRECTED_ROWS, "25/12") })};
window.renderCase = (name) => {
  const host = document.getElementById("app");
  host.innerHTML = "";
  const solution = cases[name];
  createRoot(host).render(
    <CalculatorVerificationProvider>
      <div style={{ width: 900 }}><DesmosCalculator expressions={solution.expressions} bounds={null} answerState={null} revision={0} /></div>
      <div id="explanation"><SolutionExplanation solution={solution} /></div>
    </CalculatorVerificationProvider>,
  );
};
window.renderControl = (rows) => {
  const host = document.getElementById("control");
  host.innerHTML = "";
  const calculator = Desmos.GraphingCalculator(host, { expressions: true });
  calculator.setExpressions(rows.map((latex, index) => ({ id: "c" + index, latex })));
};
`;

// next/script needs Next's runtime; the page already loads Desmos, so the shim just reports ready.
const scriptShim = `import { useEffect } from "react";
export default function Script({ onReady }) { useEffect(() => { onReady?.(); }, []); return null; }`;

const bundle = await build({
  stdin: { contents: harness, resolveDir: process.cwd(), loader: "tsx" },
  bundle: true,
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  write: false,
  outdir: "out",
  logLevel: "silent",
  loader: { ".css": "local-css" },
  define: { "process.env.NEXT_PUBLIC_DESMOS_API_KEY": JSON.stringify(apiKey), "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "next-script-shim",
      setup(build) {
        build.onResolve({ filter: /^next\/script$/ }, () => ({ path: "next-script-shim", namespace: "shim" }));
        build.onLoad({ filter: /.*/, namespace: "shim" }, () => ({ contents: scriptShim, loader: "jsx", resolveDir: process.cwd() }));
      },
    },
  ],
});
const script = bundle.outputFiles.find((file) => file.path.endsWith(".js"))!.text;
const css = bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";

const page = `<!doctype html><html><head><style>${css}</style></head><body>
<div id="app"></div><div id="control" style="width:600px;height:400px"></div>
<script src="https://www.desmos.com/api/v1.11/calculator.js?apiKey=${encodeURIComponent(apiKey)}"></script></body></html>`;
const server = http.createServer((_request, response) => {
  response.setHeader("content-type", "text/html");
  response.end(page);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

const chrome = spawn(chromePath, ["--headless=new", "--remote-debugging-port=0", "--window-size=1100,1400", `--user-data-dir=${mkdtempSync(path.join(os.tmpdir(), "desmo-chrome-"))}`, "--no-first-run", "--no-default-browser-check", ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []), ...(process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`] : []), "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
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
const pending = new Map<number, (value: { result?: Record<string, unknown> & { result?: { value?: unknown }; exceptionDetails?: unknown } }) => void>();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  pending.get(message.id)?.(message);
  pending.delete(message.id);
});
const send = (method: string, params: object = {}) =>
  new Promise<{ result?: Record<string, unknown> & { result?: { value?: unknown }; exceptionDetails?: unknown } }>((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
async function evaluate<T>(expression: string): Promise<T> {
  const reply = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails).slice(0, 800));
  return reply.result?.result?.value as T;
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// What the student sees: expression rows in the visible calculator, any
// warning icon there, the status line, and the explanation's copyable rows.
const inspect = `(() => {
  const visible = document.querySelector('[aria-label="Interactive Desmos graphing calculator"]');
  const text = (selector) => document.querySelector(selector)?.textContent?.trim() ?? null;
  return {
    visibleRows: visible ? visible.querySelectorAll(".dcg-expressionitem:not(.dcg-new-expression)").length : -1,
    visibleErrorIcons: visible ? visible.querySelectorAll(".dcg-error, .dcg-icon-error, [class*='error-triangle']").length : -1,
    status: text('[data-testid="desmos-status"]'),
    withheld: text('[data-testid="rows-withheld"]'),
    explanationRows: document.querySelectorAll('#explanation [data-testid="explanation-line"]').length,
    explanationWithheld: text('[data-testid="rows-withheld-explanation"]'),
    hiddenInstances: document.querySelectorAll("[data-desmo-preflight]").length,
  };
})()`;

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url: `http://localhost:${(server.address() as { port: number }).port}/` });
  for (let attempt = 0; attempt < 150 && !(await evaluate<boolean>("Boolean(window.Desmos)")); attempt++) await pause(200);
  await evaluate(`${script}\ntrue`);

  const results: Record<string, unknown> = {};
  await evaluate(`renderControl(${JSON.stringify(NESTED_LIST_ROWS)})`);
  await pause(1500);
  results.control = await evaluate(`(() => {
    const control = document.getElementById("control");
    return { rows: control.querySelectorAll(".dcg-expressionitem:not(.dcg-new-expression)").length, errorIcons: control.querySelectorAll(".dcg-error, .dcg-icon-error, [class*='error-triangle']").length };
  })()`);
  await evaluate(`document.getElementById("control").innerHTML = ""`);

  for (const name of ["shipped", "corrected"]) {
    await evaluate(`renderCase(${JSON.stringify(name)})`);
    const samples = [];
    // Sample repeatedly while it settles: an erroring row must never appear, even briefly.
    for (let index = 0; index < 20; index++) {
      samples.push(await evaluate<Record<string, unknown>>(inspect));
      await pause(100);
    }
    results[name] = { final: samples.at(-1), maxVisibleErrorIcons: Math.max(...samples.map((sample) => Number(sample.visibleErrorIcons))), maxVisibleRows: Math.max(...samples.map((sample) => Number(sample.visibleRows))) };
    if (screenshotDir) {
      mkdirSync(screenshotDir, { recursive: true });
      const shot = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(path.join(screenshotDir, `gate-${name}.png`), Buffer.from(String((shot.result as { data: string }).data), "base64"));
    }
  }
  console.log(JSON.stringify(results, null, 1));
} finally {
  socket.close();
  chrome.kill();
  server.close();
}
