import assert from "node:assert/strict";
import { readFile, unlink } from "node:fs/promises";
import { afterEach, beforeEach, mock, test } from "node:test";
import OpenAI from "openai";
import { Responses } from "openai/resources/responses/responses";
import sharp from "sharp";

import { createMemorySolveCache } from "../src/lib/solve-cache";
import { createMethodHandler, createSolveHandler, type SolveDependencies } from "../src/lib/solve-handler";
import { MAX_IMAGE_BYTES } from "../src/lib/solver-schema";
import { candidatesResponse, explanation, graphCandidate, mockModel, paperCandidate, providerBody, zeroCost } from "./method-fixtures";

// Tiny valid PNG; tests never send this (or any other data) to an external API.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4//8/AAX+Av5Y8msOAAAAAElFTkSuQmCC",
  "base64",
);
const userId = "11111111-1111-4111-8111-111111111111";
const problemId = "22222222-2222-4222-8222-222222222222";
let cache = createMemorySolveCache();
const dependencies: SolveDependencies = {
  getCurrentUser: async () => ({ id: userId }),
  reserveSolve: async () => ({ allowed: true, retryAfter: 0 }),
  saveProblem: async () => problemId,
  getCache: () => cache,
};
const POST = createSolveHandler(dependencies);
const SWITCH = createMethodHandler(dependencies);
const saved = {
  key: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL,
  effort: process.env.OPENAI_REASONING_EFFORT,
  tier: process.env.OPENAI_SERVICE_TIER,
};

beforeEach(() => {
  cache = createMemorySolveCache();
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
  assert.deepEqual(data.methods[0].badges, ["Recommended", "Least math", "Most Desmos", "Fewest steps"]);
  assert.equal(data.methods[0].mathLevel, "low");
  assert.equal(data.methods[1].shape, "no calculator · factoring · 1 algebra step");
  assert.equal(data.solution.trick, "Read the intercepts");
  assert.equal(data.solution.method, "desmos");
  assert.deepEqual(data.solution.expressions, [{ latex: "y=x^2-9", purpose: "Explains what line 1 makes Desmos do." }]);
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
    /<training_examples>/,
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
  const candidateFields = Object.keys(schema.properties.candidates.items!.properties);
  assert.deepEqual(candidateFields.slice(0, 3), ["techniqueId", "rung", "rows"]);
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

test("maps authentication, quota, rate, model, image, and service errors to useful messages", async () => {
  for (const [upstreamStatus, code, status, message] of [
    [401, "invalid_api_key", 503, /API key/],
    [429, "insufficient_quota", 503, /credits/],
    [429, "rate_limit_exceeded", 429, /too many requests/],
    [404, "model_not_found", 503, /model is unavailable/],
    [400, "invalid_image", 400, /could not read/],
    [500, "server_error", 502, /AI service/],
  ] as const) {
    mock.restoreAll();
    const fetchMock = mock.method(globalThis, "fetch", async () =>
      Response.json({ error: { code, message: "private provider payload" } }, { status: upstreamStatus }),
    );
    const result = await POST(upload());
    assert.equal(result.status, status);
    const error = (await result.json()).error;
    assert.match(error, message);
    assert.doesNotMatch(error, /private provider payload|unit-test-key/);
    assert.equal(fetchMock.mock.callCount(), 1, "does not automatically retry paid requests");
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
  const [methods, solution] = await events(response);
  assert.equal(methods.type, "methods");
  assert.equal(methods.selectedMethodId, "intercept-read");
  assert.deepEqual(methods.methods[0].rows, [{ latex: "y=x^2-9", slider: null }]);
  assert.equal(methods.methods[0].answer, "3");
  assert.equal(solution.type, "solution");
  assert.equal(solution.solution.why, explanation().why);
  assert.equal(solution.problemId, problemId);
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
  assert.equal(first.solution.why, "Read the intercepts: 1 row · graph · no algebra.");
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

test("a stalled candidates call is abandoned and retried instead of failing the solve", async () => {
  let calls = 0;
  mock.method(Responses.prototype, "create", async function (this: unknown, body: { text: { format: { name: string } } }) {
    if (body.text.format.name === "desmo_candidates" && ++calls === 1) throw new OpenAI.APIConnectionTimeoutError();
    return providerBody(body.text.format.name === "desmo_explanation" ? explanation() : candidatesResponse());
  });
  const response = await POST(upload());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).solution.answer, "3");
  assert.equal(calls, 2);
});
