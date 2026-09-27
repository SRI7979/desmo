import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { validateModelResponse, SolveValidationError } from "../src/lib/solve-output";
import { SOLVE_MODES, solutionSchema, type SolutionResult } from "../src/lib/solver-schema";
import { reconcileWithCalculator } from "../src/lib/answer-consistency";
import { findDerivedDefinitions, normalizeDesmosExpressions } from "../src/lib/desmos-latex";

// Exact captured model output from the reported rational-function failure.
const captured = JSON.parse(readFileSync(new URL("./fixtures/rational-function-rejected.json", import.meta.url), "utf8"));
const raw = (payload: unknown) => ({status:"completed", output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(payload)}]}]});
const fixture = () => structuredClone(captured);
const numericResult = (): SolutionResult => ({type:"numeric",row:4,relatedRows:[],value:6.2,listIndex:null,answerFrom:"value",choiceLabel:null,detail:"g(3)"});
function directFixture() {
  const payload = fixture();
  payload.solution.expressions = [
    {latex:"f(x)=ax^2+bx+c",purpose:"Define the quadratic numerator."},
    {latex:"g(x)=f(x)/(x+2)",purpose:"Define the given rational function."},
    {latex:"[f(0),g(1),g(4)]~[10,5,7]",purpose:"Fit all three conditions, keeping the f-intercept separate from the g-values."},
    {latex:"g(3)",purpose:"Evaluate the requested output."},
  ];
  payload.solution.result = numericResult();
  payload.solution.readAnswer = "Line 4 shows g(3) = 6.2.";
  return payload;
}
function fails(payload: unknown, stage: string, message: RegExp) {
  assert.throws(() => validateModelResponse(raw(payload),"desmos_first"), error => {
    assert.ok(error instanceof SolveValidationError);
    assert.equal(error.stage,stage);
    assert.match(error.message,message);
    return true;
  });
}

for (const mode of SOLVE_MODES) {
  test(`rational-function captured false rejection is accepted in ${mode}`, () => {
    const result=validateModelResponse(raw(fixture()),mode);
    assert.equal(result.solution.answer,"31/5");
    assert.equal(result.solution.result?.value,6.2);
    assert.ok(solutionSchema.safeParse(result.solution).success,"shared client/history schema accepts the result");
    assert.match(result.solution.expressions[3].latex,/g_\{3\}/);
    assert.deepEqual(result.solution.steps,[]);
    assert.equal(result.strategySelection?.mode,mode);
  });
  test(`rational-function bracket fit and function readout pass in ${mode}`, () => {
    const payload=directFixture();
    const result=validateModelResponse(raw(payload),mode);
    assert.equal(result.solution.result?.value,6.2);
    assert.ok(solutionSchema.safeParse(result.solution).success,"shared client/history schema accepts the result");
    assert.deepEqual(result.solution.expressions,payload.solution.expressions);
    assert.equal(result.solution.readAnswer,payload.solution.readAnswer);
  });
}

for (const mode of SOLVE_MODES) {
  test(`synthetic fitted-parameter result alias is repaired in ${mode}`, () => {
    const payload=fixture();
    payload.question="If (3/4)x+ay=b and (7/6)x+cy=3d have infinitely many solutions, what is b/d?";
    payload.choices=null;
    payload.structure="Two equations represent the same line, so their matching coefficients have one scale factor.";
    payload.solution.answer="27/14";
    payload.solution.why="Fit the common coefficient scale k, then let Desmos evaluate the requested ratio as 3k.";
    payload.solution.expressions=[
      {latex:"x_{1}=[1]",purpose:"Use one deterministic input for the coefficient fit."},
      {latex:"y_{1}=[3/4]",purpose:"Copy the first x-coefficient."},
      {latex:"y_{1}\\sim k(7/6x_{1})",purpose:"Fit the scale factor between the x-coefficients."},
      {latex:"R=3k",purpose:"Evaluate b/d from the fitted scale and the given 3d."},
    ];
    payload.solution.readAnswer="Line 4 displays b/d = 27/14.";
    payload.solution.result={type:"numeric",row:4,relatedRows:[3],value:27/14,listIndex:null,answerFrom:"value",choiceLabel:null,detail:"b/d"};
    const result=validateModelResponse(raw(payload),mode);
    assert.equal(result.solution.answer,"27/14");
    assert.equal(result.solution.expressions[3].latex,"3k");
    assert.match(result.strategySelection?.repairs.join(" ") ?? "",/Removed the synthetic result alias/);
  });
}

test("only proven requested-model substitution is exempt from hidden algebra", () => {
  const payload=fixture();
  const rows=normalizeDesmosExpressions(payload.solution.expressions);
  assert.deepEqual(findDerivedDefinitions(rows,payload.question),[]);
  for (const latex of ["g_{3}=(a*9+b*3+11)/5", "g_{4}=(a*16+b*4+10)/6", "r=6/a", "s=-48*b"]) {
    const changed=[...rows.slice(0,3),{latex,purpose:"An unsupported derived output."}];
    assert.equal(findDerivedDefinitions(changed,payload.question).length,1,latex);
  }
});

test("safe metadata repairs preserve every mathematical row and purpose", () => {
  const payload=directFixture();
  delete payload.solution.steps;
  delete payload.solution.graphBounds;
  delete payload.solution.readAnswer;
  delete payload.solution.result.relatedRows;
  delete payload.solution.result.choiceLabel;
  delete payload.solution.result.listIndex;
  delete payload.solution.result.detail;
  payload.solution.answer="";
  const result=validateModelResponse(raw(payload),"desmos_first");
  assert.deepEqual(result.solution.expressions,payload.solution.expressions);
  assert.equal(result.solution.answer,"6.2");
  assert.match(result.solution.readAnswer ?? "",/Line 4.*6.2/);
  assert.ok((result.strategySelection?.repairs.length ?? 0)>0);
});

test("missing result is recovered only from an explicit function output row and matching read instruction", () => {
  const payload=directFixture();
  payload.solution.result=null;
  assert.equal(validateModelResponse(raw(payload),"fastest").solution.result?.value,6.2);
  payload.solution.readAnswer="The answer is 6.2.";
  fails(payload,"result_contract",/identify how to read/);
  payload.solution.readAnswer="Line 3 gives 6.2.";
  fails(payload,"result_contract",/identify how to read/);
  payload.solution.readAnswer="Line 4 gives 16.2.";
  fails(payload,"result_contract",/identify how to read/);
});

const graphicalTypes = ["intersection","x_intercept","y_intercept","vertex","graph_overlap","slider_condition","visual_choice"] as const;
for (const type of graphicalTypes) {
  for (const mode of SOLVE_MODES) {
    test(`${mode}: ${type} needs graph evidence, not a numeric calculator row`, () => {
      const payload=fixture();
      payload.question="Inspect the given graphs y=x^2 and y=4.";
      payload.solution.expressions=[{latex:"y=x^2",purpose:"Graph the curve."},{latex:"y=4",purpose:"Graph the comparison line."}];
      payload.solution.answer="The indicated graph condition.";
      payload.solution.readAnswer="Inspect line 1 and line 2 for the indicated graph condition.";
      payload.solution.result={type,row:1,relatedRows:[2],value:null,listIndex:null,answerFrom:"reasoning",choiceLabel:null,detail:"the indicated graph condition"};
      const {solution}=validateModelResponse(raw(payload),mode);
      assert.ok(solutionSchema.safeParse(solution).success);
      assert.equal(solution.expressions.length,2);
      assert.equal(solution.result?.value,null);
      assert.equal(solution.answer,payload.solution.answer);
      // Graph rows may have incidental evaluations; these cannot overwrite a visual answer.
      assert.deepEqual(reconcileWithCalculator(solution,{type:"Number",value:999}),{status:"unverified"});
    });
  }
}
for (const mode of SOLVE_MODES) {
  test(`${mode}: conceptual result has no calculator row`, () => {
    const payload=fixture();
    payload.question="A school has n ninth graders and 2n+18 tenth graders, 162 total. Which equation represents this?";
    payload.solution.expressions=[];
    payload.solution.method="shortcut";
    payload.solution.answer="3n+18=162";
    payload.solution.steps=["Translate the quantities: n+(2n+18)=162, so 3n+18=162."];
    payload.solution.why="Translation identifies the model; solving it would not help choose the equation.";
    payload.solution.readAnswer=null;
    payload.solution.result={type:"written",row:null,relatedRows:[],value:null,listIndex:null,answerFrom:"reasoning",choiceLabel:null,detail:"the equation representing the total"};
    payload.candidates[0].scores={...payload.candidates[0].scores,manual_math_knowledge:0,manual_algebra:0,manual_calculation:0,desmos_outsourcing:0};
    const {solution}=validateModelResponse(raw(payload),mode);
    assert.ok(solutionSchema.safeParse(solution).success);
    assert.equal(solution.result?.row,null);
    assert.equal(solution.answer,"3n+18=162");
    assert.deepEqual(solution.steps,payload.solution.steps);
  });
}

test("list-entry result retains the index and value, including choice-position semantics", () => {
  const payload=fixture();
  payload.choices=[{label:"A",text:"4"},{label:"B",text:"5"}];
  payload.solution.expressions=[{latex:"[4,5]-5",purpose:"Test both answer choices against the target."}];
  payload.solution.result={type:"list_entry",row:1,relatedRows:[],value:0,listIndex:2,answerFrom:"choice_position",choiceLabel:"B",detail:"the entry equal to zero"};
  payload.solution.answer="B) 5";
  payload.solution.readAnswer="Entry 2 of line 1 is zero, so choose B) 5.";
  const {solution}=validateModelResponse(raw(payload),"desmos_first");
  assert.equal(solution.result?.listIndex,2);
  assert.equal(solution.answer,"B) 5");
});

test("malformed result types cannot fall back to the legacy result schema", () => {
  for (const change of [{type:"made_up"},{row:"4"},{relatedRows:["1"]}]) {
    const payload=directFixture();
    Object.assign(payload.solution.result,change);
    fails(payload,"zod",/solution.result/);
  }
});

test("result contracts reject missing numbers, list indices, graph evidence, and written rows", () => {
  for (const change of [{value:null},{answerFrom:"choice_position"},{row:5},{relatedRows:[8]},{listIndex:1},{type:"list_entry",listIndex:null},{type:"intersection",relatedRows:[]},{type:"written",row:4}]) {
    const payload=directFixture();Object.assign(payload.solution.result,change);
    fails(payload,"result_contract",/requires|reference|cannot|identify/);
  }
});

test("mathematical rows, choices, and schema omissions still fail with their own layer", () => {
  const payload=directFixture();
  delete payload.solution.expressions[0].purpose;
  fails(payload,"zod",/solution.expressions.0.purpose/);
  const undefinedFunction=directFixture();
  undefinedFunction.solution.expressions[3].latex="h(3)";
  fails(undefinedFunction,"desmos_syntax",/undefined h/);
  const wrongChoice=directFixture();
  wrongChoice.choices=[{label:"A",text:"5.2"},{label:"B",text:"7.2"}];
  fails(wrongChoice,"answer_consistency",/does not match/);
});

test("provider truncation and JSON syntax errors are distinguished from Zod", () => {
  assert.throws(()=>validateModelResponse({...raw(fixture()),status:"incomplete",incomplete_details:{reason:"max_output_tokens"}},"weaponized"), error => error instanceof SolveValidationError && error.stage === "model_output" && /max_output_tokens/.test(error.message));
  assert.throws(()=>validateModelResponse({status:"completed",output:[{type:"message",content:[{type:"output_text",text:'{"status":'}]}]},"fastest"),error => error instanceof SolveValidationError && error.stage === "json");
});
