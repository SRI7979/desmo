/**
 * Visual audit of the real solve page in both themes: the actual
 * SolverWorkspace and AccountNav inside ThemeProvider, bundled with React,
 * against the real Desmos API, in headless Chrome at 390, 768, and 1440px,
 * with every network call to the app's own routes mocked. No AI, auth, or
 * database call is made.
 *
 *   npx tsx scripts/check-ui-themes.mts [--screenshots=<dir>] [--label=run]
 *
 * For each theme and width it captures the empty workspace, the solved
 * workspace, the open technique dropdown, and (on phones) the calculator
 * panel, and measures horizontal overflow, tap targets under 44px, the
 * calculator's size, and text that is clipped instead of wrapping. Needs
 * Google Chrome (or CHROME_PATH) and NEXT_PUBLIC_DESMOS_API_KEY in .env.local.
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
import ThemeProvider from "@/components/theme-provider";
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
// The theme is chosen the way RootLayout's pre-paint script does it: from localStorage.
const theme = localStorage.getItem("desmo-theme");
document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
// A realistic page: account navigation for a signed-in student, inside the theme provider.
createRoot(document.getElementById("app")).render(<ThemeProvider><SolverWorkspace accountNav={<AccountNav email="student.name@example.com" active="solve" />} /></ThemeProvider>);
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
  // esbuild's defaults: *.module.css is local CSS, globals.css and KaTeX's stylesheet stay global.
  loader: { ".woff2": "dataurl", ".woff": "empty", ".ttf": "empty" },
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

const chrome = spawn(chromePath, ["--headless=new", "--remote-debugging-port=0", "--window-size=1440,1000", `--user-data-dir=${mkdtempSync(path.join(os.tmpdir(), "desmo-chrome-"))}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
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
  /** Page height, the bottom of the last visible content, and what reaches furthest down. */
  extent: { page: number; content: number; lowest: { selector: string; bottom: number }[] };
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
      // Desmos's own controls (inside its API container) are not the app's to size.
      if (el.closest('[hidden]') || el.disabled || el.closest('.dcg-container, .dcg-calculator-api-container')) continue;
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

    // Blank space at the end of the page: compare the page height with the lowest
    // visible content (Desmos's own thousands of nodes are skipped).
    let content = 0;
    const lowest = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('.dcg-container') && !el.classList.contains('dcg-container')) continue;
      if (!el.checkVisibility({ visibilityProperty: true }) || getComputedStyle(el).position === 'fixed') continue;
      const rect = el.getBoundingClientRect();
      if (rect.height === 0) continue;
      const bottom = Math.round(rect.bottom + window.scrollY);
      const leaf = el.children.length === 0 || el.classList.contains('dcg-container');
      if (leaf && ((el.textContent || '').trim() || ['IMG', 'CANVAS', 'svg'].includes(el.tagName) || el.classList.contains('dcg-container'))) content = Math.max(content, bottom);
      lowest.push({ selector: describe(el), bottom });
    }
    lowest.sort((a, b) => b.bottom - a.bottom);
    const extent = { page: document.documentElement.scrollHeight, content, lowest: lowest.slice(0, 4) };

    return {
      extent,
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


/** Tap targets are held to 44px on phones and tablets (768px and below), where fingers, not a mouse, press them. */
function report(name: string, r: Report) {
  if (r.innerWidth > 768) r.smallTapTargets = [];
  // More than a screen of blank page past the last content is a layout bug.
  const blank = Math.max(0, r.extent.page - r.extent.content - 120);
  const problems = r.horizontalOverflowPx + r.smallTapTargets.length + r.truncated.length + (blank > 0 ? 1 : 0);
  if (blank > 0) console.log(`    blank ${blank}px below the content (page ${r.extent.page}, content ends ${r.extent.content}); lowest: ${r.extent.lowest.map((el) => `${el.selector}@${el.bottom}`).join(", ")}`);
  console.log(`${problems ? "✗" : "✓"} ${name}: overflow ${r.horizontalOverflowPx}px, small tap targets ${r.smallTapTargets.length}, clipped text ${r.truncated.length}, calculator ${r.calculatorWidth}x${r.calculatorHeight}`);
  for (const el of r.overflowingElements.slice(0, 5)) console.log(`    overflow right=${el.right} ${el.selector} "${el.text}"`);
  for (const t of r.smallTapTargets) console.log(`    tap ${t.width}x${t.height} ${t.selector} "${t.text}"`);
  for (const t of r.truncated) console.log(`    clipped ${t.selector} "${t.text}"`);
  return problems;
}

const url = `http://localhost:${(server.address() as { port: number }).port}/`;
async function load(theme: "light" | "dark", width: number, height: number) {
  await setViewport(width, height);
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
  await send("Page.navigate", { url });
  for (let attempt = 0; attempt < 150 && !(await evaluate<boolean>("Boolean(window.Desmos)")); attempt++) await pause(200);
  await evaluate(`localStorage.setItem("desmo-theme", ${JSON.stringify(theme)}); true`);
  await evaluate(`${script}\ntrue`);
  await pause(700);
}
async function solve() {
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
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await evaluate<boolean>(`Boolean(document.querySelector('[data-testid="answer"]'))`)) break;
    await pause(100);
  }
  await pause(900);
}

let problems = 0;
try {
  await send("Page.enable");
  await send("Runtime.enable");
  for (const theme of ["light", "dark"] as const) {
    for (const [width, height] of [[1440, 1000], [768, 1024], [390, 844]] as const) {
      const name = `${label}-${theme}-${width}`;
      await load(theme, width, height);
      const applied = await evaluate<string>("document.documentElement.dataset.theme");
      if (applied !== theme) { console.log(`✗ ${name}: theme applied is ${applied}`); problems++; }
      problems += report(`${name} empty`, await measure());
      await screenshot(`${name}-empty`);
      await solve();
      problems += report(`${name} solved`, await measure());
      await screenshot(`${name}-solved`);
      await evaluate(`document.querySelector('button[role="combobox"]')?.scrollIntoView({ block: "center" })`);
      await evaluate(`document.querySelector('button[role="combobox"]')?.click()`);
      await pause(200);
      problems += report(`${name} dropdown`, await measure());
      await screenshotElement(`${name}-dropdown`, '[data-testid="technique-selector"]');
      await evaluate(`document.querySelector('button[role="combobox"]')?.click()`);
      if (width < 1024) {
        const switched = await evaluate<boolean>(`(() => { const tab = [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Calculator"); tab?.click(); return Boolean(tab); })()`);
        if (switched) {
          await pause(500);
          problems += report(`${name} calculator panel`, await measure());
          await screenshot(`${name}-calculator`);
        }
      }
    }
  }
  console.log(`\n${problems === 0 ? "NO LAYOUT PROBLEMS FOUND" : `${problems} layout issue point(s) found`}`);
} finally {
  socket.close();
  chrome.kill();
  server.close();
}
