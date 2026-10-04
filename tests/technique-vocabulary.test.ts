import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { zodTextFormat } from "openai/helpers/zod";

import { buildCandidatePrompt, CANDIDATE_INSTRUCTIONS, EXPLANATION_INSTRUCTIONS } from "../src/lib/solver-instructions";
import { candidateSchema, candidatesResponseSchema } from "../src/lib/strategy-selection";
import { TECHNIQUE_ANNOTATION, TECHNIQUE_IDS, TECHNIQUES, isTechniqueId } from "../src/lib/technique-vocabulary";
import { graphCandidate } from "./method-fixtures";

async function library() {
  return readFile(path.join(process.cwd(), "src/content/desmos-tricks.md"), "utf8");
}

test("technique ids and display names are unique, short, and stable", () => {
  assert.equal(new Set(TECHNIQUE_IDS).size, TECHNIQUES.length);
  assert.equal(new Set(TECHNIQUES.map((technique) => technique.name)).size, TECHNIQUES.length);
  for (const technique of TECHNIQUES) {
    assert.match(technique.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(technique.name.length <= 32, `${technique.name} is short enough for a dropdown`);
  }
  const standard = TECHNIQUES.filter((technique) => technique.source === "standard").map((technique) => technique.id);
  for (const id of ["quadratic-formula", "factoring", "completing-the-square", "substitution", "elimination", "plug-in-choices", "direct-arithmetic"]) {
    assert.ok(standard.includes(id as (typeof standard)[number]), `${id} is a standard non-Desmos technique`);
  }
});

test("every one of the 77 library strategies carries a vocabulary technique tag directly under its heading", async () => {
  const lines = (await library()).split("\n");
  let expected = 1;
  const tagged = new Map<number, string>();
  lines.forEach((line, index) => {
    const heading = line.match(/^(\d+)\. \S/);
    if (!heading || Number(heading[1]) !== expected || expected > 77) return;
    const tag = lines[index + 1]?.match(TECHNIQUE_ANNOTATION);
    assert.ok(tag, `strategy ${expected} ("${line}") needs a [technique: id | name] line`);
    tagged.set(expected, tag[1]);
    expected += 1;
  });
  assert.equal(tagged.size, 77);
});

test("library annotations and the code vocabulary agree exactly", async () => {
  const annotations = (await library())
    .split("\n")
    .map((line) => line.match(TECHNIQUE_ANNOTATION))
    .filter((match): match is RegExpMatchArray => match !== null);
  const used = new Set<string>();
  for (const [, id, name] of annotations) {
    assert.ok(isTechniqueId(id), `${id} is in the vocabulary`);
    const technique = TECHNIQUES.find((item) => item.id === id)!;
    assert.equal(technique.source, "library", `${id} is a library technique`);
    assert.equal(name, technique.name, `${id} uses its vocabulary display name`);
    used.add(id);
  }
  for (const technique of TECHNIQUES.filter((item) => item.source === "library")) {
    assert.ok(used.has(technique.id), `${technique.id} is taught by some library strategy`);
  }
});

test("regression test 4: only vocabulary ids validate; a free-form technique name fails", () => {
  for (const id of TECHNIQUE_IDS) {
    assert.equal(candidateSchema.safeParse(graphCandidate({ techniqueId: id })).success, true, id);
  }
  for (const freeForm of ["Graph both sides", "Intersection trick", "my-clever-trick", ""]) {
    assert.equal(candidateSchema.safeParse({ ...graphCandidate(), techniqueId: freeForm }).success, false, freeForm);
  }
  // The structured-output schema sent to the model enumerates exactly the vocabulary.
  const schema = JSON.stringify(zodTextFormat(candidatesResponseSchema, "desmo_candidates"));
  for (const id of TECHNIQUE_IDS) assert.match(schema, new RegExp(`"${id}"`));
});

test("the candidates prompt teaches the vocabulary, the ladder, and the cost contract with no prose fields", () => {
  for (const pattern of [
    /TECHNIQUES \(a controlled vocabulary; a free-form name is rejected\)/,
    /completing-the-square \(Completing the square\)/,
    /translate-the-words \(Translate the words\)/,
    /SIMPLICITY LADDER/,
    /Every candidate has a DISTINCT techniqueId/,
    /two real techniques beat four with filler/,
    /Enumerate EVERY technique in the vocabulary that validly solves this/,
    /Validity is the filter; optimality only decides the/,
    /COST COMPONENTS/,
    /PRIMITIVE WHITELIST costs 0/,
    /Write no explanations, row purposes, or\s+read-the-result prose/,
  ]) {
    assert.match(CANDIDATE_INSTRUCTIONS, pattern);
  }
  assert.doesNotMatch(CANDIDATE_INSTRUCTIONS, /THE IDEA paragraph|Each purpose is a student-facing/);
  assert.match(EXPLANATION_INSTRUCTIONS, /THE IDEA paragraph/);
  assert.match(buildCandidatePrompt(), /up to 6 candidates, each a distinct techniqueId/);
});

test("regression test 10 (prompt side): no solver mode survives in either prompt or the library", async () => {
  const text = [CANDIDATE_INSTRUCTIONS, EXPLANATION_INSTRUCTIONS, buildCandidatePrompt(), await library()].join("\n");
  assert.doesNotMatch(text, /Weaponized|Desmos First|Fastest SAT|active mode|MODE:/);
  const schema = JSON.stringify(zodTextFormat(candidatesResponseSchema, "desmo_candidates"));
  assert.doesNotMatch(schema, /"mode"/);
});
