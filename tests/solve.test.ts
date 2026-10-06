import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { afterEach, beforeEach, mock, test } from "node:test";
import OpenAI from "openai";
import { Responses } from "openai/resources/responses/responses";
import sharp from "sharp";

import { createMemorySolveCache, withCacheFallback, type SolveCache } from "../src/lib/solve-cache";
import { createMethodHandler, createPreflightHandler, createSolveHandler, type SolveDependencies } from "../src/lib/solve-handler";
import { MAX_IMAGE_BYTES } from "../src/lib/solver-schema";
import { createMemoryUsageStore } from "../src/lib/spend";
import { retryCountdown } from "../src/lib/retry-countdown";
import { createTelemetry, memorySink, supabaseSink, type TelemetryRecord } from "../src/lib/telemetry";
import {
  candidatesResponse,
  explanation,
  graphCandidate,
  mockModel,
  paperCandidate,
  providerBody,
  hang,
  TANGENT_QUESTION,
  tangentCandidates,
  tangentExplanations,
  zeroCost,
} from "./method-fixtures";
import { explanationFromEvents } from "../src/lib/technique-selection-ui";

// Tiny valid PNG; tests never send this (or any other data) to an external API.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4//8/AAX+Av5Y8msOAAAAAElFTkSuQmCC",
  "base64",
);
const userId = "11111111-1111-4111-8111-111111111111";
const problemId = "22222222-2222-4222-8222-222222222222";
let cache = createMemorySolveCache();
let usage = createMemoryUsageStore();
let telemetryRecords: TelemetryRecord[] = [];
const dependencies: SolveDependencies = {
  getCurrentUser: async () => ({ id: userId }),
  reserveSolve: async () => ({ allowed: true, retryAfter: 0 }),
  saveProblem: async () => problemId,
  getCache: () => cache,
  getUsage: () => usage,
  limits: () => ({ freeSolvesPerDay: 1000, dailySpendCeilingUsd: 1000 }),
  maxDurationSeconds: 180,
  telemetry: createTelemetry([]),
};
const POST = createSolveHandler(dependencies);
const SWITCH = createMethodHandler(dependencies);
const PREFLIGHT = createPreflightHandler(dependencies);
const saved = {
  key: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL,
  effort: process.env.OPENAI_REASONING_EFFORT,
  tier: process.env.OPENAI_SERVICE_TIER,
};

beforeEach(() => {
  cache = createMemorySolveCache();
  usage = createMemoryUsageStore();
  telemetryRecords = [];
  dependencies.telemetry = createTelemetry([memorySink(telemetryRecords)]);
  dependencies.limits = () => ({ freeSolvesPerDay: 1000, dailySpendCeilingUsd: 1000 });
  dependencies.getCurrentUser = async () => ({ id: userId });
  dependencies.reserveSolve = async () => ({ allowed: true, retryAfter: 0 });
  dependencies.saveProblem = async () => problemId;
  process.env.OPENAI_API_KEY = "unit-test-key";
  delete process.env.OPENAI_MODEL;
  delete process.env.OPENAI_REASONING_EFFORT;
  delete process.env.OPENAI_SERVICE_TIER;
  mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected external request in a unit test");
  });
});

afterEach(() => {
  mock.restoreAll();
  for (const [name, value] of [
    ["OPENAI_API_KEY", saved.key],
    ["OPENAI_MODEL", saved.model],
    ["OPENAI_REASONING_EFFORT", saved.effort],
    ["OPENAI_SERVICE_TIER", saved.tier],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function upload(bytes: Uint8Array = png, type = "image/png", headers: Record<string, string> = {}) {
  const form = new FormData();
  form.set("image", new File([new Uint8Array(bytes)], "question.png", { type }));
  return new Request("http://localhost/api/solve", { method: "POST", body: form, headers });
}

function switchTo(cacheKey: string, methodId: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/solve/method", {
    method: "POST",
    body: JSON.stringify({ cacheKey, methodId }),
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function report(cacheKey: string, verdicts: unknown[]) {
  return new Request("http://localhost/api/solve/preflight", {
    method: "POST",
    body: JSON.stringify({ cacheKey, verdicts }),
    headers: { "Content-Type": "application/json" },
  });
}

const desmosError = (message = "Cannot store a list of numbers in a list.") => ({ status: "error", errors: [{ row: 1, message }] });

/** Two calculator techniques for x² = 9 and nothing else, so both can error in Desmos. */
function calculatorOnly() {
  return candidatesResponse([
    graphCandidate(),
    graphCandidate({
      techniqueId: "graph-both-sides",
      rows: [{ latex: "y=x^2", slider: null, copiesRow: null }, { latex: "y=9", slider: null, copiesRow: null }],
      result: { type: "intersection", row: 1, relatedRows: [2], value: 3, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "the right intersection's x-coordinate" },
      cost: { ...zeroCost, manualIterations: 1 },
    }),
  ]);
}

async function otherScreenshot() {
  return sharp({ create: { width: 3, height: 2, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();
}

async function events(response: Response) {
  return (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
}

test("unauthenticated and cross-site requests cannot reach rate limiting or AI", async () => {
  mock.method(dependencies, "getCurrentUser", async () => null);
  const reserve = mock.method(dependencies, "reserveSolve");
  assert.equal((await POST(upload())).status, 401);
  const crossSite = upload();
  crossSite.headers.set("Origin", "https://another-site.example");
  assert.equal((await POST(crossSite)).status, 403);
  assert.equal(reserve.mock.callCount(), 0);
});

test("rate limit runs before AI and returns a usable retry interval", async () => {
  const reserve = mock.method(dependencies, "reserveSolve", async () => ({ allowed: false, retryAfter: 27 }));
  const { fetchMock } = mockModel({ candidates: candidatesResponse() });
  const response = await POST(upload());
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "27");
  assert.equal((await response.json()).retryAfter, 27);
  assert.deepEqual(reserve.mock.calls[0].arguments, [userId]);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("auth and quota outages fail closed rather than permitting free solves", async () => {
  const { fetchMock } = mockModel({ candidates: candidatesResponse() });
  const auth = mock.method(dependencies, "getCurrentUser", async () => {
    throw new Error("offline");
  });
  assert.equal((await POST(upload())).status, 503);
  auth.mock.mockImplementation(async () => ({ id: userId }));
  mock.method(dependencies, "reserveSolve", async () => {
    throw new Error("offline");
  });
  assert.equal((await POST(upload())).status, 503);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("a first solve makes the candidates call and the winner's explanation call, and saves the result", async () => {
  const { requests } = mockModel({ candidates: candidatesResponse() });
  const save = mock.method(dependencies, "saveProblem");
  const response = await POST(upload());
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(requests.candidates.length, 1);
  assert.equal(requests.explanation.length, 1);
  assert.equal(data.problemId, problemId);
  assert.equal(data.selectedMethodId, "intercept-read");
  assert.equal(data.cached, false);
  assert.match(data.cacheKey, /^[0-9a-f]{64}\.[0-9a-f]{24}$/);
  assert.deepEqual(data.methods.map((method: { id: string }) => method.id), ["intercept-read", "factoring"]);
  assert.deepEqual(data.methods[0].badges, ["Recommended"]);
  assert.deepEqual(data.methods[1].badges, ["Most algebra"]);
  assert.equal(data.methods[0].mathLevel, "low");
  assert.equal(data.methods[1].shape, "no calculator · factoring · 1 algebra step");
  assert.equal(data.solution.trick, "Read the intercepts");
  assert.equal(data.solution.method, "desmos");
  assert.deepEqual(data.solution.expressions, [{ latex: "y=x^2-9", purpose: explanation().purposes[0] }]);
  assert.equal(data.solution.why, explanation().why);
  const input = save.mock.calls[0].arguments[0];
  assert.equal(input.userId, userId);
  assert.deepEqual(input.bytes, png);
  assert.deepEqual(input.solution, data.solution);
});

test("storage failure preserves a usable solution and explicitly reports it was not saved", async () => {
  mockModel({ candidates: candidatesResponse() });
  mock.method(dependencies, "saveProblem", async () => {
    throw new Error("storage offline");
  });
  const data = await (await POST(upload())).json();
  assert.equal(data.problemId, null);
  assert.equal(data.solution.answer, "3");
  assert.match(data.historyWarning, /could not be saved/);
});

test("unsuitable content produces clarification without a guessed answer, and is never cached", async () => {
  const clarification = "There are multiple questions. Crop the image to one question.";
  const { requests } = mockModel({
    candidates: candidatesResponse([], { status: "needs_clarification", question: "", clarification }),
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const data = await (await POST(upload())).json();
    assert.equal(data.solution.status, "needs_clarification");
    assert.equal(data.solution.answer, "");
    assert.deepEqual(data.solution.expressions, []);
    assert.equal(data.solution.clarification, clarification);
    assert.deepEqual(data.methods, []);
    assert.equal(data.cacheKey, null);
  }
  assert.equal(requests.candidates.length, 2, "an unreadable upload is asked again, not replayed from cache");
  assert.equal(requests.explanation.length, 0);
});

test("rejects missing, empty, unsupported, and disguised uploads before contacting AI", async () => {
  assert.equal((await POST(new Request("http://localhost/api/solve", { method: "POST", body: new FormData() }))).status, 400);
  assert.equal((await POST(upload(new Uint8Array()))).status, 400);
  assert.equal((await POST(upload(png, "image/gif"))).status, 415);
  assert.equal((await POST(upload(Buffer.from("This is not a PNG")))).status, 415);
  assert.equal((await POST(upload(png, "image/jpeg"))).status, 415);
});

test("regression test 10: the request shape is exactly one image — a mode (or any other) field is rejected", async () => {
  const { fetchMock } = mockModel({ candidates: candidatesResponse() });
  const withMode = new FormData();
  withMode.append("image", new File([png], "one.png", { type: "image/png" }));
  withMode.append("mode", "weaponized");
  const response = await POST(new Request("http://localhost/api/solve", { method: "POST", body: withMode }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /only the screenshot/);

  const two = new FormData();
  two.append("image", new File([png], "one.png", { type: "image/png" }));
  two.append("image", new File([png], "two.png", { type: "image/png" }));
  assert.equal((await POST(new Request("http://localhost/api/solve", { method: "POST", body: two }))).status, 400);
  const extra = new FormData();
  extra.append("image", new File([png], "one.png", { type: "image/png" }));
  extra.append("extra-image", new File([png], "two.png", { type: "image/png" }));
  assert.equal((await POST(new Request("http://localhost/api/solve", { method: "POST", body: extra }))).status, 400);
  const malformed = new Request("http://localhost/api/solve", {
    method: "POST",
    headers: { "Content-Type": "multipart/form-data; boundary=broken" },
    body: "not multipart",
  });
  assert.equal((await POST(malformed)).status, 400);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("bounds uploads with and without a Content-Length header", async () => {
  const excessive = upload();
  excessive.headers.set("Content-Length", String(MAX_IMAGE_BYTES + 100_000));
  assert.equal((await POST(excessive)).status, 413);
  assert.equal((await POST(upload(new Uint8Array(MAX_IMAGE_BYTES + 1)))).status, 413);
  const oversized = new Request("http://localhost/api/solve", {
    method: "POST",
    headers: { "Content-Type": "multipart/form-data; boundary=test" },
    body: new Uint8Array(MAX_IMAGE_BYTES + 100_000),
  });
  assert.equal((await POST(oversized)).status, 413);
});

test("reports a missing server key without calling the provider", async () => {
  delete process.env.OPENAI_API_KEY;
  const result = await POST(upload());
  assert.equal(result.status, 503);
  assert.match((await result.json()).error, /OPENAI_API_KEY/);
});

test("the candidates call is terse, strict, cached by prefix, and sees the image; the explanation call sees only the chosen rows", async () => {
  const { requests } = mockModel({ candidates: candidatesResponse() });
  const result = await POST(upload());
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.match(result.headers.get("server-timing") ?? "", /methods;dur=[\d.]+, complete;dur=[\d.]+, cache;desc="miss", explanation;desc="model", calls;desc="1\+1"/);
  const [call1] = requests.candidates;
  const [call2] = requests.explanation;
  for (const body of [call1, call2]) {
    assert.equal(body.model, "gpt-5-mini");
    assert.equal(body.store, false);
    assert.equal(body.service_tier, "priority");
    assert.deepEqual(body.reasoning, { effort: "low" });
    const text = body.text as { verbosity: string; format: { strict: boolean; type: string } };
    assert.equal(text.format.strict, true);
    assert.equal(text.format.type, "json_schema");
    assert.equal(text.verbosity, "low");
  }
  assert.equal(call1.prompt_cache_key, "desmo-candidates-v1");
  assert.equal(call2.prompt_cache_key, "desmo-explanation-v1");
  const instructions = String(call1.instructions);
  for (const pattern of [
    /DESMO SAT MATH STRATEGY LIBRARY/,
    /\[technique: three-point-regression \| Three-point regression\]/,
    /<gold_solutions>/,
    /"techniqueId": "identity-regression"/,
    /CANDIDATE CONTRACT/,
    /COST COMPONENTS/,
    /DESMOS SYNTAX SAFETY/,
    /ANSWER CONSISTENCY CONTRACT/,
    /REPRESENTATION \/ MODELING QUESTIONS/,
    /calculator starts in DEGREES/,
    /NEVER solve the problem traditionally first and then reverse-engineer/,
  ]) {
    assert.match(instructions, pattern);
  }
  assert.match(JSON.stringify(call1.input), /data:image\/png;base64,/);
  const schema = (call1.text as { format: { schema: { properties: Record<string, { items?: { properties: Record<string, unknown> } }> } } }).format.schema;
  const order = Object.keys(schema.properties);
  assert.ok(order.indexOf("structure") < order.indexOf("candidates"), "the structure is recognized before any candidate");
  assert.ok(order.indexOf("structure") < order.indexOf("library") && order.indexOf("library") < order.indexOf("candidates"), "the library is searched after the structure and before any candidate");
  const candidateFields = Object.keys(schema.properties.candidates.items!.properties);
  assert.deepEqual(candidateFields.slice(0, 4), ["techniqueId", "strategy", "rung", "rows"]);
  assert.ok(candidateFields.includes("cost"));
  for (const prose of ["why", "purpose", "purposes", "readAnswer", "steps", "trick", "name"]) {
    assert.equal(candidateFields.includes(prose), false, `no ${prose} prose in the candidates call`);
  }
  assert.doesNotMatch(JSON.stringify(call2.input), /data:image/, "the explanation call does not resend the image");
  assert.match(JSON.stringify(call2.input), /y=x\^2-9/);
  assert.match(JSON.stringify(call2.input), /Technique: Read the intercepts/);
});

test("does not send GPT-5 reasoning options for another model, and honors a configured effort", async () => {
  process.env.OPENAI_MODEL = "gpt-4.1-mini";
  let model = mockModel({ candidates: candidatesResponse() });
  assert.equal((await POST(upload())).status, 200);
  for (const body of [...model.requests.candidates, ...model.requests.explanation]) {
    assert.equal(body.reasoning, undefined);
    assert.equal((body.text as { verbosity?: string }).verbosity, undefined);
  }
  mock.restoreAll();
  delete process.env.OPENAI_MODEL;
  process.env.OPENAI_REASONING_EFFORT = "medium";
  cache = createMemorySolveCache();
  model = mockModel({ candidates: candidatesResponse() });
  assert.equal((await POST(upload())).status, 200);
  assert.deepEqual(model.requests.candidates[0].reasoning, { effort: "medium" });
});

test("handles model refusal without exposing the provider payload", async () => {
  mockModel({
    candidates: () =>
      Response.json({
        ...providerBody(candidatesResponse()),
        output: [{ type: "message", content: [{ type: "refusal", refusal: "private provider payload" }] }],
      }),
  });
  const result = await POST(upload());
  assert.equal(result.status, 422);
  assert.doesNotMatch(await result.text(), /private provider payload/);
});

test("maps authentication, quota, rate, model, image, and service errors to honest messages that expose no internals", async () => {
  for (const [upstreamStatus, code, status, message] of [
    [401, "invalid_api_key", 503, /^Service temporarily unavailable/],
    [429, "insufficient_quota", 503, /^Service temporarily unavailable/],
    [429, "rate_limit_exceeded", 429, /busy right now/],
    [404, "model_not_found", 503, /^Service temporarily unavailable/],
    [400, "invalid_image", 400, /could not read/],
    [500, "server_error", 502, /AI service/],
  ] as const) {
    mock.restoreAll();
    mock.method(console, "error", () => undefined);
    const fetchMock = mock.method(globalThis, "fetch", async () =>
      Response.json({ error: { code, message: "private provider payload" } }, { status: upstreamStatus }),
    );
    const result = await POST(upload());
    assert.equal(result.status, status);
    const error = (await result.json()).error;
    assert.match(error, message);
    assert.doesNotMatch(error, /private provider payload|unit-test-key|OPENAI_|\.env|billing|credits/);
    assert.equal(fetchMock.mock.callCount(), 1, "does not automatically retry paid requests");
  }
  // In development, a configuration problem still names its fix.
  const environment = process.env.NODE_ENV;
  (process.env as Record<string, string | undefined>).NODE_ENV = "development";
  try {
    mock.restoreAll();
    mock.method(console, "error", () => undefined);
    mock.method(console, "info", () => undefined);
    mock.method(globalThis, "fetch", async () => Response.json({ error: { code: "invalid_api_key", message: "x" } }, { status: 401 }));
    assert.match((await (await POST(upload())).json()).error, /OPENAI_API_KEY/);
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = environment;
  }
});

test("returns a retryable timeout error", async () => {
  mock.method(Responses.prototype, "create", async () => {
    throw new OpenAI.APIConnectionTimeoutError();
  });
  const result = await POST(upload());
  assert.equal(result.status, 504);
  assert.match((await result.json()).error, /took too long/);
});

test("service tier can be disabled and falls back permanently when the project lacks priority access", async () => {
  process.env.OPENAI_SERVICE_TIER = "default";
  const model = mockModel({ candidates: candidatesResponse() });
  assert.equal((await POST(upload())).status, 200);
  assert.equal(model.requests.candidates[0].service_tier, undefined);

  delete process.env.OPENAI_SERVICE_TIER;
  mock.restoreAll();
  const handler = createSolveHandler(dependencies);
  const tiers: unknown[] = [];
  mock.method(globalThis, "fetch", async (_input: unknown, options?: RequestInit) => {
    const body = JSON.parse(String(options?.body));
    tiers.push(body.service_tier);
    if (body.service_tier === "priority") {
      return Response.json({ error: { code: "invalid_value", message: "Invalid value: 'priority' for service_tier." } }, { status: 400 });
    }
    return Response.json(providerBody(body.text.format.name === "desmo_explanation" ? explanation() : candidatesResponse()));
  });
  cache = createMemorySolveCache();
  assert.equal((await handler(upload())).status, 200);
  cache = createMemorySolveCache();
  assert.equal((await handler(upload())).status, 200);
  assert.deepEqual(tiers, ["priority", undefined, undefined, undefined, undefined], "asks for priority once, then never again");
});

test("regression test 1: the same problem twice returns identical methods, order, and winner with no second model call", async () => {
  const { requests } = mockModel({ candidates: candidatesResponse() });
  const first = await (await POST(upload())).json();
  const second = await (await POST(upload())).json();
  assert.equal(requests.candidates.length, 1);
  assert.equal(requests.explanation.length, 1, "the second solve makes no model call at all");
  assert.equal(second.cached, true);
  assert.equal(second.cacheKey, first.cacheKey);
  assert.equal(second.selectedMethodId, first.selectedMethodId);
  assert.deepEqual(second.methods, first.methods);
  assert.deepEqual(second.solution, first.solution);
});

test("regression test 2: the same problem as a differently cropped screenshot hits the same cache key", async () => {
  // Two transcriptions of one problem that differ only in notation and spacing.
  const { requests } = mockModel({
    candidates: (_body: unknown, call: number) =>
      call === 1 ? candidatesResponse() : candidatesResponse([paperCandidate(), graphCandidate({ cost: { ...zeroCost, setupConstructions: 3 } })], { question: "What is the positive solution to x^2=9?" }),
  });
  const first = await (await POST(upload(png))).json();
  const cropped = await otherScreenshot();
  const second = await (await POST(upload(cropped))).json();
  assert.equal(second.cacheKey, first.cacheKey);
  assert.equal(second.cached, true);
  assert.deepEqual(second.methods, first.methods, "the cached methods win over the fresh transcription's candidates");
  assert.equal(second.selectedMethodId, first.selectedMethodId);
  assert.equal(requests.candidates.length, 2, "a new screenshot still needs its text read");
  assert.equal(requests.explanation.length, 1, "the explanation comes from the cache");
  // The cropped screenshot is now remembered too: a third upload makes no call.
  await POST(upload(cropped));
  assert.equal(requests.candidates.length, 2);
});

test("integer factor maximum returns 421 through the shared solve API, not one regression branch", async () => {
  const question = "12x^18+kx^9+35 has factors ax^9+b and cx^9+d, where a, b, c, and d are all integer constants. What is the maximum value of k?";
  const fit = graphCandidate({
    techniqueId: "identity-regression",
    rows: [
      { latex: "u=[1...5]", slider: null, copiesRow: null },
      { latex: "(au+b)(cu+d)\\sim12u^2+ku+35", slider: null, copiesRow: null },
      { latex: "k", slider: null, copiesRow: null },
    ],
    answer: "47",
    result: { type: "numeric", row: 3, relatedRows: [], value: 47, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "one fitted k" },
  });
  mockModel({
    candidates: candidatesResponse([fit], { question, choices: null }),
    explanation: explanation(6, {
      why: "The two factor products fix the leading and constant coefficients. Desmos checks every signed divisor pair and compares all middle coefficients.",
      readAnswer: "Read the maximum on line 6: 421.",
    }),
  });
  const response = await POST(upload());
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.selectedMethodId, "integer-list-filter");
  assert.equal(data.solution.answer, "421");
  assert.equal(data.solution.result.value, 421);
  assert.equal(data.solution.expressions[5].latex, "\\operatorname{max}(k_{1})");
});

test("regression test 3: a prompt configuration change is a cache miss and regenerates", async () => {
  const { requests } = mockModel({ candidates: candidatesResponse() });
  const first = await (await POST(upload())).json();
  process.env.OPENAI_MODEL = "gpt-5-nano";
  const second = await (await POST(upload())).json();
  assert.notEqual(second.cacheKey, first.cacheKey);
  assert.equal(second.cacheKey.split(".")[0], first.cacheKey.split(".")[0], "same problem, new configuration version");
  assert.equal(second.cached, false);
  assert.equal(requests.candidates.length, 2);
  assert.equal(requests.explanation.length, 2);
});

test("regression test 9: a method switch returns cached rows with no model call; its explanation is generated once, then cached", async () => {
  const paperExplanation = explanation(0, { why: "Factoring turns the equation into two simple factors." });
  const { requests } = mockModel({
    candidates: candidatesResponse(),
    explanation: (body: { input: unknown }) => (JSON.stringify(body.input).includes("Technique: Factoring") ? paperExplanation : explanation()),
  });
  const solved = await (await POST(upload())).json();
  assert.equal(requests.explanation.length, 1);

  const stream = await events(await SWITCH(switchTo(solved.cacheKey, "factoring", { Accept: "application/x-ndjson" })));
  assert.equal(stream[0].type, "methods");
  assert.equal(stream[0].method.id, "factoring");
  assert.deepEqual(stream[0].method.rows, [], "the rows come straight from the cache");
  assert.equal(stream[1].type, "solution");
  assert.equal(stream[1].explanation, "model");
  assert.equal(stream[1].solution.trick, "Factoring");
  assert.equal(stream[1].solution.method, "algebra");
  assert.deepEqual(stream[1].solution.steps, paperExplanation.steps);
  assert.equal(requests.candidates.length, 1, "switching never re-generates candidates");
  assert.equal(requests.explanation.length, 2, "the paper explanation was generated once");

  const again = await (await SWITCH(switchTo(solved.cacheKey, "factoring"))).json();
  assert.equal(again.explanation, "cache");
  assert.deepEqual(again.solution, stream[1].solution);
  const back = await (await SWITCH(switchTo(solved.cacheKey, "intercept-read"))).json();
  assert.deepEqual(back.solution, solved.solution);
  assert.equal(requests.explanation.length, 2, "both explanations are now cached");
});

test("the technique selector's data: every eligible method carries its graph bounds, slider state, and readout, and a rejected candidate never appears", async () => {
  const slider = graphCandidate({
    techniqueId: "shared-zero",
    rung: 3,
    rows: [
      { latex: "b=1", slider: { min: 1, max: 10, step: 1 }, copiesRow: null },
      { latex: "y=x+2b", slider: null, copiesRow: null },
      { latex: "y=3x^2+25x+14b", slider: null, copiesRow: null },
    ],
    answer: "3",
    result: { type: "slider_condition", row: 1, relatedRows: [2, 3], value: null, listIndex: null, answerFrom: "reasoning", choiceLabel: null, detail: "b where the graphs share an x-intercept" },
    answerState: { param: "b", value: 3 },
  });
  // A candidate whose rows fail to insert: eligible from the model's point of
  // view, but the server rejects it before it ever reaches the client.
  const broken = graphCandidate({ techniqueId: "factoring", rows: [{ latex: "y=x^2-9\\text{ then read it}", slider: null, copiesRow: null }] });
  mockModel({ candidates: candidatesResponse([slider, broken], { question: "x + 2b is a factor of 3x^2 + 25x + 14b, where b is a positive integer constant. What is the value of b?" }) });
  const data = await (await POST(upload())).json();

  assert.deepEqual(
    data.methods.map((method: { techniqueId: string }) => method.techniqueId),
    ["shared-zero"],
    "the rejected candidate is never sent to the client",
  );
  const [method] = data.methods;
  assert.deepEqual(method.answerState, { param: "b", value: 3 });
  assert.deepEqual(method.graphBounds, { left: -5, right: 5, bottom: -12, top: 12 });
  assert.equal(method.result.detail, "b where the graphs share an x-intercept");
  assert.deepEqual(method.parameters, [{ name: "b", integer: true, min: -1000, max: 1000 }]);
  assert.equal(method.mathLevel, "low");
  assert.equal(method.shape, "3 rows · slider · no algebra");
  assert.ok(Array.isArray(method.badges));
  assert.equal("rejected" in method, false, "rejection bookkeeping is not part of the client payload");
  assert.equal("repairs" in method, false);
});

test("a single-candidate solve still returns a one-element methods array, not an empty one", async () => {
  mockModel({ candidates: candidatesResponse([graphCandidate()]) });
  const data = await (await POST(upload())).json();
  assert.equal(data.methods.length, 1);
  assert.equal(data.selectedMethodId, data.methods[0].id);
});

test("an algebra-only reply to the rational table problem offers Desmos first and keeps substitution selectable", async () => {
  const question = "The function g is defined by g(x)=f(x)/(x+2), where f is a quadratic function. " +
    "The y-intercept of f is (0,10). The table shows x = 1, 4 and g(x) = 5, 7. What is g(3)?";
  mockModel({
    candidates: candidatesResponse([
      paperCandidate({
        techniqueId: "substitution",
        answer: "31/5",
        result: {
          type: "written", row: null, relatedRows: [], value: null, listIndex: null,
          answerFrom: "reasoning", choiceLabel: null, detail: "the value after solving for f",
        },
        cost: { ...zeroCost, derivationSteps: 4 },
      }),
    ], { question }),
    explanation: (body: { input: unknown }) => JSON.stringify(body.input).includes("Technique: Substitution")
      ? explanation(0, {
        why: "The intercept and table give three values for the quadratic f, enough to determine its coefficients.",
        steps: [
          "The intercept gives f(0)=10, so the constant term of f(x)=ax^2+bx+c is c=10.",
          "From g(1)=5 and g(4)=7, compute f(1)=5(1+2)=15 and f(4)=7(4+2)=42.",
          "Then a+b+10=15 and 16a+4b+10=42, giving a=1 and b=4; f(3)=31, so g(3)=31/5.",
        ],
        readAnswer: null,
      })
      : explanation(6, {
        why: "Keep f(0)=10 in the quadratic and let Desmos fit the two unknown coefficients from the g table.",
        readAnswer: "Line 6 displays g(3)=6.2, which is 31/5.",
      }),
  });
  const solved = await POST(upload());
  assert.equal(solved.status, 200);
  const data = await solved.json();
  assert.deepEqual(data.methods.map((method: { id: string }) => method.id), ["parameter-regression", "substitution"]);
  assert.equal(data.selectedMethodId, "parameter-regression");
  assert.deepEqual(data.solution.expressions.map((row: { latex: string }) => row.latex).at(-1), "g(3)");
  assert.equal(data.solution.answer, "6.2");

  const switched = await SWITCH(switchTo(data.cacheKey, "substitution"));
  assert.equal(switched.status, 200);
  const alternative = await switched.json();
  assert.equal(alternative.solution.method, "algebra");
  assert.equal(alternative.solution.answer, "31/5");
});

test("no solver-mode remnant survives in the workspace UI: no segmented control, no mode field, no dead badge usage", () => {
  const workspace = readFileSync("src/app/solve/solver-workspace.tsx", "utf8");
  const css = readFileSync("src/app/solve/page.module.css", "utf8");
  for (const pattern of [/Weaponized/i, /Desmos First/i, /Fastest SAT/i, /mode/i, /segmented/i]) {
    assert.doesNotMatch(workspace, pattern, `solver-workspace.tsx must not reference ${pattern}`);
  }
  assert.doesNotMatch(css, /\.modeOption|\.modes\b|\.modeSelected|\.modeHint/, "no dead mode CSS in page.module.css");
  assert.match(workspace, /TechniqueSelector/, "the technique selector replaces the mode control");
});

test("method switch rejects unknown solves, unknown methods, bad bodies, and anonymous callers", async () => {
  const { requests } = mockModel({ candidates: candidatesResponse() });
  const solved = await (await POST(upload())).json();
  assert.equal((await SWITCH(switchTo("missing.key", "factoring"))).status, 404);
  assert.equal((await SWITCH(switchTo(solved.cacheKey, "graph-both-sides"))).status, 404);
  const bad = new Request("http://localhost/api/solve/method", { method: "POST", body: JSON.stringify({ cacheKey: solved.cacheKey, methodId: "factoring", mode: "fastest" }) });
  assert.equal((await SWITCH(bad)).status, 400);
  mock.method(dependencies, "getCurrentUser", async () => null);
  assert.equal((await SWITCH(switchTo(solved.cacheKey, "factoring"))).status, 401);
  assert.equal(requests.explanation.length, 1);
});

test("streaming sends the calculator rows and answer before the explanation", async () => {
  mockModel({ candidates: candidatesResponse() });
  const response = await POST(upload(png, "image/png", { Accept: "application/x-ndjson" }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/x-ndjson");
  assert.match(response.headers.get("server-timing") ?? "", /methods;dur=.*model_candidates;dur=/);
  const [methods, solution, saved] = await events(response);
  assert.equal(methods.type, "methods");
  assert.equal(methods.selectedMethodId, "intercept-read");
  assert.deepEqual(methods.methods[0].rows, [{ latex: "y=x^2-9", slider: null }]);
  assert.equal(methods.methods[0].answer, "3");
  assert.equal(solution.type, "solution");
  assert.equal(solution.solution.why, explanation().why);
  // The explanation never waits on history storage: the save is its own, later event.
  assert.equal(solution.problemId, undefined);
  assert.equal(saved.type, "saved");
  assert.equal(saved.problemId, problemId);
});

test("a stream whose history save fails still delivers the explanation first, then the warning", async () => {
  mockModel({ candidates: candidatesResponse() });
  dependencies.saveProblem = async () => {
    throw new Error("storage down");
  };
  const response = await POST(upload(png, "image/png", { Accept: "application/x-ndjson" }));
  const [, solution, saved] = await events(response);
  assert.equal(solution.type, "solution");
  assert.equal(solution.solution.answer, "3");
  assert.equal(saved.type, "saved");
  assert.equal(saved.problemId, null);
  assert.match(saved.historyWarning, /could not be saved/);
});

test("an explanation failure still shows the rows and answer with a generated summary, and is not cached", async () => {
  let failing = true;
  const { requests } = mockModel({
    candidates: candidatesResponse(),
    explanation: () => (failing ? Response.json({ error: { code: "server_error", message: "down" } }, { status: 500 }) : explanation()),
  });
  const first = await (await POST(upload())).json();
  assert.equal(first.solution.answer, "3");
  assert.deepEqual(first.solution.expressions.map((row: { latex: string }) => row.latex), ["y=x^2-9"]);
  assert.match(first.solution.why, /detailed explanation.*did not load/i);
  assert.match(first.solution.readAnswer, /Line 1 shows the positive x-intercept = 3/);
  failing = false;
  const second = await (await POST(upload())).json();
  assert.equal(second.solution.why, explanation().why, "the real explanation replaces the summary once available");
  assert.equal(requests.candidates.length, 1);
});

test("a malformed explanation is corrected once, then cached", async () => {
  const { requests } = mockModel({
    candidates: candidatesResponse(),
    explanation: (_body: unknown, call: number) => (call === 1 ? explanation(3) : explanation()),
  });
  const data = await (await POST(upload())).json();
  assert.equal(data.solution.why, explanation().why);
  assert.equal(requests.explanation.length, 2);
  assert.match(JSON.stringify(requests.explanation[1].input), /REJECTED by the server at explanation: purposes must have exactly one entry per calculator row: expected 1, got 3/);
});

test("a placeholder calculator-row explanation gets one guided correction", async () => {
  const { requests } = mockModel({
    candidates: candidatesResponse([graphCandidate()]),
    explanation: (_body: unknown, call: number) => call === 1
      ? explanation(1, { purposes: ["Graph the equation."] })
      : explanation(1, { purposes: ["Graph the given equation so Desmos shows its x-intercepts; the positive one is the requested solution."] }),
  });
  const data = await (await POST(upload())).json();
  assert.equal(requests.explanation.length, 2);
  assert.match(JSON.stringify(requests.explanation[1].input), /explanation_quality: Line 1 needs the given information/);
  assert.match(data.solution.expressions[0].purpose, /positive one is the requested solution/);
});

test("a many-step written method cannot hide its derivation in one solve-it sentence", async () => {
  const { requests } = mockModel({
    candidates: candidatesResponse([paperCandidate({ cost: { ...zeroCost, derivationSteps: 3 } })]),
    explanation: (_body: unknown, call: number) => call === 1
      ? explanation(0, { steps: ["Solve x² = 9 to get 3."] })
      : explanation(0, { steps: [
          "Rewrite x²=9 as x²-9=0.",
          "Factor x²-9=(x-3)(x+3), giving x=3 or x=-3; choose positive 3.",
        ] }),
  });
  const data = await (await POST(upload())).json();
  assert.equal(requests.explanation.length, 2);
  assert.match(JSON.stringify(requests.explanation[1].input), /explanation_quality: This written method has several derivation steps/);
  assert.equal(data.solution.steps.length, 2);
  assert.equal(data.solution.answer, "3");
});

test("when a written explanation is unavailable, the fallback admits that its steps are missing", async () => {
  mockModel({
    candidates: candidatesResponse([paperCandidate()]),
    explanation: Response.json({ error: { code: "server_error", message: "down" } }, { status: 500 }),
  });
  const data = await (await POST(upload())).json();
  assert.equal(data.explanation, "fallback");
  assert.match(data.solution.why, /detailed explanation.*did not load/i);
  assert.match(data.solution.steps[0], /written steps did not load/i);
  assert.doesNotMatch(data.solution.steps[0], /apply .* answer is/i);
});

test("when every candidate is rejected, call 1 is retried once with the reasons; a second rejection fails loudly", async () => {
  const broken = candidatesResponse([graphCandidate({ rows: [{ latex: "y=x^2-9\\text{ then read it}", slider: null, copiesRow: null }] })]);
  let model = mockModel({ candidates: (_body: unknown, call: number) => (call === 1 ? broken : candidatesResponse()) });
  const recovered = await POST(upload());
  assert.equal(recovered.status, 200);
  assert.equal(model.requests.candidates.length, 2);
  assert.match(JSON.stringify(model.requests.candidates[1].input), /REJECTED by the server at desmos_syntax: Every candidate was rejected: Read the intercepts \(row-fails-to-insert\)/);

  mock.restoreAll();
  cache = createMemorySolveCache();
  model = mockModel({ candidates: broken });
  const save = mock.method(dependencies, "saveProblem");
  const failed = await POST(upload());
  assert.equal(failed.status, 502);
  assert.equal(model.requests.candidates.length, 2, "no third paid attempt");
  assert.equal(save.mock.callCount(), 0);
});

test("a single real technique is accepted without asking for a second one", async () => {
  const { requests } = mockModel({ candidates: candidatesResponse([graphCandidate()]) });
  const data = await (await POST(upload())).json();
  assert.equal(data.methods.length, 1);
  assert.equal(requests.candidates.length, 1);
});

test("slider rows keep their bounds, the calculator opens at the answer state, and plain rows stay {latex, purpose}", async () => {
  const slider = graphCandidate({
    techniqueId: "shared-zero",
    rung: 3,
    rows: [
      { latex: "b=1", slider: { min: 1, max: 10, step: 1 }, copiesRow: null },
      { latex: "y=x+2b", slider: null, copiesRow: null },
      { latex: "y=3x^2+25x+14b", slider: null, copiesRow: null },
    ],
    answer: "3",
    result: { type: "slider_condition", row: 1, relatedRows: [2, 3], value: null, listIndex: null, answerFrom: "reasoning", choiceLabel: null, detail: "b where the graphs share an x-intercept" },
    answerState: { param: "b", value: 3 },
    cost: { ...zeroCost, manualIterations: 1 },
  });
  mockModel({
    candidates: candidatesResponse([slider], { question: "x + 2b is a factor of 3x^2 + 25x + 14b, where b is a positive integer constant. What is the value of b?" }),
    explanation: explanation(3),
  });
  const data = await (await POST(upload())).json();
  assert.deepEqual(data.solution.expressions[0].slider, { min: 1, max: 10, step: 1 });
  assert.equal("slider" in data.solution.expressions[1], false);
  assert.deepEqual(data.solution.answerState, { param: "b", value: 3 });
  assert.deepEqual(data.solution.parameters, [{ name: "b", integer: true, min: -1000, max: 1000 }], "the question's integer parameter is recorded");
});

test("development rejection exposes the exact stage and stores the raw response without request credentials", async (t) => {
  const previous = process.env.NODE_ENV;
  Object.assign(process.env, { NODE_ENV: "development" });
  t.after(() => {
    if (previous === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
    else Object.assign(process.env, { NODE_ENV: previous });
  });
  mock.method(console, "error", () => undefined);
  const invalid = candidatesResponse([graphCandidate({ result: { ...graphCandidate().result, type: "numeric", row: null } })]);
  const { requests } = mockModel({ candidates: invalid });
  const response = await POST(upload());
  assert.equal(response.status, 502);
  assert.equal(requests.candidates.length, 2);
  const rejected = await response.json();
  assert.equal(rejected.validation.stage, "result_contract");
  assert.match(rejected.error, /numeric requires an existing calculator row/);
  for (const attempt of [1, 2]) {
    const file = `.desmo-debug/${rejected.diagnosticId}-${attempt}.json`;
    t.after(() => unlink(file));
    const logged = await readFile(file, "utf8");
    const diagnostic = JSON.parse(logged);
    assert.equal(diagnostic.rejection.stage, "result_contract");
    assert.equal(diagnostic.response.output[0].content[0].text, JSON.stringify(invalid));
    assert.doesNotMatch(logged, /unit-test-key|data:image|Authorization/);
  }
});

test("a timed-out candidate call retries once within the route budget and preserves the usage record", async () => {
  process.env.CANDIDATES_TIMEOUT_MS = "80";
  try {
    const { requests } = mockModel({ candidates: (_body: unknown, call: number, signal?: AbortSignal) => call === 1 ? hang(signal) : candidatesResponse() });
    const response = await POST(upload());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).solution.answer, "3");
    assert.equal(requests.candidates.length, 2);
    assert.equal(usage.records.filter((record) => record.status === "timeout").length, 1);
    assert.equal(usage.records.filter((record) => record.status === "completed" && record.call === "candidates").length, 1);
  } finally {
    delete process.env.CANDIDATES_TIMEOUT_MS;
  }
});

test("regression test 4: candidates calls past CANDIDATES_TIMEOUT_MS stop after one bounded retry and record both costs", async () => {
  process.env.CANDIDATES_TIMEOUT_MS = "80";
  try {
    const { requests } = mockModel({ candidates: (_body: unknown, _call: number, signal?: AbortSignal) => hang(signal) });
    const variants: Record<string, string>[] = [{}, { Accept: "application/x-ndjson" }];
    for (const headers of variants) {
      const started = performance.now();
      const response = await POST(upload(png, "image/png", headers));
      assert.ok(performance.now() - started < 2_000, "no hanging request");
      assert.equal(response.status, 504);
      const body = await response.json();
      assert.equal(body.kind, "timeout");
      assert.match(body.error, /took too long.*stopped/);
    }
    assert.equal(requests.candidates.length, 4, "one recovery attempt per solve, then an honest timeout");
    const timedOut = usage.records.filter((record) => record.status === "timeout");
    assert.equal(timedOut.length, 4);
    assert.equal(timedOut[0].estimated, true, "OpenAI may have billed it; usage never arrives, so it is estimated high");
    assert.ok(timedOut[0].costUsd > 0.02);
  } finally {
    delete process.env.CANDIDATES_TIMEOUT_MS;
  }
});

test("regression test 4: an explanation past EXPLANATION_TIMEOUT_MS ends in a retryable failure, never a spinner", async () => {
  const { requests } = tangentModel();
  const solved = await (await POST(upload())).json();
  process.env.EXPLANATION_TIMEOUT_MS = "80";
  try {
    mock.restoreAll();
    mockModel({ candidates: candidatesResponse(), explanation: (_body: unknown, _call: number, signal?: AbortSignal) => hang(signal) });
    const started = performance.now();
    const stream = await events(await SWITCH(switchTo(solved.cacheKey, "discriminant", { Accept: "application/x-ndjson" })));
    assert.ok(performance.now() - started < 2_000);
    assert.equal(stream[0].type, "methods", "rows and answer arrive first");
    assert.equal(stream.at(-1).explanation, "fallback");
    assert.equal(explanationFromEvents(stream), null, "the client shows its retry");
    assert.ok(requests.explanation.length >= 1);
  } finally {
    delete process.env.EXPLANATION_TIMEOUT_MS;
  }
});

test("no model call can outlive the route's execution limit: too little time left means no paid request at all", async () => {
  const saved = dependencies.maxDurationSeconds;
  dependencies.maxDurationSeconds = 5.5; // a 500 ms deadline, under the 1 s minimum for a call
  try {
    const { requests } = mockModel({ candidates: candidatesResponse() });
    const response = await POST(upload());
    assert.equal(response.status, 504);
    assert.equal(requests.candidates.length, 0);
  } finally {
    dependencies.maxDurationSeconds = saved;
  }
});

test("regression test 3: every method errors in Desmos → one retry of call 1 with the Desmos errors attached; if its methods error too, an honest failure with no rows", async () => {
  const { requests } = mockModel({
    candidates: (_body: unknown, call: number) =>
      call === 1 ? calculatorOnly() : candidatesResponse([graphCandidate({ rows: [{ latex: "y=x^2-9", slider: null, copiesRow: null }] })]),
  });
  const solved = await (await POST(upload())).json();
  assert.deepEqual(solved.methods.map((method: { id: string }) => method.id), ["intercept-read", "graph-both-sides"]);

  const first = await PREFLIGHT(
    report(solved.cacheKey, [
      { methodId: "intercept-read", ...desmosError() },
      { methodId: "graph-both-sides", ...desmosError("Too many variables. Try defining 'q'.") },
    ]),
  );
  assert.equal(first.status, 200);
  const retried = await first.json();
  assert.equal(retried.status, "retry");
  assert.equal(retried.cacheKey, `${solved.cacheKey}.desmos-retry`);
  assert.equal(requests.candidates.length, 2, "exactly one retry");
  const retryInput = JSON.stringify(requests.candidates[1].input);
  assert.match(retryInput, /desmos_preflight/);
  assert.match(retryInput, /Cannot store a list of numbers in a list\./, "the retry sees each row's Desmos error");
  assert.match(retryInput, /Too many variables/);
  assert.match(retryInput, /y=x\^2-9/, "and the rows that produced it");

  const failed = await PREFLIGHT(report(retried.cacheKey, [{ methodId: "intercept-read", ...desmosError() }]));
  assert.equal(failed.status, 422);
  const failure = await failed.json();
  assert.equal(failure.status, "failed");
  assert.match(failure.error, /none is shown/);
  assert.equal("methods" in failure, false, "an honest failure carries no rows");
  assert.equal(requests.candidates.length, 2, "never a second retry");

  // Later solves of the problem reuse the verdicts: no model call, the same honest failure, no rows.
  const again = await POST(upload());
  assert.equal(again.status, 422);
  assert.equal("methods" in (await again.json()), false);
  assert.equal(requests.candidates.length, 2);
  assert.equal((await SWITCH(switchTo(solved.cacheKey, "graph-both-sides"))).status, 404, "an erroring method cannot be switched to");
});

test("Desmos retry cannot replace the checked integer-factor maximum with a wrong paper answer", async () => {
  const question = "12x^18+kx^9+35 has factors ax^9+b and cx^9+d, where a, b, c, and d are all integer constants. What is the maximum value of k?";
  const original = graphCandidate({
    techniqueId: "identity-regression",
    answer: "47",
    result: { type: "numeric", row: 1, relatedRows: [], value: 47, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "one fitted k" },
  });
  const wrongRetry = paperCandidate({
    techniqueId: "direct-arithmetic",
    answer: "47",
    result: { type: "written", row: null, relatedRows: [], value: null, listIndex: null, answerFrom: "reasoning", choiceLabel: null, detail: "a guessed coefficient" },
  });
  mockModel({
    candidates: (_body: unknown, call: number) => candidatesResponse(call === 1 ? [original] : [wrongRetry], { question, choices: null }),
    explanation: explanation(6, { readAnswer: "Read the maximum on line 6: 421." }),
  });
  const solved = await (await POST(upload())).json();
  assert.equal(solved.solution.answer, "421");
  const retried = await PREFLIGHT(report(solved.cacheKey, [{ methodId: "integer-list-filter", ...desmosError("Hypothetical calculator error") }]));
  assert.equal(retried.status, 422);
  const failure = await retried.json();
  assert.equal(failure.status, "failed");
  assert.equal("methods" in failure, false);
});

test("a method reported erroring is dropped from every later solve; the next clean one becomes the default, re-badged, with no re-check", async () => {
  const { requests } = mockModel({
    candidates: calculatorOnly(),
    explanation: (body: { input: unknown }) => explanation(JSON.stringify(body.input).includes("Technique: Graph both sides") ? 2 : 1),
  });
  const solved = await (await POST(upload())).json();
  assert.equal(solved.selectedMethodId, "intercept-read");
  assert.deepEqual(solved.methods.map((method: { verified: boolean }) => method.verified), [false, false], "nothing checked yet");

  const reply = await (await PREFLIGHT(report(solved.cacheKey, [{ methodId: "intercept-read", ...desmosError() }, { methodId: "graph-both-sides", status: "clean" }]))).json();
  assert.equal(reply.status, "ready");
  assert.equal(reply.selectedMethodId, "graph-both-sides");
  assert.deepEqual(reply.methods.map((method: { id: string }) => method.id), ["graph-both-sides"]);

  const hit = await (await POST(upload())).json();
  assert.equal(hit.cached, true);
  assert.equal(hit.selectedMethodId, "graph-both-sides");
  assert.deepEqual(hit.methods.map((method: { id: string; verified: boolean; badges: string[] }) => [method.id, method.verified, method.badges]), [["graph-both-sides", true, ["Recommended"]]]);
  assert.equal(hit.solution.trick, "Graph both sides");
  assert.equal(requests.candidates.length, 1, "a cache hit re-runs no validation and no model call");
  assert.equal(requests.explanation.length, 2, "only the new default's explanation was generated");

  // A stored verdict is never overwritten by a later report.
  await PREFLIGHT(report(solved.cacheKey, [{ methodId: "intercept-read", status: "clean" }]));
  assert.equal((await (await POST(upload())).json()).selectedMethodId, "graph-both-sides");
});

test("history saves the method the student sees: a winner reported erroring while its explanation was written is replaced", async () => {
  let key = "";
  const memory = cache;
  cache = { ...memory, putEntry: async (entry) => ((key = entry.cacheKey), memory.putEntry(entry)) };
  const paper = explanation(0, { why: "Factoring turns the equation into two simple factors." });
  mockModel({
    candidates: candidatesResponse(),
    explanation: (body: { input: unknown }) => {
      if (JSON.stringify(body.input).includes("Technique: Factoring")) return paper;
      // The browser's pre-flight report lands while the winner's explanation is being written.
      void memory.putPreflight(key, "intercept-read", { status: "error", errors: [{ row: 1, message: "Try adding 'y=' to the beginning of this equation." }] });
      return explanation();
    },
  });
  const save = mock.method(dependencies, "saveProblem");
  const stream = await events(await POST(upload(png, "image/png", { Accept: "application/x-ndjson" })));
  assert.equal(stream[0].type, "methods");
  assert.equal(stream[0].selectedMethodId, "intercept-read");
  const final = stream.find((event) => event.type === "solution");
  assert.equal(stream.at(-1).type, "saved");
  assert.equal(final.methodId, "factoring");
  assert.equal(final.solution.trick, "Factoring");
  assert.equal(save.mock.calls[0].arguments[0].solution.trick, "Factoring", "the saved method is the one that runs");
});

test("pre-flight reports are validated and need a signed-in, same-site caller", async () => {
  mockModel({ candidates: candidatesResponse() });
  const solved = await (await POST(upload())).json();
  assert.equal((await PREFLIGHT(report("missing.key", []))).status, 404);
  assert.equal((await PREFLIGHT(report(solved.cacheKey, [{ methodId: "intercept-read", status: "error", errors: [] }]))).status, 400, "an error names its rows");
  assert.equal((await PREFLIGHT(report(solved.cacheKey, [{ methodId: "intercept-read", status: "timeout" }]))).status, 400, "a timeout is not a verdict");
  // A row number past the method's last row is not a real report and is ignored.
  const ignored = await (await PREFLIGHT(report(solved.cacheKey, [{ methodId: "intercept-read", status: "error", errors: [{ row: 5, message: "x" }] }]))).json();
  assert.equal(ignored.selectedMethodId, "intercept-read");
  mock.method(dependencies, "getCurrentUser", async () => null);
  assert.equal((await PREFLIGHT(report(solved.cacheKey, []))).status, 401);
});

// ---- lazy explanations for non-default techniques --------------------------

function tangentModel(options: { failing?: Set<string> } = {}) {
  return mockModel({
    candidates: candidatesResponse(tangentCandidates(), { question: TANGENT_QUESTION }),
    explanation: (body: { input: unknown }) => {
      const technique = JSON.stringify(body.input).match(/Technique: ([^\\]+?)\\n/)?.[1] ?? "";
      if (options.failing?.has(technique)) return new Response(JSON.stringify({ error: { message: "upstream unavailable" } }), { status: 500 });
      return tangentExplanations()[technique] ?? explanation();
    },
  });
}

test("regression test 6: the first solve writes exactly one explanation, for the default technique only", async () => {
  const { requests } = tangentModel();
  const stream = await events(await POST(upload(png, "image/png", { Accept: "application/x-ndjson" })));
  assert.equal(stream[0].type, "methods");
  assert.deepEqual(
    stream[0].methods.map((method: { techniqueId: string }) => method.techniqueId),
    ["vertex-of-difference", "slider-condition", "derivative-regression", "discriminant"],
    "rows for every listed technique arrive up front: the Desmos ways, then one math way",
  );
  assert.ok(stream[0].methods.every((method: { rows: unknown[] }) => Array.isArray(method.rows)));
  assert.equal(requests.explanation.length, 1);
  assert.match(JSON.stringify(requests.explanation[0].input), /Technique: Vertex of the difference/);
  const solution = stream.find((event) => event.type === "solution");
  assert.equal(solution.methodId, "vertex-of-difference");
  assert.equal(solution.explanation, "model");
});

test("regression tests 1–3, 5: a non-default technique's explanation is written on first selection, streamed, cached, and its own", async () => {
  const { requests } = tangentModel();
  const solved = await (await POST(upload())).json();
  assert.equal(requests.explanation.length, 1);

  // 1 + 3: selecting a paper technique streams its rows first (none, so the
  // calculator clears), then a full explanation.
  const first = await events(await SWITCH(switchTo(solved.cacheKey, "discriminant", { Accept: "application/x-ndjson" })));
  assert.equal(first[0].type, "methods");
  assert.deepEqual(first[0].method.rows, [], "nothing left for the calculator: it clears");
  assert.equal(first[1].type, "solution");
  assert.equal(first[1].explanation, "model");
  const discriminant = explanationFromEvents(first);
  assert.ok(discriminant, "the client accepts it");
  assert.deepEqual(discriminant.expressions, []);
  assert.equal(discriminant.steps.length, 3, "the whole walkthrough, not one line");
  assert.equal(requests.explanation.length, 2, "one call, for the technique chosen");

  // 2: selecting it again is instant: served from the cache, no model call.
  const again = await events(await SWITCH(switchTo(solved.cacheKey, "discriminant", { Accept: "application/x-ndjson" })));
  assert.equal(again[1].explanation, "cache");
  assert.deepEqual(explanationFromEvents(again), discriminant);
  assert.equal(requests.explanation.length, 2);

  // 5: two techniques, two different ideas; neither is the problem-level structure line.
  const formula = explanationFromEvents(await events(await SWITCH(switchTo(solved.cacheKey, "slider-condition", { Accept: "application/x-ndjson" }))));
  assert.ok(formula);
  assert.notEqual(formula.why, discriminant.why);
  assert.notEqual(formula.why, solved.solution.why);
  for (const why of [formula.why, discriminant.why, solved.solution.why]) assert.notEqual(why, solved.structure);
});

test("regression test 4: a failed explanation is a retryable failure, not a blank panel, and is never cached", async () => {
  const failing = new Set(["Slider until it fits"]);
  const { requests } = tangentModel({ failing });
  const solved = await (await POST(upload())).json();
  const failed = await events(await SWITCH(switchTo(solved.cacheKey, "slider-condition", { Accept: "application/x-ndjson" })));
  assert.equal(failed[0].type, "methods", "the rows and answer still arrive");
  assert.equal(failed[0].method.answer, "25/12");
  assert.equal(failed[1].explanation, "fallback");
  assert.equal(explanationFromEvents(failed), null, "the one-line fallback counts as a failure the student can retry");
  assert.equal(await cache.getExplanation(solved.cacheKey, "slider-condition"), null, "a fallback is never cached");

  failing.clear();
  const retried = await events(await SWITCH(switchTo(solved.cacheKey, "slider-condition", { Accept: "application/x-ndjson" })));
  assert.equal(retried[1].explanation, "model");
  assert.equal(explanationFromEvents(retried)?.expressions.length, 3);
  assert.ok(requests.explanation.length >= 3);
});

test("root cause: with the cache tables missing, switching still finds the solve through this server's memory tier", async () => {
  // What production saw: PostgREST PGRST205 on every cache table.
  const missingTables = Object.fromEntries(
    ["lookupInput", "rememberInput", "getEntry", "putEntry", "getExplanation", "putExplanation", "getPreflight", "putPreflight"].map((name) => [
      name,
      async () => {
        throw new Error("solve cache read failed (solve_cache): PGRST205 Could not find the table 'public.solve_cache' in the schema cache");
      },
    ]),
  ) as unknown as SolveCache;
  const warnings: string[] = [];

  // Before: without a local tier the switch cannot find the solve (the 404 the client swallowed).
  cache = withCacheFallback(missingTables, (operation) => warnings.push(operation)) as typeof cache;
  const { requests } = tangentModel();
  const before = await (await POST(upload())).json();
  assert.equal((await SWITCH(switchTo(before.cacheKey, "discriminant"))).status, 404);

  // After: the route's local tier keeps the solve, so the explanation is written and then served again.
  cache = withCacheFallback(missingTables, (operation) => warnings.push(operation), createMemorySolveCache()) as typeof cache;
  const solved = await (await POST(upload())).json();
  const calls = requests.explanation.length;
  const first = await events(await SWITCH(switchTo(solved.cacheKey, "discriminant", { Accept: "application/x-ndjson" })));
  assert.equal(explanationFromEvents(first)?.steps.length, 3);
  assert.equal(requests.explanation.length, calls + 1);
  const second = await events(await SWITCH(switchTo(solved.cacheKey, "discriminant", { Accept: "application/x-ndjson" })));
  assert.equal(second[1].explanation, "cache");
  assert.equal(requests.explanation.length, calls + 1, "no second call");
  assert.ok(warnings.includes("getEntry"), "the database failure is still reported");
});

// ---- spend protection -------------------------------------------------------

/** The usage a real candidates call reported (dev log), as OpenAI returns it. */
const CANDIDATES_USAGE = {
  model: "gpt-5-mini-2025-08-07",
  service_tier: "priority",
  usage: { input_tokens: 28763, input_tokens_details: { cached_tokens: 28672 }, output_tokens: 1351, output_tokens_details: { reasoning_tokens: 832 }, total_tokens: 30114 },
};
const EXPLANATION_USAGE = {
  model: "gpt-5-mini-2025-08-07",
  service_tier: "priority",
  usage: { input_tokens: 1092, input_tokens_details: { cached_tokens: 0 }, output_tokens: 517, output_tokens_details: { reasoning_tokens: 192 }, total_tokens: 1609 },
};

test("regression test 3: each call's real usage is recorded per solve with its model, billed tier, and cost", async () => {
  mockModel({ candidates: candidatesResponse(), extra: { candidates: CANDIDATES_USAGE, explanation: EXPLANATION_USAGE } });
  const response = await POST(upload());
  assert.equal(response.status, 200);
  assert.equal(usage.records.length, 2);
  const [candidates, explained] = usage.records;
  assert.equal(candidates.solveId, explained.solveId, "both calls belong to one solve");
  assert.equal(candidates.userId, userId);
  assert.equal(candidates.call, "candidates");
  assert.equal(candidates.model, "gpt-5-mini-2025-08-07");
  assert.equal(candidates.serviceTier, "priority");
  assert.deepEqual(candidates.usage, { inputTokens: 28763, cachedTokens: 28672, outputTokens: 1351, reasoningTokens: 832, totalTokens: 30114 });
  assert.equal(candidates.costUsd, 0.006195);
  assert.equal(explained.call, "explanation");
  assert.equal(explained.costUsd, 0.002353, "1,092 × $0.45 + 517 × $3.60, per 1M");
  assert.equal(explained.cacheKey, (await response.json()).cacheKey, "rows carry the problem's cacheKey");
  assert.equal(candidates.estimated, false);
});

test("regression test 1: at the daily cap a user cannot start a new solve, but cached solves and method switches keep working", async () => {
  dependencies.limits = () => ({ freeSolvesPerDay: 1, dailySpendCeilingUsd: 1000 });
  const { requests } = tangentModel();
  const first = await (await POST(upload())).json();
  assert.equal(first.selectedMethodId, "vertex-of-difference", "the one free solve");
  const callsBefore = requests.candidates.length;

  // A new problem needs a model call: refused, with a clear message and no countdown.
  const blocked = await POST(upload(await otherScreenshot()));
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("retry-after"), null, "no countdown: waiting seconds does not help");
  const body = await blocked.json();
  assert.equal(body.kind, "daily_cap");
  assert.match(body.error, /today's 1 solves.*open again (?:in about \d+ hours|within the hour).*history/);
  assert.ok(Date.parse(body.resetsAt) > Date.now());
  assert.equal(requests.candidates.length, callsBefore, "zero model calls");

  // The same screenshot again is a cached solve: no model call, not counted, allowed.
  const cached = await POST(upload());
  assert.equal(cached.status, 200);
  assert.equal((await cached.json()).cached, true);
  assert.equal(requests.candidates.length, callsBefore);

  // Switching methods on the solved problem still works, explanation included.
  const switched = await events(await SWITCH(switchTo(first.cacheKey, "discriminant", { Accept: "application/x-ndjson" })));
  assert.equal(explanationFromEvents(switched)?.steps.length, 3);
  assert.equal(usage.solves.length, 1, "only the new solve was counted");

  // History reads never consult the limits.
  assert.doesNotMatch(await readFile("src/lib/problem-history.ts", "utf8"), /spend|limits|reserveDailySolve/);
});

test("regression test 2: over the daily spend ceiling new solves stop, loudly, while cached reads and switches continue", async () => {
  const { requests } = tangentModel();
  const first = await (await POST(upload())).json();
  dependencies.limits = () => ({ freeSolvesPerDay: 1000, dailySpendCeilingUsd: 0.01 });
  await usage.record({ ...usage.records[0], solveId: "earlier", costUsd: 0.02 });
  const alerts: string[] = [];
  mock.method(console, "error", (...args: unknown[]) => alerts.push(args.map(String).join(" ")));
  const callsBefore = requests.candidates.length;

  const blocked = await POST(upload(await otherScreenshot()));
  assert.equal(blocked.status, 503);
  const body = await blocked.json();
  assert.equal(body.kind, "at_capacity");
  assert.match(body.error, /at capacity today/);
  assert.equal(blocked.headers.get("retry-after"), null);
  assert.equal(requests.candidates.length, callsBefore, "zero model calls");
  assert.ok(alerts.some((line) => /\[desmo:ALERT\] ceiling_hit/.test(line)), "the trip is logged loudly");
  assert.equal(usage.solves.length, 1, "a refused solve does not count against the user");

  assert.equal((await POST(upload())).status, 200, "a cached solve is unaffected");
  const switched = await events(await SWITCH(switchTo(first.cacheKey, "slider-condition", { Accept: "application/x-ndjson" })));
  assert.ok(explanationFromEvents(switched), "method switching on a solved problem continues");
});

test("with the usage tables missing, new solves are refused (fail closed) and cached solves still work", async () => {
  const { requests } = tangentModel();
  assert.equal((await POST(upload())).status, 200);
  const missing = async () => {
    throw new Error("PGRST205 Could not find the table 'public.model_usage'");
  };
  usage = { ...usage, spentTodayUsd: missing, reserveDailySolve: missing, record: missing } as typeof usage;
  mock.method(console, "error", () => undefined);
  const refused = await POST(upload(await otherScreenshot()));
  assert.equal(refused.status, 503);
  assert.equal((await refused.json()).kind, "unavailable");
  assert.equal((await POST(upload())).status, 200, "the cached solve needs no model call and still works");
  assert.equal(requests.candidates.length, 1);
});

// ---- image upload limits ----------------------------------------------------

async function screenshotOf(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: { r: 250, g: 250, b: 250 } } }).png().toBuffer();
}

/** The image a candidates request actually sent, decoded from its data URL. */
async function sentImage(body: Record<string, unknown>) {
  const url = JSON.stringify(body.input).match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/)?.[1];
  assert.ok(url, "the request carried an image");
  return sharp(Buffer.from(url, "base64")).metadata();
}

test("regression test 5: an image over MAX_IMAGE_BYTES is refused by name, before any model call, rate-limit slot, or decode", async () => {
  process.env.MAX_IMAGE_BYTES = "2048";
  try {
    const { fetchMock } = mockModel({ candidates: candidatesResponse() });
    const reserve = mock.method(dependencies, "reserveSolve");
    const big = await sharp({ create: { width: 300, height: 300, channels: 3, background: { r: 10, g: 200, b: 90 } } }).png({ compressionLevel: 0 }).toBuffer();
    assert.ok(big.length > 2048);
    // As a browser sends it: a multipart body with its Content-Length.
    const form = new FormData();
    form.set("image", new File([new Uint8Array(big)], "question.png", { type: "image/png" }));
    const encoded = new Response(form);
    const body = Buffer.from(await encoded.arrayBuffer());
    const response = await POST(
      new Request("http://localhost/api/solve", {
        method: "POST",
        body,
        headers: { "content-type": encoded.headers.get("content-type")!, "content-length": String(body.length) },
      }),
    );
    assert.equal(response.status, 413);
    assert.match((await response.json()).error, /That screenshot is \d+ KB, over the 2 KB limit/, "names the size and the limit");
    assert.equal(fetchMock.mock.callCount(), 0, "zero model calls");
    assert.equal(reserve.mock.callCount(), 0, "not even a rate-limit slot");
  } finally {
    delete process.env.MAX_IMAGE_BYTES;
  }
});

test("regression test 6: a disallowed MIME type is refused by name before any model call", async () => {
  const { fetchMock } = mockModel({ candidates: candidatesResponse() });
  for (const [type, pattern] of [["image/gif", /GIF file \(image\/gif\)/], ["image/svg+xml", /SVG\+XML file/], ["application/pdf", /PDF file/]] as const) {
    const response = await POST(upload(png, type));
    assert.equal(response.status, 415, type);
    const { error } = await response.json();
    assert.match(error, pattern);
    assert.match(error, /Upload a PNG, JPG, or WebP screenshot/);
  }
  assert.equal(fetchMock.mock.callCount(), 0, "zero model calls");
});

test("regression test 7: a 4000 px-wide screenshot is sent to OpenAI at 1600 px; history keeps the original", async () => {
  const { requests } = mockModel({ candidates: candidatesResponse() });
  const save = mock.method(dependencies, "saveProblem");
  const wide = await screenshotOf(4000, 1000);
  assert.equal((await POST(upload(wide))).status, 200);
  const sent = await sentImage(requests.candidates[0]);
  assert.deepEqual([sent.width, sent.height, sent.format], [1600, 400, "png"], "long edge capped at 1600, aspect kept, still lossless");
  assert.equal(save.mock.calls[0].arguments[0].bytes.length, wide.length, "history saves the upload as received");

  // A screenshot already within the cap is sent exactly as uploaded.
  const small = await screenshotOf(1200, 700);
  mock.restoreAll();
  const second = mockModel({ candidates: candidatesResponse() });
  await POST(upload(small));
  const sentSmall = await sentImage(second.requests.candidates[0]);
  assert.deepEqual([sentSmall.width, sentSmall.height], [1200, 700]);
});

// ---- honest OpenAI error states ------------------------------------------------

const OPENAI_429 = {
  rateLimit: {
    body: { error: { message: "Rate limit reached for gpt-5-mini in organization org-test on tokens per min (TPM): Limit 200000, Used 199000, Requested 3000. Please try again in 7s. Visit https://platform.openai.com/account/rate-limits to learn more.", type: "tokens", param: null, code: "rate_limit_exceeded" } },
    headers: { "retry-after": "7" },
  },
  // A rate-limit message can link the billing page; the code still decides.
  rateLimitMentioningBilling: {
    body: { error: { message: "Rate limit reached for requests. Add a payment method to your account to increase your rate limit. Visit https://platform.openai.com/account/billing to add a payment method.", type: "requests", param: null, code: "rate_limit_exceeded" } },
    headers: {},
  },
  quota: {
    body: { error: { message: "You exceeded your current quota, please check your plan and billing details.", type: "insufficient_quota", param: null, code: "insufficient_quota" } },
    headers: {},
  },
  // What the billing stop in the eval actually said, with no usable code.
  noCredits: {
    body: { error: { message: "You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.", type: null, param: null, code: null } },
    headers: {},
  },
};
const reply429 = (variant: keyof typeof OPENAI_429) => () =>
  new Response(JSON.stringify(OPENAI_429[variant].body), { status: 429, headers: { "content-type": "application/json", ...OPENAI_429[variant].headers } });

test("regression tests 8 + 9: a rate limit gets a countdown, being out of credit does not; neither is ever retried", async () => {
  const alerts: string[] = [];
  mock.method(console, "error", (...args: unknown[]) => alerts.push(args.map(String).join(" ")));
  for (const [variant, expected] of [
    ["rateLimit", { status: 429, kind: "rate_limited", retryAfter: "7" }],
    ["rateLimitMentioningBilling", { status: 429, kind: "rate_limited", retryAfter: "20" }],
    ["quota", { status: 503, kind: "unavailable", retryAfter: null }],
    ["noCredits", { status: 503, kind: "unavailable", retryAfter: null }],
  ] as const) {
    mock.restoreAll();
    mock.method(console, "error", (...args: unknown[]) => alerts.push(args.map(String).join(" ")));
    const { fetchMock } = mockModel({ candidates: reply429(variant) });
    const response = await POST(upload());
    const body = await response.json();
    assert.equal(response.status, expected.status, variant);
    assert.equal(body.kind, expected.kind, variant);
    assert.equal(response.headers.get("retry-after"), expected.retryAfter, variant);
    assert.equal(retryCountdown(response.status, body, response.headers.get("retry-after")), expected.retryAfter ? Number(expected.retryAfter) : null, `${variant}: the client's countdown`);
    if (expected.kind === "unavailable") {
      assert.equal(body.error, "Service temporarily unavailable. Please try again later.", "no billing details for students");
      assert.ok(alerts.some((line) => /\[desmo:ALERT\].*candidates call/.test(line) && /no credits remaining|current quota/.test(line)), `${variant}: the real cause is logged loudly`);
    }
    assert.equal(fetchMock.mock.callCount(), 1, `${variant}: one request, no automatic retry`);
  }
});

test("regression test 9: a 429 on an explanation is not retried either; the student gets the retry button instead", async () => {
  const { requests } = tangentModel();
  const solved = await (await POST(upload())).json();
  mock.restoreAll();
  mock.method(console, "error", () => undefined);
  const model = mockModel({ candidates: candidatesResponse(), explanation: reply429("rateLimit") });
  const stream = await events(await SWITCH(switchTo(solved.cacheKey, "discriminant", { Accept: "application/x-ndjson" })));
  assert.equal(stream.at(-1).explanation, "fallback");
  assert.equal(explanationFromEvents(stream), null);
  assert.equal(model.requests.explanation.length, 1, "one request");
  assert.ok(requests.explanation.length >= 1);
});

test("the per-minute limit and OpenAI's rate limit are the only responses with a countdown", () => {
  assert.equal(retryCountdown(429, { kind: "rate_limited" }, "12"), 12);
  assert.equal(retryCountdown(429, { kind: "rate_limited", retryAfter: 9 }, null), 9);
  assert.equal(retryCountdown(429, { kind: "rate_limited" }, null), 20, "a default when neither says");
  assert.equal(retryCountdown(429, { kind: "daily_cap", resetsAt: "2026-09-28T00:00:00Z" }, null), null, "a daily cap is not a countdown");
  assert.equal(retryCountdown(429, { error: "Too many" }, "60"), null, "an unmarked 429 is not trusted to clear by waiting");
  assert.equal(retryCountdown(503, { kind: "unavailable" }, "30"), null);
  assert.equal(retryCountdown(503, { kind: "at_capacity" }, null), null);
});

// ---- error tracking and events ------------------------------------------------

const named = (name: string) => telemetryRecords.filter((record) => record.name === name);

test("events: solve_started and solve_succeeded carry the user, solve, problem, technique, and cost", async () => {
  mockModel({ candidates: candidatesResponse(), extra: { candidates: CANDIDATES_USAGE, explanation: EXPLANATION_USAGE } });
  const data = await (await POST(upload())).json();
  const [started] = named("solve_started");
  const [succeeded] = named("solve_succeeded");
  assert.equal(started.context.userId, userId);
  assert.equal(started.context.mime, "image/png");
  assert.equal(succeeded.context.solveId, started.context.solveId);
  assert.equal(succeeded.context.cacheKey, data.cacheKey);
  assert.equal(succeeded.context.techniqueId, "intercept-read");
  assert.equal(succeeded.context.costUsd, 0.008548, "0.006195 + 0.002353");
  assert.equal(succeeded.context.outcome, "solved");
  assert.equal(telemetryRecords.filter((record) => record.type === "error").length, 0);
});

test("events: upload_rejected names the reason, and a rejected upload never starts a solve", async () => {
  mockModel({ candidates: candidatesResponse() });
  await POST(upload(png, "image/gif"));
  await POST(upload(Buffer.from("not really a png"), "image/png"));
  const rejected = named("upload_rejected");
  assert.equal(rejected.length, 2);
  assert.match(String(rejected[0].context.reason), /GIF file/);
  assert.equal(rejected[0].context.status, 415);
  assert.equal(rejected[1].context.reason, "signature_mismatch");
  assert.equal(named("solve_started").length, 0);
});

test("events: cap_hit and ceiling_hit are recorded when a limit refuses a solve", async () => {
  mockModel({ candidates: candidatesResponse() });
  mock.method(console, "error", () => undefined);
  dependencies.limits = () => ({ freeSolvesPerDay: 0, dailySpendCeilingUsd: 1000 });
  await POST(upload());
  const [cap] = named("cap_hit");
  assert.equal(cap.context.userId, userId);
  assert.equal(cap.context.limit, 0);
  dependencies.limits = () => ({ freeSolvesPerDay: 1000, dailySpendCeilingUsd: 0 });
  await POST(upload());
  assert.equal(named("ceiling_hit")[0].context.ceilingUsd, 0);
  assert.equal(named("solve_failed").length, 0, "a limit is not a failure");
});

test("errors: a failed solve is captured with its stack, user, solve id, and the call that failed", async () => {
  mock.method(console, "error", () => undefined);
  mockModel({ candidates: () => Response.json({ error: { code: "server_error", message: "upstream exploded" } }, { status: 500 }) });
  assert.equal((await POST(upload())).status, 502);
  const [error] = telemetryRecords.filter((record) => record.type === "error");
  assert.ok(error.error?.stack?.includes("at "), "a stack trace");
  assert.equal(error.context.userId, userId);
  assert.equal(error.context.call, "candidates");
  assert.ok(error.context.solveId);
  const [failed] = named("solve_failed");
  assert.equal(failed.context.reason, "openai_other_500");
  assert.equal(failed.context.solveId, error.context.solveId);
});

test("events: method_switched carries the problem and technique; a fallen-back explanation is captured with its cause", async () => {
  const { requests } = tangentModel({ failing: new Set(["Slider until it fits"]) });
  const solved = await (await POST(upload())).json();
  await events(await SWITCH(switchTo(solved.cacheKey, "discriminant", { Accept: "application/x-ndjson" })));
  await events(await SWITCH(switchTo(solved.cacheKey, "slider-condition", { Accept: "application/x-ndjson" })));
  const switched = named("method_switched");
  assert.deepEqual(switched.map((record) => [record.context.techniqueId, record.context.explanation]), [["discriminant", "model"], ["slider-condition", "fallback"]]);
  assert.equal(switched[0].context.cacheKey, solved.cacheKey);
  const [error] = telemetryRecords.filter((record) => record.type === "error");
  assert.equal(error.context.techniqueId, "slider-condition");
  assert.equal(error.context.call, "explanation");
  assert.equal(error.context.cacheKey, solved.cacheKey);
  assert.ok(requests.explanation.length >= 3);
});

test("telemetry never fails a request: a throwing or hanging sink is ignored", async () => {
  dependencies.telemetry = createTelemetry([
    () => {
      throw new Error("sink down");
    },
    () => new Promise(() => undefined),
  ]);
  mockModel({ candidates: candidatesResponse() });
  const started = performance.now();
  assert.equal((await POST(upload())).status, 200);
  assert.ok(performance.now() - started < 5_000, "the flush gives up after a short limit");
});

test("the Supabase sink writes one app_events row per record, with context split out and no problem text", async () => {
  const rows: Record<string, unknown>[] = [];
  const sink = supabaseSink(() => ({ from: (table: string) => ({ insert: async (row: Record<string, unknown>) => (rows.push({ table, ...row }), { error: null }) }) }));
  const telemetry = createTelemetry([sink]);
  telemetry.error(new Error("boom"), { userId, solveId: "s1", cacheKey: "k1", techniqueId: "discriminant", call: "explanation", stage: "method_switch" });
  await telemetry.flush();
  assert.equal(rows[0].table, "app_events");
  assert.equal(rows[0].type, "error");
  assert.equal(rows[0].user_id, userId);
  assert.equal(rows[0].technique_id, "discriminant");
  assert.equal(rows[0].call, "explanation");
  assert.deepEqual(rows[0].context, { stage: "method_switch" });
  assert.match(String(rows[0].error_stack), /boom/);
});
