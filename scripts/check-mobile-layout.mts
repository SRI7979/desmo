/**
 * Responsive audit of the real solve page (the actual SolverWorkspace
 * component, bundled with React, against the real Desmos API) in headless
 * Chrome at 390px and 768px, with every network call to the app's own
 * routes mocked. No AI or database call is made.
 *
 *   npx tsx scripts/check-mobile-layout.mts [--screenshots=<dir>] [--label=before|after]
 *
 * Solves a multi-technique problem, opens the technique dropdown, and at
 * each width measures: any element that overflows the viewport width,
 * every interactive element's tap-target size, the calculator's rendered
 * height, and whether any technique name or badge is clipped rather than
 * wrapped. Needs Google Chrome (or CHROME_PATH) and NEXT_PUBLIC_DESMOS_API_KEY
 * in .env.local.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";

import { presentMethod } from "../src/lib/method-presentation";
import type { CacheEntry } from "../src/lib/solve-cache";
import { candidatesResponseSchema, selectMethods } from "../src/lib/strategy-selection";
import { candidatesResponse, TANGENT_QUESTION, tangentCandidates, tangentExplanations } from "../tests/method-fixtures";

const args = process.argv.slice(2);
const screenshotDir = args.find((arg) => arg.startsWith("--screenshots="))?.split("=")[1] ?? null;
const label = args.find((arg) => arg.startsWith("--label="))?.split("=")[1] ?? "run";
const chromePath = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const env = readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
const apiKey = /^NEXT_PUBLIC_DESMOS_API_KEY=(.+)$/m.exec(env)?.[1]?.trim();
if (!apiKey) throw new Error("NEXT_PUBLIC_DESMOS_API_KEY missing from .env.local");

// ---- what the mocked server returns: the real selection and presentation code, 5 techniques

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
};

const harness = `
import { createRoot } from "react-dom/client";
import "@/app/globals.css";
import "katex/dist/katex.min.css";
import SolverWorkspace from "@/app/solve/solver-workspace";
import AccountNav from "@/components/account-nav";
const data = ${JSON.stringify(data)};
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
    const winner = data.payload.selectedMethodId;
    return ndjson([{ delay: 30, value: { type: "methods", ...data.payload } }, { delay: 200, value: { type: "solution", solution: data.solutions[winner], methodId: winner, explanation: "model", problemId: null } }]);
  }
  if (url.endsWith("/api/solve/preflight")) return Response.json({ status: "ready", ...data.payload });
  if (url.endsWith("/api/solve/method")) {
    const { methodId } = JSON.parse(init.body);
    const summary = { type: "methods", ...data.payload, selectedMethodId: methodId, method: data.payload.methods.find((method) => method.id === methodId) };
    return ndjson([{ delay: 10, value: summary }, { delay: 150, value: { type: "solution", solution: data.solutions[methodId], explanation: "model" } }]);
  }
  return realFetch(input, init);
};
// A realistic header: logo + account nav (with an email, like a signed-in student).
createRoot(document.getElementById("app")).render(<SolverWorkspace accountNav={<AccountNav email="student.name@example.com" active="solve" />} />);
`;

const shims: Record<string, string> = {
  "next/script": `import { useEffect } from "react"; export default function Script({ onReady }) { useEffect(() => { onReady?.(); }, []); return null; }`,
  "next/image": `export default function Image({ fill, priority, unoptimized, sizes, ...props }) { return <img {...props} />; }`,
  "next/link": `export default function Link({ href, prefetch, children, ...props }) { return <a href={typeof href === "string" ? href : "#"} {...props}>{children}</a>; }`,
  "@/app/auth/actions": `export async function signOut() {}`,
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
      build.onResolve({ filter: /^@\/app\/auth\/actions$/ }, (args) => ({ path: args.path, namespace: "shim" }));
      build.onLoad({ filter: /.*/, namespace: "shim" }, (args) => ({ contents: shims[args.path], loader: "jsx", resolveDir: process.cwd() }));
    },
  }],
});
const script = bundle.outputFiles.find((file) => file.path.endsWith(".js"))!.text;
const css = bundle.outputFiles.filter((file) => file.path.endsWith(".css")).map((file) => file.text).join("\n");

const page = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="app"></div>
<script src="https://www.desmos.com/api/v1.11/calculator.js?apiKey=${encodeURIComponent(apiKey)}"></script></body></html>`;
const server = http.createServer((_request, response) => {
  response.setHeader("content-type", "text/html");
  response.end(page);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

const chrome = spawn(chromePath, ["--headless=new", "--remote-debugging-port=0", "--window-size=800,1200", `--user-data-dir=${mkdtempSync(path.join(os.tmpdir(), "desmo-chrome-"))}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
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
  if (reply.result?.exceptionDetails) throw new Error(JSON.stringify(reply.result.exceptionDetails).slice(0, 1000));
  return reply.result?.result?.value as T;
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function setViewport(width: number, height: number) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: width < 600, screenWidth: width, screenHeight: height });
}
async function screenshot(name: string) {
  if (!screenshotDir) return;
  mkdirSync(screenshotDir, { recursive: true });
  const size = await evaluate<{ width: number; height: number }>("({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })");
  const shot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: size.width, height: Math.min(size.height, 4500), scale: 1 },
  });
  writeFileSync(path.join(screenshotDir, `${name}.png`), Buffer.from(String(shot.result?.data), "base64"));
}

/** A close-up of one element (scrolled into view first), with a small margin. */
async function screenshotElement(name: string, selector: string) {
  if (!screenshotDir) return;
  mkdirSync(screenshotDir, { recursive: true });
  const rect = await evaluate<{ x: number; y: number; width: number; height: number } | null>(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    const scrollX = window.scrollX, scrollY = window.scrollY;
    return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height };
  })()`);
  if (!rect) return;
  const margin = 16;
  const shot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: Math.max(0, rect.x - margin), y: Math.max(0, rect.y - margin), width: rect.width + margin * 2, height: rect.height + margin * 2, scale: 1 },
  });
  writeFileSync(path.join(screenshotDir, `${name}.png`), Buffer.from(String(shot.result?.data), "base64"));
}

// ---- measurements ----------------------------------------------------------

type Overflow = { selector: string; right: number; text: string };
type TapTarget = { selector: string; width: number; height: number; text: string };
type Report = {
  innerWidth: number;
  scrollWidth: number;
  horizontalOverflowPx: number;
  overflowingElements: Overflow[];
  smallTapTargets: TapTarget[];
  calculatorHeight: number;
  calculatorWidth: number;
  truncated: { selector: string; text: string }[];
  technique: { name: string | null; nameWraps: boolean; badgesVisible: number };
};

const measure = () =>
  evaluate<Report>(`(() => {
    const innerWidth = window.innerWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    const describe = (el) => {
      const parts = [el.tagName.toLowerCase()];
      if (el.id) parts.push('#' + el.id);
      if (el.className && typeof el.className === 'string') parts.push('.' + el.className.trim().split(/\\s+/).join('.'));
      return parts.join('');
    };
    // Every element whose right edge is past the viewport (a horizontal-overflow culprit).
    const overflowingElements = [];
    for (const el of document.querySelectorAll('body *')) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.right > innerWidth + 1) {
        overflowingElements.push({ selector: describe(el), right: Math.round(rect.right), text: (el.textContent || '').trim().slice(0, 60) });
      }
    }
    overflowingElements.sort((a, b) => b.right - a.right);

    // Every clickable control: buttons, links, and the technique-selector's option rows.
    const smallTapTargets = [];
    for (const el of document.querySelectorAll('button, a[href], summary, [role="option"], [role="combobox"], [role="button"]')) {
      if (el.closest('[hidden]') || el.disabled) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.height < 44 || rect.width < 44) {
        smallTapTargets.push({ selector: describe(el), width: Math.round(rect.width), height: Math.round(rect.height), text: (el.textContent || '').trim().slice(0, 40) });
      }
    }

    const calc = document.querySelector('[aria-label="Interactive Desmos graphing calculator"]');
    const calcRect = calc ? calc.getBoundingClientRect() : { width: 0, height: 0 };

    // Truncation: any technique/badge text node whose element clips via ellipsis
    // or nowrap+hidden instead of wrapping, or whose box is narrower than its
    // own scrollWidth while clipping horizontally.
    const truncated = [];
    for (const el of document.querySelectorAll('[class*="name"], [class*="optionName"], [class*="badge"], [class*="shape"]')) {
      const style = getComputedStyle(el);
      const clips = style.textOverflow === 'ellipsis' || (style.overflow === 'hidden' && style.whiteSpace === 'nowrap');
      if (clips && el.scrollWidth > el.clientWidth + 1) {
        truncated.push({ selector: describe(el), text: (el.textContent || '').trim() });
      }
    }

    const trigger = document.querySelector('button[role="combobox"]');
    const nameEl = trigger ? trigger.querySelector('[class*="name"]') : document.querySelector('[data-testid="technique-selector"] [class*="name"]');
    const badgeCount = document.querySelectorAll('[data-testid="technique-selector"] [class*="badge"]:not([class*="badgeRow"])').length;

    return {
      innerWidth,
      scrollWidth,
      horizontalOverflowPx: Math.max(0, scrollWidth - innerWidth),
      overflowingElements: overflowingElements.slice(0, 15),
      smallTapTargets,
      calculatorHeight: Math.round(calcRect.height),
      calculatorWidth: Math.round(calcRect.width),
      truncated,
      technique: {
        name: nameEl ? nameEl.textContent.trim() : null,
        nameWraps: nameEl ? nameEl.scrollHeight > (parseFloat(getComputedStyle(nameEl).lineHeight) || 16) * 1.3 : false,
        badgesVisible: badgeCount,
      },
    };
  })()`);

function report(width: number, when: string, r: Report) {
  console.log(`\n=== ${width}px — ${when} ===`);
  console.log(`  horizontal overflow: ${r.horizontalOverflowPx}px (innerWidth ${r.innerWidth}, scrollWidth ${r.scrollWidth})`);
  if (r.overflowingElements.length) {
    console.log(`  overflowing elements (${r.overflowingElements.length}):`);
    for (const el of r.overflowingElements) console.log(`    right=${el.right} ${el.selector} "${el.text}"`);
  }
  console.log(`  tap targets under 44px: ${r.smallTapTargets.length}`);
  for (const t of r.smallTapTargets) console.log(`    ${t.width}x${t.height} ${t.selector} "${t.text}"`);
  console.log(`  calculator: ${r.calculatorWidth}x${r.calculatorHeight}`);
  console.log(`  truncated technique/badge text: ${r.truncated.length}`);
  for (const t of r.truncated) console.log(`    ${t.selector} "${t.text}"`);
  console.log(`  technique trigger: "${r.technique.name}" wraps=${r.technique.nameWraps} badgesVisible=${r.technique.badgesVisible}`);
}

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await setViewport(390, 844); // a realistic phone height, so svh-based sizing (the calculator) measures accurately
  await send("Page.navigate", { url: `http://localhost:${(server.address() as { port: number }).port}/` });
  for (let attempt = 0; attempt < 150 && !(await evaluate<boolean>("Boolean(window.Desmos)")); attempt++) await pause(200);
  await evaluate(`${script}\ntrue`);
  await pause(600);

  await evaluate(`(() => {
    const input = document.querySelector('input[type="file"]');
    const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVQImWP4//8/AAX+Av5Y8msOAAAAAElFTkSuQmCC"), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "question.png", { type: "image/png" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await pause(150);
  await evaluate(`[...document.querySelectorAll("button")].find((button) => /^Solve/.test(button.textContent.trim())).click()`);
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await evaluate<boolean>(`Boolean(document.querySelector('[data-testid="answer"]'))`)) break;
    await pause(100);
  }
  await pause(300);

  const results: Record<string, unknown> = {};
  const viewports: [number, number][] = [[390, 844], [768, 1024]];
  for (const [width, height] of viewports) {
    await setViewport(width, height);
    await pause(150);
    const closed = await measure();
    report(width, "collapsed", closed);
    await screenshotElement(`${label}-${width}-selector-closed`, '[data-testid="technique-selector"]');
    await screenshot(`${label}-${width}-collapsed`);

    // Open the technique dropdown: the highest-risk spot for truncation/overflow.
    await evaluate(`document.querySelector('button[role="combobox"]')?.scrollIntoView({ block: "center" })`);
    await pause(50);
    await evaluate(`document.querySelector('button[role="combobox"]')?.click()`);
    await pause(150);
    const open = await measure();
    report(width, "dropdown open", open);
    await screenshotElement(`${label}-${width}-selector-open`, '[data-testid="technique-selector"]');
    await screenshot(`${label}-${width}-dropdown`);
    await evaluate(`document.querySelector('button[role="combobox"]')?.click()`);
    await pause(100);

    results[width] = { closed, open };
  }

  writeFileSync(path.join(screenshotDir ?? ".", `${label}-report.json`), JSON.stringify(results, null, 2));

  const flat = Object.values(results).flatMap((r) => [(r as { closed: Report }).closed, (r as { closed: Report; open: Report }).open]);
  const problems = flat.reduce((sum, r) => sum + r.horizontalOverflowPx + r.smallTapTargets.length + r.truncated.length, 0);
  console.log(`\n${problems === 0 ? "NO LAYOUT PROBLEMS FOUND" : `${problems} layout issue point(s) found`}`);
  process.exitCode = 0;
} finally {
  socket.close();
  chrome.kill();
  server.close();
}
