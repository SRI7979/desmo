/**
 * End-to-end check of lazy explanations on the real solve page: the actual
 * SolverWorkspace component (bundled with React) runs against the real
 * Desmos API in headless Chrome, with every network call to the app's own
 * routes mocked in the page. No AI or database call is made.
 *
 *   npx tsx scripts/check-explanation-flow.mts [--screenshots=<dir>]
 *
 * Solves the tangent problem, then selects techniques and samples the page
 * as it changes: the calculator must swap (or clear) at once with no loading
 * state, only the explanation panel may show a skeleton, a second selection
 * must make no request, and a failed explanation must leave a retry.
 * Needs Google Chrome (or CHROME_PATH) and NEXT_PUBLIC_DESMOS_API_KEY in .env.local.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";

import { fallbackExplanation, presentMethod } from "../src/lib/method-presentation";
import type { CacheEntry } from "../src/lib/solve-cache";
import { candidatesResponseSchema, selectMethods } from "../src/lib/strategy-selection";
import { candidatesResponse, TANGENT_QUESTION, tangentCandidates, tangentExplanations } from "../tests/method-fixtures";

const screenshotDir = process.argv.find((arg) => arg.startsWith("--screenshots="))?.split("=")[1] ?? null;
const chromePath = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const env = readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
const apiKey = /^NEXT_PUBLIC_DESMOS_API_KEY=(.+)$/m.exec(env)?.[1]?.trim();
if (!apiKey) throw new Error("NEXT_PUBLIC_DESMOS_API_KEY missing from .env.local");

// ---- what the mocked server returns: the real selection and presentation code

const selection = selectMethods(candidatesResponseSchema.parse(candidatesResponse(tangentCandidates(), { question: TANGENT_QUESTION })));
const methods = selection.methods.filter((method) => method.rejected === null);
const entry: CacheEntry = {
  version: 1, cacheKey: "harness.v1", promptConfigVersion: "v1", question: selection.question, choices: selection.choices,
  structure: selection.structure, methods, winnerId: selection.winnerId, modelPreference: null, retryOf: null, createdAt: new Date().toISOString(),
};
const explanations = tangentExplanations();
const data = {
  payload: {
    cacheKey: entry.cacheKey, selectedMethodId: selection.winnerId, cached: false, question: entry.question, choices: entry.choices, structure: entry.structure,
    methods: methods.map(({ rejected, repairs, ...method }) => {
      void rejected;
      void repairs;
      return { ...method, verified: false };
    }),
  },
  solutions: Object.fromEntries(methods.map((method) => [method.id, presentMethod(entry, method, explanations[method.name])])),
  fallbacks: Object.fromEntries(methods.map((method) => [method.id, presentMethod(entry, method, fallbackExplanation(method))])),
};

const harness = `
import { createRoot } from "react-dom/client";
import "@/app/globals.css";
import "katex/dist/katex.min.css";
import SolverWorkspace from "@/app/solve/solver-workspace";
const data = ${JSON.stringify(data)};
window.__calls = { solve: 0, preflight: 0, method: {} };
// The first request for these techniques' explanations fails (a fallback summary).
window.__failFirst = new Set(["quadratic-formula"]);
function ndjson(events) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({ async start(controller) {
    for (const event of events) { await new Promise((resolve) => setTimeout(resolve, event.delay)); controller.enqueue(encoder.encode(JSON.stringify(event.value) + "\\n")); }
    controller.close();
  } }), { headers: { "Content-Type": "application/x-ndjson" } });
}
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (url.endsWith("/api/solve")) {
    window.__calls.solve++;
    const winner = data.payload.selectedMethodId;
    return ndjson([{ delay: 50, value: { type: "methods", ...data.payload } }, { delay: 400, value: { type: "solution", solution: data.solutions[winner], methodId: winner, explanation: "model", problemId: null } }]);
  }
  if (url.endsWith("/api/solve/preflight")) { window.__calls.preflight++; return Response.json({ status: "ready", ...data.payload }); }
  if (url.endsWith("/api/solve/method")) {
    const { methodId } = JSON.parse(init.body);
    window.__calls.method[methodId] = (window.__calls.method[methodId] ?? 0) + 1;
    const summary = { type: "methods", ...data.payload, selectedMethodId: methodId, method: data.payload.methods.find((method) => method.id === methodId) };
    if (window.__failFirst.delete(methodId)) return ndjson([{ delay: 20, value: summary }, { delay: 500, value: { type: "solution", solution: data.fallbacks[methodId], explanation: "fallback" } }]);
    return ndjson([{ delay: 20, value: summary }, { delay: 700, value: { type: "solution", solution: data.solutions[methodId], explanation: "model" } }]);
  }
  return realFetch(input, init);
};
createRoot(document.getElementById("app")).render(<SolverWorkspace accountNav={null} />);
`;

const shims: Record<string, string> = {
  "next/script": `import { useEffect } from "react"; export default function Script({ onReady }) { useEffect(() => { onReady?.(); }, []); return null; }`,
  "next/image": `export default function Image({ fill, priority, unoptimized, sizes, ...props }) { return <img {...props} />; }`,
  "next/link": `export default function Link({ href, prefetch, children, ...props }) { return <a href={typeof href === "string" ? href : "#"} {...props}>{children}</a>; }`,
};
const bundle = await build({
  stdin: { contents: harness, resolveDir: process.cwd(), loader: "tsx" },
  bundle: true, format: "iife", platform: "browser", jsx: "automatic", write: false, outdir: "out", logLevel: "silent",
  loader: { ".css": "local-css", ".woff2": "dataurl", ".woff": "empty", ".ttf": "empty" },
  define: { "process.env.NEXT_PUBLIC_DESMOS_API_KEY": JSON.stringify(apiKey), "process.env.NODE_ENV": '"production"' },
  plugins: [{
    name: "next-shims",
    setup(build) {
      build.onResolve({ filter: /^next\/(script|image|link)$/ }, (args) => ({ path: args.path, namespace: "shim" }));
      build.onLoad({ filter: /.*/, namespace: "shim" }, (args) => ({ contents: shims[args.path], loader: "jsx", resolveDir: process.cwd() }));
    },
  }],
});
const script = bundle.outputFiles.find((file) => file.path.endsWith(".js"))!.text;
const css = bundle.outputFiles.filter((file) => file.path.endsWith(".css")).map((file) => file.text).join("\n");

const page = `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>${css}</style></head><body><div id="app"></div>
<script src="https://www.desmos.com/api/v1.11/calculator.js?apiKey=${encodeURIComponent(apiKey)}"></script></body></html>`;
const server = http.createServer((_request, response) => {
  response.setHeader("content-type", "text/html");
  response.end(page);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

const chrome = spawn(chromePath, ["--headless=new", "--remote-debugging-port=0", "--window-size=1440,1300", `--user-data-dir=${mkdtempSync(path.join(os.tmpdir(), "desmo-chrome-"))}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
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
type Reply = { result?: { result?: { value?: unknown }; exceptionDetails?: unknown; data?: string } };
const pending = new Map<number, (value: Reply) => void>();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  pending.get(message.id)?.(message);
  pending.delete(message.id);
});
const send = (method: string, params: object = {}) =>
  new Promise<Reply>((resolve) => {
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
async function screenshot(name: string) {
  if (!screenshotDir) return;
  mkdirSync(screenshotDir, { recursive: true });
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(screenshotDir, `${name}.png`), Buffer.from(String(shot.result?.data), "base64"));
}

type View = {
  status: string | null; rows: number; calculatorBusy: boolean; skeleton: boolean; stepsSkeleton: boolean; failed: boolean; retry: boolean;
  answer: string | null; idea: string | null; steps: number; purposes: number; question: boolean; trigger: string | null; calls: { solve: number; preflight: number; method: Record<string, number> };
};
// What the student sees, read from the DOM.
const observe = () =>
  evaluate<View>(`(() => {
    const calculatorCard = document.querySelector('[aria-labelledby="calculator-title"]');
    const resultCard = document.querySelector('[aria-labelledby="result-title"]');
    const items = [...(calculatorCard?.querySelectorAll(".dcg-expressionitem:not(.dcg-new-expression)") ?? [])];
    const text = (root, selector) => root?.querySelector(selector)?.textContent?.trim() ?? null;
    return {
      status: text(document, '[data-testid="desmos-status"]'),
      rows: items.filter((item) => (item.querySelector(".dcg-mq-root-block")?.textContent ?? "").trim().length > 0).length,
      calculatorBusy: Boolean(calculatorCard?.querySelector('[aria-busy="true"], [data-testid="explanation-skeleton"], [role="progressbar"]')),
      skeleton: Boolean(resultCard?.querySelector('[data-testid="explanation-skeleton"]')),
      stepsSkeleton: Boolean(resultCard?.querySelector('[data-testid="steps-skeleton"]')),
      failed: Boolean(resultCard?.querySelector('[data-testid="explanation-failed"]')),
      retry: Boolean(resultCard?.querySelector('[data-testid="explanation-retry"]')),
      answer: text(resultCard, '[data-testid="answer"]'),
      idea: text(resultCard, '[data-testid="structure"] p'),
      steps: resultCard ? [...resultCard.querySelectorAll("ol")].filter((list) => !list.getAttribute("aria-label")).reduce((sum, list) => sum + list.children.length, 0) : 0,
      purposes: resultCard ? [...resultCard.querySelectorAll('[data-testid="explanation-line"] p')].length : 0,
      question: Boolean(document.querySelector('[aria-labelledby="upload-title"]')),
      trigger: text(document, 'button[role="combobox"]'),
      calls: JSON.parse(JSON.stringify(window.__calls)),
    };
  })()`);
async function select(name: string) {
  await evaluate(`(async () => {
    document.querySelector('button[role="combobox"]').click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const option = [...document.querySelectorAll('li[role="option"]')].find((item) => item.textContent.includes(${JSON.stringify(name)}));
    if (!option) throw new Error("no option ${name}");
    option.click();
  })()`);
}
/** Samples the page every `every` ms for `duration` ms right after an action. */
async function samples(duration: number, every = 50): Promise<View[]> {
  const views: View[] = [];
  for (let elapsed = 0; elapsed <= duration; elapsed += every) {
    views.push(await observe());
    await pause(every);
  }
  return views;
}

const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  console.log(`  ${condition ? "✔" : "✖"} ${message}`);
  if (!condition) failures.push(message);
};

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url: `http://localhost:${(server.address() as { port: number }).port}/` });
  for (let attempt = 0; attempt < 150 && !(await evaluate<boolean>("Boolean(window.Desmos)")); attempt++) await pause(200);
  await evaluate(`${script}\ntrue`);
  await pause(800);

  // Solve: choose a screenshot, press Solve.
  await evaluate(`(() => {
    const input = document.querySelector('input[type="file"]');
    const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVQImWP4//8/AAX+Av5Y8msOAAAAAElFTkSuQmCC"), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "question.png", { type: "image/png" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await pause(200);
  await evaluate(`[...document.querySelectorAll("button")].find((button) => /^Solve/.test(button.textContent.trim())).click()`);
  let view = await observe();
  for (let attempt = 0; attempt < 60 && !(view.idea && view.rows === 1); attempt++) {
    await pause(100);
    view = await observe();
  }
  const ideas = new Map<string, string>();
  console.log("\nInitial solve (default: Vertex of the difference)");
  check(view.rows === 1 && view.status === "1 line added", `default rows in the calculator (${view.status})`);
  check(Boolean(view.idea), "the default's explanation is shown");
  check(view.calls.solve === 1 && Object.keys(view.calls.method).length === 0, "test 6: one solve request, no per-technique explanation requests");
  ideas.set("Vertex of the difference", view.idea ?? "");
  await screenshot("1-default");

  console.log("\nSelect Discriminant (no rows, explanation not written yet)");
  await select("Discriminant");
  let run = await samples(1300);
  const firstFrame = run[0];
  check(firstFrame.rows === 0 && firstFrame.status === "Ready", `test 3: the calculator clears at once (first sample: ${firstFrame.rows} rows, "${firstFrame.status}")`);
  check(/25[\s\S]*12/.test(firstFrame.answer ?? ""), "the answer shows at once");
  check(firstFrame.skeleton && firstFrame.stepsSkeleton, "test 1: skeleton in the explanation panel");
  check(run.every((sample) => !sample.calculatorBusy && !/Loading/.test(sample.status ?? "")), "test 1: no loading state on the calculator at any sample");
  check(run.every((sample) => sample.idea === null || sample.idea !== ideas.get("Vertex of the difference")), "the previous technique's idea is never shown for this one");
  const loaded = run.at(-1)!;
  check(!loaded.skeleton && loaded.steps === 3 && Boolean(loaded.idea), `test 1 + 3: the full explanation streams in (${loaded.steps} steps)`);
  check(loaded.calls.method.discriminant === 1, "one explanation request for it");
  ideas.set("Discriminant", loaded.idea ?? "");
  await screenshot("2-discriminant");

  console.log("\nSelect Slider until it fits (3 rows, explanation not written yet)");
  await select("Slider until it fits");
  run = await samples(1100);
  check(run[0].rows === 3, `test 1: the rows swap at once (first sample: ${run[0].rows} rows)`);
  check(run[0].skeleton, "skeleton in the explanation panel while it is written");
  check(run.every((sample) => !sample.calculatorBusy && !/Loading/.test(sample.status ?? "")), "no loading state on the calculator");
  check(run.at(-1)!.purposes === 3 && !run.at(-1)!.skeleton, "each row's explanation streams in");
  ideas.set("Slider until it fits", run.at(-1)!.idea ?? "");

  console.log("\nSelect Discriminant again");
  const before = (await observe()).calls.method.discriminant;
  await select("Discriminant");
  run = await samples(300);
  check(!run[0].skeleton && run[0].steps === 3 && run[0].rows === 0, "test 2: instant, with the full explanation on the first sample");
  check(run.at(-1)!.calls.method.discriminant === before, "test 2: no request, so no model call");

  console.log("\nSelect Quadratic formula (its first explanation request fails)");
  await select("Quadratic formula");
  run = await samples(900);
  const failedView = run.at(-1)!;
  check(failedView.failed && failedView.retry, "test 4: the explanation panel offers a retry");
  check(/25[\s\S]*12/.test(failedView.answer ?? "") && failedView.question && failedView.trigger !== null, "test 4: answer, question card, and technique menu stay; nothing blanks");
  check(failedView.rows === 0 && failedView.status === "Ready", "the calculator shows this technique's rows (none), not stale ones");
  await screenshot("3-failed");
  await evaluate(`document.querySelector('[data-testid="explanation-retry"]').click()`);
  run = await samples(1100);
  check(run[0].skeleton, "retry shows the skeleton again");
  check(run.at(-1)!.steps === 3 && !run.at(-1)!.failed, "the retried explanation streams in");
  check(run.at(-1)!.calls.method["quadratic-formula"] === 2, "exactly one retry request");
  ideas.set("Quadratic formula", run.at(-1)!.idea ?? "");
  await screenshot("4-retried");

  console.log("\nThe idea, per technique");
  for (const [name, idea] of ideas) console.log(`  ${name}: ${idea}`);
  check(new Set(ideas.values()).size === ideas.size && [...ideas.values()].every(Boolean), "test 5: every technique has its own idea");
  console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED`}`);
  process.exitCode = failures.length === 0 ? 0 : 1;
} finally {
  socket.close();
  chrome.kill();
  server.close();
}
