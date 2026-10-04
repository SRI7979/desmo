/**
 * Token budget of every solver request, part by part, counted with the
 * o200k_base tokenizer the GPT-5 family uses. Answers "where do the input
 * tokens go, and what would selective strategy retrieval save?" without a
 * model call. Free.
 *
 *   npm run bench:prompt
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { encode } from "gpt-tokenizer/encoding/o200k_base";
import { zodTextFormat } from "openai/helpers/zod";

import { candidatesResponseSchema } from "../src/lib/strategy-selection";
import { explanationSchema } from "../src/lib/solve-cache";
import { buildCandidatePrompt, CANDIDATE_INSTRUCTIONS, EXPLANATION_INSTRUCTIONS, TRAINING_EXAMPLE_INSTRUCTIONS } from "../src/lib/solver-instructions";
import { loadTrainingExamples } from "../src/lib/training-examples";
import { TECHNIQUE_ANNOTATION } from "../src/lib/technique-vocabulary";

const tokens = (text: string) => encode(text).length;
const library = await readFile(path.join(process.cwd(), "src/content/desmos-tricks.md"), "utf8");
const training = await loadTrainingExamples();
const candidateSchema = JSON.stringify(zodTextFormat(candidatesResponseSchema, "desmo_candidates"));
const explanationSchemaText = JSON.stringify(zodTextFormat(explanationSchema, "desmo_explanation"));

// Library sections: the policy preamble, then one block per numbered strategy.
const lines = library.split("\n");
const strategyStarts = lines.flatMap((line, index) => (/^\d{1,2}\. \S/.test(line) && !/^\d\. [a-z_]/.test(line) ? [index] : []));
const preamble = lines.slice(0, strategyStarts[0]).join("\n");
const strategies = strategyStarts.map((start, index) => {
  const body = lines.slice(start, strategyStarts[index + 1] ?? lines.length).join("\n");
  const technique = body.split("\n").map((line) => TECHNIQUE_ANNOTATION.exec(line.trim())?.[1]).find(Boolean) ?? "(untagged)";
  return { title: lines[start].slice(0, 70), technique, tokens: tokens(body) };
});

const parts = {
  "candidate instructions (rules, cost model, syntax)": tokens(CANDIDATE_INSTRUCTIONS),
  "strategy library: policy preamble": tokens(preamble),
  "strategy library: numbered strategies": strategies.reduce((sum, item) => sum + item.tokens, 0),
  "training-example instructions": tokens(TRAINING_EXAMPLE_INSTRUCTIONS),
  "training examples": tokens(training.prompt),
  "per-request user text": tokens(buildCandidatePrompt()),
  "candidates output schema (structured outputs)": tokens(candidateSchema),
};
const total = Object.values(parts).reduce((sum, value) => sum + value, 0);
console.log("CALL 1 (candidates) input, excluding the image (~1,100-1,500 tokens at detail high for a 1600 px screenshot):\n");
console.log("| Part | Tokens | Share |\n|---|---|---|");
for (const [name, count] of Object.entries(parts)) console.log(`| ${name} | ${count} | ${((count / total) * 100).toFixed(1)}% |`);
console.log(`| **total** | **${total}** | |`);
console.log(`\nCALL 2 (explanation): instructions ${tokens(EXPLANATION_INSTRUCTIONS)} + schema ${tokens(explanationSchemaText)} tokens, plus the per-method facts (~300-700).`);

const byTechnique = new Map<string, number>();
for (const item of strategies) byTechnique.set(item.technique, (byTechnique.get(item.technique) ?? 0) + item.tokens);
const largest = [...strategies].sort((a, b) => b.tokens - a.tokens).slice(0, 8);
console.log(`\n${strategies.length} numbered strategies; largest:`);
for (const item of largest) console.log(`  ${String(item.tokens).padStart(5)}  ${item.technique.padEnd(24)} ${item.title}`);
const median = [...strategies].sort((a, b) => a.tokens - b.tokens)[Math.floor(strategies.length / 2)].tokens;
console.log(`\nSelective retrieval estimate: sending the preamble plus 8 relevant strategies (~${8 * median} tokens at the median ${median}) instead of all ${parts["strategy library: numbered strategies"]} would cut call-1 input by ~${Math.max(0, parts["strategy library: numbered strategies"] - 8 * median)} tokens (${(((parts["strategy library: numbered strategies"] - 8 * median) / total) * 100).toFixed(0)}%).`);
