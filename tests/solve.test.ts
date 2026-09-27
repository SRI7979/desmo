import assert from "node:assert/strict";
import { readFile, unlink } from "node:fs/promises";
import { afterEach, beforeEach, mock, test } from "node:test";
import OpenAI from "openai";
import { Responses } from "openai/resources/responses/responses";

import { createSolveHandler, type SolveDependencies } from "../src/lib/solve-handler";
import { MAX_IMAGE_BYTES, SOLVE_MODES, type Solution } from "../src/lib/solver-schema";
import {
  selectStrategy,
  type StrategyCandidate,
  type StrategyPortfolio,
  type StrategySelectionResult,
} from "../src/lib/strategy-selection";

// Tiny valid PNG; tests never send this (or any other data) to an external API.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4//8/AAX+Av5Y8msOAAAAAElFTkSuQmCC",
  "base64",
);
const solution: Solution = {
  status: "solved",
  question: "What is the positive solution to x² = 9?",
  choices: null,
  structure: "One equation, asked for its positive solution: a zeros trick.",
  trick: "Read the zeros",
  answerState: null,
  parameters: [],
  conditionType: null,
  distinguishes: null,
  answer: "3",
  method: "desmos",
  why: "Graphing x² − 9 lets you read its positive root directly.",
  steps: [],
  readAnswer:
    "Click the positive x-intercept of line 1 and read its x-coordinate, 3.",
  expressions: [
    {
      latex: "y=x^2-9",
      purpose:
        "Graphs x² − 9; where y is zero, x satisfies the original equation x² = 9.",
    },
  ],
  result: {
    row: 1,
    value: 3,
    listIndex: null,
    answerFrom: "value",
    choiceLabel: null,
    detail: "the positive x-intercept",
  },
  graphBounds: { left: -5, right: 5, bottom: -12, top: 12 },
  clarification: null,
};
const oldKey = process.env.OPENAI_API_KEY;
const userId = "11111111-1111-4111-8111-111111111111";
const problemId = "22222222-2222-4222-8222-222222222222";
const dependencies: SolveDependencies = {
  getCurrentUser: async () => ({ id: userId }),
  reserveSolve: async () => ({ allowed: true, retryAfter: 0 }),
  saveProblem: async () => problemId,
};
const POST = createSolveHandler(dependencies);
const oldModel = process.env.OPENAI_MODEL;
const oldReasoningEffort = process.env.OPENAI_REASONING_EFFORT;
const oldServiceTier = process.env.OPENAI_SERVICE_TIER;

beforeEach(() => {
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
  if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = oldKey;
  if (oldModel === undefined) delete process.env.OPENAI_MODEL;
  else process.env.OPENAI_MODEL = oldModel;
  if (oldReasoningEffort === undefined)
    delete process.env.OPENAI_REASONING_EFFORT;
  else process.env.OPENAI_REASONING_EFFORT = oldReasoningEffort;
  if (oldServiceTier === undefined) delete process.env.OPENAI_SERVICE_TIER;
  else process.env.OPENAI_SERVICE_TIER = oldServiceTier;
});

function upload(bytes: Uint8Array = png, type = "image/png") {
  const form = new FormData();
  form.set(
    "image",
    new File([new Uint8Array(bytes)], "question.png", { type }),
  );
  return new Request("http://localhost/api/solve", {
    method: "POST",
    body: form,
  });
}

const defaultScores = {
  correctness: 5,
  simplicity: 5,
  student_effort: 1,
  manual_math_knowledge: 1,
  manual_algebra: 0,
  manual_calculation: 0,
  desmos_outsourcing: 5,
  reliability: 5,
  steps_time: 1,
};

function candidate(id: string, value: Solution = solution): StrategyCandidate {
  return {
    id,
    name: `Strategy ${id}`,
    trick: value.trick ?? "Read the zeros",
    reusable: true,
    techniques: ["zeros"],
    scores: {
      ...defaultScores,
      desmos_outsourcing: value.expressions?.length ? 5 : 0,
    },
    humanWork: "Enter the given equation and identify the positive root.",
    desmosWork: "Find the root of the supplied equation.",
    validityNote: "The positive root satisfies the original equation.",
    solution: {
      answer: value.answer,
      method: value.method,
      why: value.why,
      steps: value.steps,
      readAnswer: value.readAnswer,
      expressions: value.expressions,
      result: value.result,
      graphBounds: value.graphBounds,
    },
  };
}

function portfolio(value: unknown = solution) {
  if (typeof value !== "object" || value === null) return value;
  if ("candidates" in value) return value;
  const given = value as Solution;
  return {
    status: given.status,
    question: given.question,
    choices: given.choices ?? null,
    clarification: given.clarification,
    structure: given.structure ?? "",
    candidates:
      given.status === "needs_clarification"
        ? []
        : ["first", "second", "third"].map((id) => candidate(id, given)),
  };
}

function providerResponse(value: unknown = solution, status = "completed") {
  const full = portfolio(value) as StrategyPortfolio;
  let selected = full?.candidates?.[0];
  if (full?.status === "solved") {
    try {
      const id = selectStrategy(full).strategySelection?.selectedCandidateId;
      const winner = full.candidates.find((candidate) => candidate.id === id);
      if (winner) selected = winner;
    } catch {
      // Keep malformed fixtures malformed so the route exercises its validation.
    }
  }
  const compact = full?.candidates
    ? {
        status: full.status,
        question: full.question,
        choices: full.choices ?? null,
        clarification: full.clarification,
        structure: full.structure ?? "",
        candidates: full.candidates.map(({ solution: _solution, ...audit }) => {
          void _solution;
          return audit;
        }),
        selectedCandidateId: selected?.id ?? null,
        solution: selected?.solution ?? null,
      }
    : full;
  return {
    id: "resp_test",
    object: "response",
    status,
    output: [
      {
        id: "msg_test",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: JSON.stringify(compact),
            annotations: [],
          },
        ],
      },
    ],
  };
}

function mockProvider(body: unknown, status = 200) {
  return mock.method(globalThis, "fetch", async () =>
    Response.json(body, { status }),
  );
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
  const provider = mockProvider(providerResponse());
  const response = await POST(upload());
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "27");
  assert.equal((await response.json()).retryAfter, 27);
  assert.deepEqual(reserve.mock.calls[0].arguments, [userId]);
  assert.equal(provider.mock.callCount(), 0);
});

test("auth and quota outages fail closed rather than permitting free solves", async () => {
  const provider = mockProvider(providerResponse());
  const auth = mock.method(dependencies, "getCurrentUser", async () => { throw new Error("offline"); });
  assert.equal((await POST(upload())).status, 503);
  auth.mock.mockImplementation(async () => ({ id: userId }));
  mock.method(dependencies, "reserveSolve", async () => { throw new Error("offline"); });
  assert.equal((await POST(upload())).status, 503);
  assert.equal(provider.mock.callCount(), 0);
});

test("saves the exact returned canonical solution under the verified account", async () => {
  mockProvider(providerResponse());
  const save = mock.method(dependencies, "saveProblem");
  const response = await POST(upload());
  const data = await response.json();
  assert.equal(data.problemId, problemId);
  const input = save.mock.calls[0].arguments[0];
  assert.equal(input.userId, userId);
  assert.deepEqual(input.bytes, png);
  assert.deepEqual(input.solution, data.solution);
});

test("storage failure preserves a usable solution and explicitly reports it was not saved", async () => {
  mockProvider(providerResponse());
  mock.method(dependencies, "saveProblem", async () => { throw new Error("storage offline"); });
  const response = await POST(upload());
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(data.solution, solution);
  assert.equal(data.problemId, null);
  assert.match(data.historyWarning, /could not be saved/);
});

test("unsuitable content produces clarification without a guessed answer or expressions", async () => {
  for (const clarification of [
    "There are multiple questions. Crop the image to one question.",
    "This is an English reading question. Upload a math question.",
    "No math question is visible. Upload a screenshot of the question.",
    "The diagram is cut off. Include the full diagram.",
  ]) {
    mockProvider(providerResponse({ ...solution, status: "needs_clarification", clarification }));
    const response = await POST(upload());
    const data = await response.json();
    assert.equal(data.solution.status, "needs_clarification");
    assert.equal(data.solution.answer, "");
    assert.deepEqual(data.solution.expressions, []);
    assert.equal(data.solution.clarification, clarification);
  }
});

test("rejects missing, empty, unsupported, and disguised uploads before contacting AI", async () => {
  const noImage = new Request("http://localhost/api/solve", {
    method: "POST",
    body: new FormData(),
  });
  assert.equal((await POST(noImage)).status, 400);
  assert.equal((await POST(upload(new Uint8Array()))).status, 400);
  assert.equal((await POST(upload(png, "image/gif"))).status, 415);
  assert.equal(
    (await POST(upload(Buffer.from("This is not a PNG")))).status,
    415,
  );
  assert.equal((await POST(upload(png, "image/jpeg"))).status, 415);
});

test("rejects multiple screenshot fields and malformed multipart", async () => {
  const form = new FormData();
  form.append("image", new File([png], "one.png", { type: "image/png" }));
  form.append("image", new File([png], "two.png", { type: "image/png" }));
  assert.equal(
    (
      await POST(
        new Request("http://localhost/api/solve", {
          method: "POST",
          body: form,
        }),
      )
    ).status,
    400,
  );
  form.delete("image");
  form.append("image", new File([png], "one.png", { type: "image/png" }));
  form.append("extra-image", new File([png], "two.png", { type: "image/png" }));
  assert.equal((await POST(new Request("http://localhost/api/solve", { method: "POST", body: form }))).status, 400);
  const malformed = new Request("http://localhost/api/solve", {
    method: "POST",
    headers: { "Content-Type": "multipart/form-data; boundary=broken" },
    body: "not multipart",
  });
  assert.equal((await POST(malformed)).status, 400);
});

test("bounds uploads with and without a Content-Length header", async () => {
  const excessiveLength = upload();
  excessiveLength.headers.set(
    "Content-Length",
    String(MAX_IMAGE_BYTES + 100_000),
  );
  assert.equal((await POST(excessiveLength)).status, 413);
  assert.equal(
    (await POST(upload(new Uint8Array(MAX_IMAGE_BYTES + 1)))).status,
    413,
  );
  const oversizedBody = new Request("http://localhost/api/solve", {
    method: "POST",
    headers: { "Content-Type": "multipart/form-data; boundary=test" },
    body: new Uint8Array(MAX_IMAGE_BYTES + 100_000),
  });
  assert.equal((await POST(oversizedBody)).status, 413);
});

test("reports a missing server key without calling the provider", async () => {
  delete process.env.OPENAI_API_KEY;
  const result = await POST(upload());
  assert.equal(result.status, 503);
  assert.match((await result.json()).error, /OPENAI_API_KEY/);
});

test("sends the image with strict schema, no storage, and returns calculator entries", async () => {
  let sent: Record<string, unknown> | undefined;
  mock.method(
    globalThis,
    "fetch",
    async (_input: unknown, options?: RequestInit) => {
      sent = JSON.parse(String(options?.body));
      return Response.json(providerResponse());
    },
  );
  const result = await POST(upload());
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.match(result.headers.get("server-timing") ?? "", /ai;dur=\d/);
  const returned = (await result.json()) as StrategySelectionResult;
  assert.deepEqual(returned.solution, solution);
  assert.equal(returned.strategySelection?.selectedCandidateId, "first");
  assert.equal(returned.strategySelection?.candidates.length, 3);
  assert.deepEqual(
    returned.strategySelection?.candidates[0].scores,
    defaultScores,
  );
  assert.equal(
    returned.strategySelection?.candidates.some((plan) => "solution" in plan),
    false,
  );
  assert.equal(sent?.model, "gpt-5-mini");
  assert.equal(sent?.store, false);
  assert.equal(sent?.service_tier, "priority", "priority processing halves solve time");
  assert.match(result.headers.get("server-timing") ?? "", /ai;dur=[\d.]+;desc="priority"/);
  assert.equal(sent?.prompt_cache_key, "desmo-strategy-selection-v17");
  assert.match(String(sent?.instructions), /DESMO SAT MATH STRATEGY LIBRARY/);
  assert.match(String(sent?.instructions), /Unknown parameter regression/);
  assert.match(String(sent?.instructions), /calculator starts in DEGREES/);
  assert.match(String(sent?.instructions), /SAT reference sheet/);
  assert.match(String(sent?.instructions), /\\operatorname\{repeat\}/);
  assert.match(String(sent?.instructions), /REPRESENTATION \/ MODELING QUESTIONS/);
  assert.match(
    String(sent?.instructions),
    /Stop there; do not solve for n/,
  );
  assert.match(String(sent?.instructions), /<training_examples>/);
  assert.match(
    String(sent?.instructions),
    /Parameter regression using multiple x-values/,
  );
  assert.match(
    String(sent?.instructions),
    /Never copy an example's numbers,\s*answer, answer-choice letter/,
  );
  assert.match(String(sent?.instructions), /x_\{1\}=\[1\.\.\.5\]/);
  assert.match(String(sent?.instructions), /ANSWER CONSISTENCY CONTRACT/);
  assert.match(String(sent?.instructions), /value is r\+s, not r\s*or s/);
  assert.match(String(sent?.instructions), /DESMOS SYNTAX SAFETY/);
  assert.match(String(sent?.instructions), /direct bracket regression/);
  assert.match(String(sent?.instructions), /Direct bracket regression for a small system/);
  assert.match(String(sent?.instructions), /Bracket regression with a supplied coordinate/);
  assert.match(String(sent?.instructions), /LEAST TOTAL STUDENT EFFORT/);
  assert.match(String(sent?.instructions), /REQUIRED ORDER OF WORK/);
  assert.match(String(sent?.instructions), /NEVER solve the problem traditionally first and then reverse-engineer/);
  assert.match(String(sent?.instructions), /Prefer a generalizable method over\s+an answer-choice-only hack/);
  assert.match(String(sent?.instructions), /Name every candidate's trick/);
  assert.match(String(sent?.instructions), /Do not avoid basic math at absolutely any cost/);
  assert.match(String(sent?.instructions), /THE REQUIRED ORDER: recognize the problem's structure/);
  assert.match(String(sent?.instructions), /GENERALIZABLE OVER ANSWER-CHOICE-ONLY/);
  assert.match(JSON.stringify(sent?.input), /MODE: Desmos First/);
  assert.match(String(sent?.instructions), /Penalize HIDDEN DERIVATION/);
  assert.match(String(sent?.instructions), /LEAST-TOTAL-EFFORT POLICY/);
  assert.match(String(sent?.instructions), /PREFERENCE EXAMPLES/);
  assert.match(String(sent?.instructions), /Factor → shared zero → slider/);
  assert.match(String(sent?.instructions), /CONDITION TRANSLATION FIRST/);
  assert.match(String(sent?.instructions), /VISUAL AND SLIDER ENDINGS/);
  assert.match(String(sent?.instructions), /VISUAL RESULTS ARE VALID ENDINGS/);
  assert.match(String(sent?.instructions), /57\. Graph answer-choice constants, sliders, and graphical conditions/);
  assert.match(String(sent?.instructions), /Slider until a graphical condition appears/);

  assert.match(String(sent?.instructions), /REGRESSION SAFETY/);
  assert.match(String(sent?.instructions), /applies across all 75 strategies/);
  for (const strategy of [
    /72\. Factorization by identity regression/,
    /73\. Pack several conditions into one regression/,
    /74\. Strategic-value testing for symbolic multiple choice/,
    /75\. Factor → shared zero/,
    /60\. Equivalent-form \/ identity regression/,
    /Several equations with unknown constants → direct bracket regression/,
    /Bracket regression with a supplied coordinate/,
    /Pack several conditions into one regression/,
    /Strategic-value testing for symbolic multiple choice/,
  ]) {
    assert.match(String(sent?.instructions), strategy);
  }
  assert.doesNotMatch(String(sent?.instructions), /Quadratic from three known points → regression, always consider it/);
  assert.deepEqual(sent?.reasoning, { effort: "low" });
  const text = sent?.text as {
    verbosity: string;
    format: {
      strict: boolean;
      type: string;
      schema: {
        properties: {
          solution: unknown;
          candidates: { items: { properties: Record<string, unknown> } };
        };
      };
    };
  };
  assert.equal(text.format.strict, true);
  assert.equal(text.format.type, "json_schema");
  assert.equal(text.verbosity, "low");
  assert.ok(text.format.schema.properties.solution);
  assert.ok(
    (text.format.schema.properties as { choices?: unknown }).choices,
    "answer choices are transcribed beside the question",
  );
  const propertyOrder = Object.keys(text.format.schema.properties);
  assert.ok(
    propertyOrder.indexOf("structure") < propertyOrder.indexOf("candidates"),
    "the structure is recognized before any candidate is generated",
  );
  assert.match(
    JSON.stringify(text.format.schema.properties.candidates.items.properties),
    /"trick"[\s\S]*"reusable"/,
    "every candidate names its trick and says whether it generalizes",
  );
  assert.match(
    JSON.stringify(text.format.schema.properties.solution),
    /"result"[\s\S]*"answerFrom"/,
    "the winning solution must identify the row and value that give the answer",
  );
  assert.match(
    JSON.stringify(text.format.schema.properties.solution),
    /"slider"[\s\S]*"step"/,
    "each row may carry slider bounds the calculator applies",
  );
  assert.equal(
    "solution" in text.format.schema.properties.candidates.items.properties,
    false,
    "generate a full walkthrough only once, after the candidate scorecards",
  );
  assert.match(JSON.stringify(sent?.input), /data:image\/png;base64,/);
});

test("does not send GPT-5 reasoning options when another model is configured", async () => {
  process.env.OPENAI_MODEL = "gpt-4.1-mini";
  let sent: Record<string, unknown> | undefined;
  mock.method(
    globalThis,
    "fetch",
    async (_input: unknown, options?: RequestInit) => {
      sent = JSON.parse(String(options?.body));
      return Response.json(providerResponse());
    },
  );
  assert.equal((await POST(upload())).status, 200);
  assert.equal(sent?.model, "gpt-4.1-mini");
  assert.equal(sent?.reasoning, undefined);
  assert.equal((sent?.text as { verbosity?: string }).verbosity, undefined);
});

test("allows a configured GPT-5 reasoning effort", async () => {
  process.env.OPENAI_REASONING_EFFORT = "medium";
  let sent: Record<string, unknown> | undefined;
  mock.method(
    globalThis,
    "fetch",
    async (_input: unknown, options?: RequestInit) => {
      sent = JSON.parse(String(options?.body));
      return Response.json(providerResponse());
    },
  );

  assert.equal((await POST(upload())).status, 200);
  assert.deepEqual(sent?.reasoning, { effort: "medium" });
});

test("clarification responses cannot load a guessed answer or graph", async () => {
  mockProvider(
    providerResponse({
      ...solution,
      status: "needs_clarification",
      clarification: "The exponent is cropped.",
    }),
  );
  const result = await POST(upload());
  assert.equal(result.status, 200);
  const body = (await result.json()) as StrategySelectionResult;
  const returned = body.solution;
  assert.equal(returned.answer, "");
  assert.deepEqual(returned.expressions, []);
  assert.deepEqual(returned.steps, []);
  assert.equal(returned.readAnswer, null);
  assert.equal(returned.graphBounds, null);
  assert.equal(returned.clarification, "The exponent is cropped.");
  assert.equal(body.strategySelection, null);
});

test("drops inverted graph bounds instead of passing them to Desmos", async () => {
  mockProvider(
    providerResponse({
      ...solution,
      graphBounds: { left: 10, right: -10, bottom: -5, top: 5 },
    }),
  );
  const result = await POST(upload());
  assert.equal(result.status, 200);
  assert.equal((await result.json()).solution.graphBounds, null);
});

test("rejects malformed, incomplete, or empty solved output", async () => {
  for (const body of [
    providerResponse({ answer: 3 }),
    providerResponse(solution, "incomplete"),
  ]) {
    mockProvider(body);
    assert.equal((await POST(upload())).status, 502);
  }
});

test("rejects unusable calculator entries and missing line explanations with a retryable error", async () => {
  for (const incomplete of [
    { ...solution, method: "desmos", expressions: [] },
    {
      ...solution,
      expressions: [{ latex: "  \n\t", purpose: "Check the answer" }],
    },
    { ...solution, expressions: [{ latex: "y=x^2-9", purpose: "" }] },
    {
      ...solution,
      expressions: [
        ...solution.expressions,
        { latex: "y=0", purpose: "  \n\t" },
      ],
    },
  ]) {
    mockProvider(providerResponse(incomplete));
    const result = await POST(upload());
    assert.equal(result.status, 502);
    assert.match((await result.json()).error, /Please try again/);
  }
});

test("preserves calculator row order and removes a competing steps explanation", async () => {
  const expressions = [
    { latex: "y=x^2", purpose: "Graphs the square of x." },
    { latex: "y=9", purpose: "Graphs the target value 9 as a horizontal line." },
  ];
  const readAnswer =
    "Click the right intersection of lines 1 and 2 and read x = 3.";
  mockProvider(
    providerResponse({
      ...solution,
      method: "mental_math",
      expressions,
      readAnswer,
      steps: ["Take the square root of both sides.", "  \n\t"],
    }),
  );
  const result = await POST(upload());
  assert.equal(result.status, 200);
  const returned = (await result.json()).solution as Solution;
  assert.deepEqual(returned.expressions, expressions);
  assert.equal(returned.method, "desmos");
  assert.deepEqual(returned.steps, []);
  assert.equal(returned.readAnswer, readAnswer);
});

test("returns the lower-human-math strategy with its exact rows and matching explanation", async () => {
  const question =
    "Line h passes through (−6,0) and (0,−9). Line k is sx+48y=t. The system has no solution. Which is NOT a possible t: A −432, B −9, C 72, D 288?";
  const choices = [
    { label: "A", text: "−432" },
    { label: "B", text: "−9" },
    { label: "C", text: "72" },
    { label: "D", text: "288" },
  ];
  const manual = candidate("manual-formulas", {
    ...solution,
    answer: "A. −432",
    result: { row: 3, value: -432, listIndex: null, answerFrom: "value", choiceLabel: "A", detail: "t" },
    why: "Use the slope formula, match parallel slopes, and substitute a point.",
    expressions: [
      {
        latex: "m=\\frac{-9-0}{0-(-6)}",
        purpose: "Calculate slope using the slope formula.",
      },
      {
        latex: "s=-48m",
        purpose: "Rearrange the second line to match its slope.",
      },
      {
        latex: "t=s(-6)+48(0)",
        purpose: "Substitute the intercept into the second equation.",
      },
    ],
    readAnswer: "Read −432 from line 3.",
  });
  manual.scores = {
    ...defaultScores,
    simplicity: 2,
    student_effort: 3,
    manual_math_knowledge: 4,
    manual_algebra: 3,
    desmos_outsourcing: 2,
  };

  const expressions = [
    {
      latex: "x_{1}=[-6,0]",
      purpose: "Enter the x-coordinates of the two marked points.",
    },
    {
      latex: "y_{1}=[0,-9]",
      purpose: "Enter the corresponding y-coordinates in the same order.",
    },
    {
      latex: "y_{1}\\sim mx_{1}+b",
      purpose: "Fit the line through the supplied points without calculating its slope.",
    },
    {
      latex: "f(x)=-1.5x-9",
      purpose: "Copy the fitted equation displayed by the regression on line 3.",
    },
    {
      latex: "t=[-432,-9,72,288]",
      purpose: "Enter all four answer choices in A–D order.",
    },
    {
      latex: "g(x)=\\frac{-sx+t}{48}",
      purpose: "Represent the second line for every answer choice simultaneously.",
    },
    {
      latex: "g'(0)\\sim f'(0)",
      purpose: "Let Desmos fit s so that the two lines have the same direction.",
    },
    {
      latex: "g(0)-f(0)",
      purpose: "Compare the four candidate lines with the original line at x = 0.",
    },
  ];
  const readAnswer =
    "Read the zero in the first position of line 8: choice A makes the lines coincide, so it cannot give no solution.";
  const result = {
    row: 8,
    value: 0,
    listIndex: 1,
    answerFrom: "choice_position" as const,
    choiceLabel: "A",
    detail: "g(0) − f(0)",
  };
  const regression = candidate("derivative-regression", {
    ...solution,
    answer: "A. −432",
    why: "Fit the original line and use derivative regression to compare all answer choices.",
    expressions,
    readAnswer,
    result,
    steps: ["This competing algebra explanation must not reach the UI."],
  });
  regression.name = "Fit the graph and test the choices";
  regression.techniques = [
    "regression",
    "derivative_regression",
    "answer_choice_testing",
    "lists",
    "function_evaluation",
  ];
  regression.scores = { ...defaultScores, simplicity: 3, student_effort: 2, steps_time: 4 };
  regression.humanWork =
    "Copy the two marked points and the answer choices; read which list entry is zero.";
  regression.desmosWork =
    "Fit the original line, match its derivative, and test every choice.";
  regression.validityNote =
    "Distinct parallel lines have no solution; a coincident line is the excluded choice.";

  const alternative = candidate("implicit-comparison", {
    ...solution,
    answer: "A. −432",
    why: "Fit the parameter values that make both equations describe the same line.",
    expressions: [
      { latex: "x_{1}=[-6,0]", purpose: "Enter the two given x-coordinates." },
      {
        latex: "y_{1}=[0,-9]",
        purpose: "Enter the two matching y-coordinates.",
      },
      {
        latex: "sx_{1}+48y_{1}\\sim t",
        purpose: "Fit both constants so the second line passes through the supplied points.",
      },
    ],
    readAnswer: "The fitted t in line 3 makes the lines coincide, so exclude that answer choice.",
    result: { row: 3, value: -432, listIndex: null, answerFrom: "value", choiceLabel: "A", detail: "the fitted t" },
  });
  alternative.scores = { ...defaultScores, simplicity: 3, student_effort: 2, manual_math_knowledge: 2 };
  mockProvider(
    providerResponse({
      status: "solved",
      question,
      choices,
      clarification: null,
      candidates: [manual, regression, alternative],
    }),
  );

  const response = await POST(upload());
  assert.equal(response.status, 200);
  const returned = (await response.json()) as StrategySelectionResult;
  assert.deepEqual(returned.solution, {
    ...regression.solution,
    question,
    choices,
    structure: null,
    trick: "Read the zeros",
    answerState: null,
    parameters: [],
    conditionType: null,
    distinguishes: null,
    answer: "A) −432",
    result,
    status: "solved",
    clarification: null,
    steps: [],
  });
  assert.deepEqual(returned.solution.expressions, expressions);
  assert.equal(returned.solution.readAnswer, readAnswer);
  assert.doesNotMatch(
    JSON.stringify(returned.solution),
    /slope formula|competing algebra explanation/,
  );
  assert.equal(returned.strategySelection?.selectedCandidateId, regression.id);
  assert.deepEqual(
    returned.strategySelection?.candidates.map(({ id, scores }) => ({
      id,
      scores,
    })),
    [manual, regression, alternative].map(({ id, scores }) => ({ id, scores })),
  );
  assert.equal(returned.strategySelection?.mode, "desmos_first");
  assert.deepEqual(returned.strategySelection?.priority, [
    "correctness",
    "simplicity",
    "student_effort",
    "reusable",
    "manual_math_knowledge + manual_algebra + manual_calculation",
    "steps_time",
    "desmos_outsourcing",
    "reliability",
  ]);
  assert.deepEqual(returned.strategySelection?.repairs, [
    'The displayed answer was changed from "A. −432" to "A) −432".',
  ]);
  assert.equal(
    returned.strategySelection?.candidates.some((plan) => "solution" in plan),
    false,
  );
});

test("requires actionable steps when there are no calculator entries", async () => {
  for (const steps of [[], ["Recognize a perfect square.", "  \n\t"]]) {
    mockProvider(
      providerResponse({
        ...solution,
        method: "mental_math",
        expressions: [],
        steps,
        readAnswer: null,
      }),
    );
    const result = await POST(upload());
    assert.equal(result.status, 502);
    assert.match((await result.json()).error, /Please try again/);
  }
});

test("canonicalizes indexed lists before returning the shared calculator walkthrough", async () => {
  const expressions = [
    { latex: "x1=[-6,0]", purpose: "Copy the two x-coordinates." },
    { latex: "y1=[0,-9]", purpose: "Copy the matching y-coordinates." },
    { latex: "y1~m*x1+b", purpose: "Fit the line through the given points." },
  ];
  mockProvider(providerResponse({ ...solution, expressions }));
  const result = await POST(upload());
  assert.equal(result.status, 200);
  const returned = (await result.json()).solution as Solution;
  assert.deepEqual(returned.expressions, [
    { ...expressions[0], latex: "x_{1}=[-6,0]" },
    { ...expressions[1], latex: "y_{1}=[0,-9]" },
    { ...expressions[2], latex: "y_{1}~mx_{1}+b" },
  ]);
  assert.deepEqual(returned.steps, []);
});

test("calculator-based shortcuts and arithmetic always return the Desmos method", async () => {
  const expressions = [
    { latex: "18/3", purpose: "Divides the given total 18 by the coefficient 3." },
  ];
  for (const method of ["mental_math", "plug_in_answers", "shortcut", "algebra"] as const) {
    mockProvider(
      providerResponse({
        ...solution,
        question: "If 3x=18, what is x?",
        answer: "6",
        why: "Divide 18 by 3 in one calculator entry.",
        method,
        expressions,
        steps: ["Divide both sides by 3."],
        readAnswer: "Read the value 6 on line 1.",
        result: { ...solution.result!, value: 6, detail: "18 ÷ 3" },
      }),
    );
    const result = await POST(upload());
    assert.equal(result.status, 200);
    const returned = (await result.json()).solution as Solution;
    assert.equal(returned.method, "desmos");
    assert.deepEqual(returned.expressions, expressions);
    assert.deepEqual(returned.steps, []);
    assert.equal(returned.readAnswer, "Read the value 6 on line 1.");
  }
});

test("rejects a written fallback without a reason for leaving the calculator empty", async () => {
  for (const why of ["", "  \n\t"]) {
    mockProvider(
      providerResponse({
        ...solution,
        method: "shortcut",
        expressions: [],
        why,
        steps: ["Interpret the constant term using the story's units."],
      }),
    );
    const result = await POST(upload());
    assert.equal(result.status, 502);
    assert.match((await result.json()).error, /Please try again/);
  }
});

test("accepts an explained conceptual fallback and clears unused calculator output", async () => {
  const steps = [
    "The fixed charge applies before any miles are driven.",
    "The constant term 5 therefore represents the initial fee in dollars.",
  ];
  mockProvider(
    providerResponse({
      ...solution,
      question: "A taxi ride costs C=3m+5 dollars for m miles. What does 5 represent?",
      answer: "The initial fee in dollars.",
      method: "shortcut",
      why: "A calculator can show the constant but cannot explain its meaning in this taxi pricing context.",
      expressions: [],
      steps,
    }),
  );
  const result = await POST(upload());
  assert.equal(result.status, 200);
  const returned = (await result.json()).solution as Solution;
  assert.equal(returned.method, "shortcut");
  assert.deepEqual(returned.expressions, []);
  assert.deepEqual(returned.steps, steps);
  assert.equal(returned.graphBounds, null);
  assert.equal(returned.readAnswer, null);
});

test("handles model refusal without exposing the provider payload", async () => {
  const body = providerResponse();
  mockProvider({
    ...body,
    output: [
      {
        type: "message",
        content: [{ type: "refusal", refusal: "private provider payload" }],
      },
    ],
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
    const fetchMock = mockProvider(
      { error: { code, message: "private provider payload" } },
      upstreamStatus,
    );
    const result = await POST(upload());
    assert.equal(result.status, status);
    const error = (await result.json()).error;
    assert.match(error, message);
    assert.doesNotMatch(error, /private provider payload|unit-test-key/);
    assert.equal(
      fetchMock.mock.callCount(),
      1,
      "does not automatically retry paid requests",
    );
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

test("regression: r=3, s=403, r+s=406 returns C) 406 even when the model wrote 403 (B)", async () => {
  const question =
    "For all real values of x, (12x + 28)/4 − s/13 = r(x − 8), where r and s are positive constants. What is the value of r + s? A) 390 B) 403 C) 406 D) 416";
  const choices = [
    { label: "A", text: "390" },
    { label: "B", text: "403" },
    { label: "C", text: "406" },
    { label: "D", text: "416" },
  ];
  const expressions = [
    { latex: "x_{1}=[1...5]", purpose: "Sample x-values for the identity." },
    {
      latex: "\\frac{12x_{1}+28}{4}-\\frac{s}{13}\\sim r(x_{1}-8)",
      purpose: "Fit r and s so both sides agree at every sample.",
    },
    { latex: "r+s", purpose: "Add the two fitted parameters." },
  ];
  mockProvider(
    providerResponse({
      ...solution,
      question,
      choices,
      answer: "403 (B)",
      expressions,
      readAnswer: "Line 2 shows r = 3 and s = 403, so the computed row is 403, choice B.",
      result: { row: 3, value: 406, listIndex: null, answerFrom: "value", choiceLabel: "B", detail: "r + s" },
      graphBounds: null,
    }),
  );
  const save = mock.method(dependencies, "saveProblem");
  const response = await POST(upload());
  assert.equal(response.status, 200);
  const returned = (await response.json()) as StrategySelectionResult;
  assert.equal(returned.solution.answer, "C) 406");
  assert.equal(returned.solution.result?.choiceLabel, "C");
  assert.equal(returned.solution.result?.value, 406);
  assert.deepEqual(returned.solution.expressions, expressions);
  assert.equal(
    returned.solution.readAnswer,
    "Line 3 shows r + s = 406, which matches choice C) 406.",
  );
  assert.doesNotMatch(JSON.stringify(returned.solution), /403 \(B\)|choice B/);
  assert.ok((returned.strategySelection?.repairs.length ?? 0) >= 2);
  assert.equal(save.mock.calls[0].arguments[0].solution.answer, "C) 406");
});

test("a computed value that matches no answer choice is rejected with a retryable error", async () => {
  mockProvider(
    providerResponse({
      ...solution,
      choices: [
        { label: "A", text: "390" },
        { label: "B", text: "403" },
        { label: "C", text: "406" },
        { label: "D", text: "416" },
      ],
      answer: "C) 406",
      expressions: [
        { latex: "x_{1}=[1...5]", purpose: "Sample inputs." },
        { latex: "\\frac{12x_{1}+28}{4}-\\frac{s}{13}\\sim r(x_{1}-8)", purpose: "Fit r and s." },
        { latex: "r+s", purpose: "Add the parameters." },
      ],
      readAnswer: "Read r + s on line 3.",
      result: { row: 3, value: 3, listIndex: null, answerFrom: "value", choiceLabel: "C", detail: "r" },
      graphBounds: null,
    }),
  );
  const save = mock.method(dependencies, "saveProblem");
  const response = await POST(upload());
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /Please try again/);
  assert.equal(save.mock.callCount(), 0);
});

test("graphing non-coordinate unknowns is rejected before anything is saved", async () => {
  mockProvider(
    providerResponse({
      ...solution,
      question: "-x - wy = -337 and 2x - wy = 47 intersect at (q, 19). What is w?",
      answer: "11",
      expressions: [
        { latex: "-q-19w=-337", purpose: "First equation at y = 19." },
        { latex: "2q-19w=47", purpose: "Second equation at y = 19." },
      ],
      readAnswer: "Click the intersection and read w = 11.",
      result: { row: 2, value: 11, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "w" },
      graphBounds: null,
    }),
  );
  const save = mock.method(dependencies, "saveProblem");
  const response = await POST(upload());
  assert.equal(response.status, 502);
  assert.equal(save.mock.callCount(), 0);
});

test("service tier can be disabled and falls back permanently when the project lacks priority access", async () => {
  process.env.OPENAI_SERVICE_TIER = "default";
  let sent: Record<string, unknown> | undefined;
  mock.method(globalThis, "fetch", async (_input: unknown, options?: RequestInit) => {
    sent = JSON.parse(String(options?.body));
    return Response.json(providerResponse());
  });
  assert.equal((await POST(upload())).status, 200);
  assert.equal(sent?.service_tier, undefined);

  delete process.env.OPENAI_SERVICE_TIER;
  const tiers: unknown[] = [];
  const handler = createSolveHandler(dependencies);
  mock.method(globalThis, "fetch", async (_input: unknown, options?: RequestInit) => {
    const body = JSON.parse(String(options?.body));
    tiers.push(body.service_tier);
    return body.service_tier === "priority"
      ? Response.json({ error: { code: "invalid_value", message: "Invalid value: 'priority' for service_tier." } }, { status: 400 })
      : Response.json(providerResponse());
  });
  const first = await handler(upload());
  assert.equal(first.status, 200);
  assert.match(first.headers.get("server-timing") ?? "", /desc="default"/);
  assert.equal((await handler(upload())).status, 200);
  assert.deepEqual(tiers, ["priority", undefined, undefined], "retries once, then never asks for priority again");
});

test("slider rows keep their bounds and plain rows stay {latex, purpose}", async () => {
  const expressions = [
    { latex: "k=0", purpose: "Slider for the unknown shift.", slider: { min: -5, max: 5, step: 1 } },
    { latex: "y=\\left|x-3\\right|+k", purpose: "The given graph.", slider: null },
    { latex: "y=2", purpose: "The given line.", slider: null },
  ];
  mockProvider(
    providerResponse({
      ...solution,
      question: "y=|x-3|+k meets y=2 at exactly one point. What is k?",
      answer: "2",
      expressions,
      readAnswer: "Drag k until the V touches y=2 at exactly one point; that happens at k=2.",
      result: { row: 1, value: null, listIndex: null, answerFrom: "reasoning", choiceLabel: null, detail: "the slider value where the graphs touch once" },
      graphBounds: null,
    }),
  );
  const returned = (await (await POST(upload())).json()).solution as Solution;
  assert.deepEqual(returned.expressions, [
    { latex: "k=0", purpose: "Slider for the unknown shift.", slider: { min: -5, max: 5, step: 1 } },
    { latex: "y=\\left|x-3\\right|+k", purpose: "The given graph." },
    { latex: "y=2", purpose: "The given line." },
  ]);
  assert.equal(returned.answer, "2");
});

test("a missing read instruction is generated from the result row instead of rejected", async () => {
  for (const readAnswer of [null, "", "  \n\t"]) {
    mockProvider(providerResponse({ ...solution, readAnswer }));
    const result = await POST(upload());
    assert.equal(result.status, 200);
    const returned = (await result.json()) as StrategySelectionResult;
    assert.equal(
      returned.solution.readAnswer,
      "Line 1 shows the positive x-intercept = 3; the answer is 3.",
    );
    assert.match(returned.strategySelection?.repairs.join(" ") ?? "", /read instruction was missing/);
  }
});

test("a policy-rejected plan is retried once with the rejection reason, then accepted", async () => {
  // First attempt: a written plan that admits hand algebra. Second: a calculator plan.
  const written = candidate("complete-the-square", {
    ...solution,
    method: "algebra",
    expressions: [],
    steps: ["Complete the square to find the center.", "Use the doubled radius."],
    readAnswer: null,
    result: null,
  });
  // Scored as the simplest plan, so the model legitimately selects it; the
  // server then rejects it for admitting hand algebra.
  written.scores = { ...defaultScores, student_effort: 0, manual_math_knowledge: 2, manual_algebra: 1, desmos_outsourcing: 0 };
  const firstAttempt = providerResponse({
    status: "solved", question: solution.question, choices: null, clarification: null,
    candidates: [written, candidate("b"), candidate("c")],
  }) as { output: { content: { text: string }[] }[] };
  const parsed = JSON.parse(firstAttempt.output[0].content[0].text);
  parsed.selectedCandidateId = written.id;
  parsed.solution = written.solution;
  firstAttempt.output[0].content[0].text = JSON.stringify(parsed);
  const bodies: Record<string, unknown>[] = [];
  let call = 0;
  mock.method(globalThis, "fetch", async (_input: unknown, options?: RequestInit) => {
    bodies.push(JSON.parse(String(options?.body)));
    call += 1;
    return Response.json(call === 1 ? firstAttempt : providerResponse());
  });
  const response = await POST(upload());
  assert.equal(response.status, 200);
  assert.equal(call, 2);
  assert.match(response.headers.get("server-timing") ?? "", /retry/);
  const retryInput = JSON.stringify(bodies[1].input);
  assert.match(retryInput, /previous response was REJECTED by the server at strategy_selection: The selected/);
  assert.match(retryInput, /cannot beat a calculator method/);
  assert.match(retryInput, /Preserve correct equations/);
  assert.doesNotMatch(retryInput, /BANNED|must switch methods|present its complete solution instead/);
  assert.doesNotMatch(JSON.stringify(bodies[0].input), /previous response was REJECTED/);
  assert.equal(bodies[0].instructions, bodies[1].instructions, "the cached prefix is reused");
  assert.deepEqual((await response.json()).solution, solution);
});

test("a plan rejected twice stops after one correction, without a third paid attempt", async () => {
  const provider = mockProvider(providerResponse({ ...solution, expressions: [{ latex: "-q-19w=-337", purpose: "graph" }] }));
  const response = await POST(upload());
  assert.equal(response.status, 502);
  assert.equal(provider.mock.callCount(), 2);
});

test("the student sees the recognized structure and the named trick", async () => {
  mockProvider(providerResponse());
  const returned = (await (await POST(upload())).json()).solution as Solution;
  assert.equal(returned.trick, "Read the zeros");
  assert.equal(returned.structure, "One equation, asked for its positive solution: a zeros trick.");
});

test("each mode is accepted from the form, changes the ranking, and reaches the prompt", async () => {
  let sent: Record<string, unknown> | undefined;
  mock.method(globalThis, "fetch", async (_input: unknown, options?: RequestInit) => {
    sent = JSON.parse(String(options?.body));
    return Response.json(providerResponse());
  });
  for (const [mode, label, first] of [
    ["weaponized", "MODE: Weaponized Desmos", "reusable"],
    ["desmos_first", "MODE: Desmos First", "student_effort"],
    ["fastest", "MODE: Fastest SAT Method", "steps_time"],
  ] as const) {
    const form = new FormData();
    form.set("image", new File([new Uint8Array(png)], "q.png", { type: "image/png" }));
    form.set("mode", mode);
    const response = await POST(new Request("http://localhost/api/solve", { method: "POST", body: form }));
    assert.equal(response.status, 200, mode);
    const body = (await response.json()) as StrategySelectionResult;
    assert.equal(body.strategySelection?.mode, mode);
    assert.equal(body.strategySelection?.priority[2], first);
    assert.match(JSON.stringify(sent?.input), new RegExp(label));
  }
  const bad = new FormData();
  bad.set("image", new File([new Uint8Array(png)], "q.png", { type: "image/png" }));
  bad.set("mode", "yolo");
  assert.equal((await POST(new Request("http://localhost/api/solve", { method: "POST", body: bad }))).status, 400);
});

test("a correction that keeps a hand-derived formula is still rejected", async () => {
  const bannedRows = [
    { latex: "x_{1}=[-4,2]", purpose: "x-coordinates." },
    { latex: "y_{1}\\sim m x_{1}+b", purpose: "Fit the line." },
    { latex: "a=6/m", purpose: "The slope 6/a equals m." },
  ];
  const question = "Line ℓ passes through (−4, 2) and (2, 11). Line m is 6x − ay = 15. If the lines are parallel, what is a?";
  const derived = {
    ...solution, question, answer: "4", expressions: bannedRows, readAnswer: "Read a on line 3.",
    result: { row: 3, value: 4, listIndex: null, answerFrom: "value", choiceLabel: null, detail: "a" }, graphBounds: null,
  };
  const bodies: Record<string, unknown>[] = [];
  mock.method(globalThis, "fetch", async (_input: unknown, options?: RequestInit) => {
    bodies.push(JSON.parse(String(options?.body)));
    return Response.json(providerResponse(derived));
  });
  const response = await POST(upload());
  assert.equal(response.status, 502);
  assert.equal(bodies.length, 2);
  assert.match(JSON.stringify(bodies[1].input), /strategy_policy.*a formula in the fitted parameter m/);
  assert.match(JSON.stringify(bodies[1].input), /a=6\/m/);

});

for (const mode of SOLVE_MODES) {
  test(`rational-function raw captured response reaches the saved complete solution in ${mode}`, async () => {
    const captured=JSON.parse(await readFile(new URL("./fixtures/rational-function-rejected.json", import.meta.url),"utf8"));
    const body=providerResponse();
    body.output[0].content[0].text=JSON.stringify(captured);
    const provider=mockProvider(body);
    const save=mock.method(dependencies,"saveProblem");
    const form=await upload().formData();form.set("mode",mode);
    const response=await POST(new Request("http://localhost/api/solve",{method:"POST",body:form}));
    assert.equal(response.status,200);
    assert.equal(provider.mock.callCount(),1,"complete captured response needs no correction");
    const result=await response.json();
    assert.equal(result.solution.answer,"31/5");
    assert.equal(result.solution.result.value,6.2);
    assert.equal(result.strategySelection.mode,mode);
    assert.equal(save.mock.callCount(),1);
    assert.deepEqual(save.mock.calls[0].arguments[0].solution,result.solution);
  });
}

test("a missing numeric answer is safely derived without another paid request",async()=>{
  const provider=mockProvider(providerResponse({...solution,answer:""}));
  const response=await POST(upload());
  assert.equal(response.status,200);
  assert.equal((await response.json()).solution.answer,"3");
  assert.equal(provider.mock.callCount(),1);
});

test("the single correction includes the exact Zod path and may preserve all valid rows",async()=>{
  const incomplete=providerResponse();
  const parsed=JSON.parse(incomplete.output[0].content[0].text);
  delete parsed.solution.expressions[0].purpose;
  incomplete.output[0].content[0].text=JSON.stringify(parsed);
  const bodies:Record<string,unknown>[]=[];
  mock.method(globalThis,"fetch",async(_input:unknown,options?:RequestInit)=>{
    bodies.push(JSON.parse(String(options?.body)));
    return Response.json(bodies.length===1 ? incomplete : providerResponse());
  });
  const response=await POST(upload());
  assert.equal(response.status,200);
  assert.equal(bodies.length,2);
  assert.match(JSON.stringify(bodies[1].input),/at zod: solution.expressions.0.purpose/);
  assert.match(JSON.stringify(bodies[1].input),/Previous response to correct/);
  assert.doesNotMatch(JSON.stringify(bodies[1].input),/BANNED|must switch/);
  assert.deepEqual((await response.json()).solution.expressions,solution.expressions);
  assert.deepEqual(bodies[1].reasoning,{effort:"medium"});
});

test("development rejection exposes the exact stage and stores exact raw response without request credentials",async(t)=>{
  const previous=process.env.NODE_ENV;
  Object.assign(process.env,{NODE_ENV:"development"});
  t.after(()=>{if(previous===undefined) delete (process.env as Record<string,string|undefined>).NODE_ENV; else Object.assign(process.env,{NODE_ENV:previous});});
  mock.method(console,"error",()=>undefined);
  const raw=providerResponse();
  const invalid=JSON.parse(raw.output[0].content[0].text);
  invalid.solution.result={...invalid.solution.result,type:"numeric",relatedRows:[],row:null};
  raw.output[0].content[0].text=JSON.stringify(invalid);
  const provider=mockProvider(raw);
  const save=mock.method(dependencies,"saveProblem");
  const response=await POST(upload());
  assert.equal(response.status,502);
  assert.equal(provider.mock.callCount(),2);
  assert.equal(save.mock.callCount(),0);
  const rejected=await response.json();
  assert.equal(rejected.validation.stage,"result_contract");
  assert.match(rejected.error,/numeric requires an existing calculator row/);
  for(const attempt of [1,2]) {
    const file=`.desmo-debug/${rejected.diagnosticId}-desmos_first-${attempt}.json`;
    t.after(()=>unlink(file));
    const logged=await readFile(file,"utf8");
    const diagnostic=JSON.parse(logged);
    assert.deepEqual(diagnostic.response.output,raw.output);
    assert.equal(diagnostic.response.status,raw.status);
    assert.equal(diagnostic.response.output_text,raw.output[0].content[0].text);
    assert.equal(diagnostic.rejection.message,rejected.validation.message);
    assert.equal(diagnostic.rejection.stage,"result_contract");
    assert.doesNotMatch(logged,/unit-test-key|data:image|Authorization/);
  }
});
