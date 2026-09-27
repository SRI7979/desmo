/**
 * Latency benchmark for the solve prompt. Spends real OpenAI credits.
 *
 *   npx tsx scripts/bench-solve.mts <variant>[,<variant>...] <image.png>...
 *
 * Variants: current | minimal | compact | priority | compact+priority
 * Builds the exact request src/lib/solve-handler.ts sends, so timings match
 * the app. Results append to bench-results.jsonl next to the images.
 */
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { readFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import {
  buildUserPrompt,
  STRATEGY_INSTRUCTIONS,
  TRAINING_EXAMPLE_INSTRUCTIONS,
} from "../src/lib/solver-instructions";
import { DEFAULT_SOLVE_MODE, SOLVE_MODES, type SolveMode } from "../src/lib/solver-schema";
import {
  compactStrategyPortfolioSchema,
  selectCompactStrategy,
} from "../src/lib/strategy-selection";
import { loadTrainingExamples } from "../src/lib/training-examples";

type Variant = {
  effort: "minimal" | "low" | "medium";
  schema: z.ZodTypeAny;
  serviceTier?: "default" | "priority";
  userText: string;
};

// BENCH_MODE=weaponized|desmos_first|fastest selects the production mode text.
const MODE: SolveMode =
  SOLVE_MODES.find((mode) => mode === process.env.BENCH_MODE) ?? DEFAULT_SOLVE_MODE;
const USER_TEXT = buildUserPrompt(MODE);

// Tighter prose limits and a lower candidate cap: same contract, fewer output tokens.
function compactSchema() {
  const candidate = compactStrategyPortfolioSchema.shape.candidates.element as z.ZodObject<z.ZodRawShape>;
  const solution = compactStrategyPortfolioSchema.shape.solution.unwrap() as z.ZodObject<z.ZodRawShape>;
  const expression = (solution.shape.expressions as z.ZodArray<z.ZodObject<z.ZodRawShape>>).element;
  return compactStrategyPortfolioSchema.extend({
    candidates: z
      .array(
        candidate.extend({
          name: z.string().min(1).max(60),
          humanWork: z.string().min(1).max(160),
          desmosWork: z.string().min(1).max(160),
          validityNote: z.string().min(1).max(160),
        }),
      )
      .max(4),
    solution: solution
      .extend({
        why: z.string().max(240),
        expressions: z
          .array(expression.extend({ purpose: z.string().max(160) }))
          .max(16),
      })
      .nullable(),
  });
}

const VARIANTS: Record<string, Variant> = {
  current: { effort: "low", schema: compactStrategyPortfolioSchema, userText: USER_TEXT },
  minimal: { effort: "minimal", schema: compactStrategyPortfolioSchema, userText: USER_TEXT },
  compact: {
    effort: "low",
    schema: compactSchema(),
    userText: USER_TEXT.replace("3–6 distinct methods", "3 distinct methods (a 4th only if genuinely different)"),
  },
  priority: { effort: "low", schema: compactStrategyPortfolioSchema, serviceTier: "priority", userText: USER_TEXT },
  "compact+priority": {
    effort: "low",
    schema: compactSchema(),
    serviceTier: "priority",
    userText: USER_TEXT.replace("3–6 distinct methods", "3 distinct methods (a 4th only if genuinely different)"),
  },
};

async function main() {
  const [variantList, ...images] = process.argv.slice(2);
  const variants = (variantList ?? "current").split(",");
  if (!images.length) throw new Error("Pass at least one image path.");
  const env = await readFile(path.join(process.cwd(), ".env.local"), "utf8");
  const apiKey = /^OPENAI_API_KEY=(.+)$/m.exec(env)?.[1]?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY missing from .env.local");
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-5-mini";
  const [library, training] = await Promise.all([
    readFile(path.join(process.cwd(), "src/content/desmos-tricks.md"), "utf8"),
    loadTrainingExamples(),
  ]);
  const instructions = `${STRATEGY_INSTRUCTIONS}\n\n<strategy_library>\n${library}\n</strategy_library>\n\n${TRAINING_EXAMPLE_INSTRUCTIONS}\n\n<training_examples>\n${training.prompt}\n</training_examples>`;
  const client = new OpenAI({ apiKey, timeout: 170_000, maxRetries: 0 });
  const output = path.join(path.dirname(images[0]), "bench-results.jsonl");

  for (const name of variants) {
    const variant = VARIANTS[name];
    if (!variant) throw new Error(`Unknown variant ${name}`);
    const format = zodTextFormat(variant.schema, "sat_math_strategy_selection");
    for (const image of images) {
      const bytes = await readFile(image);
      const started = performance.now();
      let row: Record<string, unknown> = { variant: name, image: path.basename(image) };
      try {
        const attempt = (rejection?: string) => client.responses.parse({
          model,
          prompt_cache_key: `bench-${name}`,
          instructions,
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: variant.userText },
                { type: "input_image", image_url: `data:image/png;base64,${bytes.toString("base64")}`, detail: "high" },
                ...(rejection
                  ? [{ type: "input_text" as const, text: `Your previous response was REJECTED by the server: ${rejection} The following rows are BANNED for this question and must not reappear in any form: ${bannedRows.map((r) => `"${r}"`).join(", ")}. You must switch methods: select the runner-up candidate named above (or another calculator method built only from the question's own numbers) and present its complete rows. Any plan that defines a value by a formula in a fitted parameter, uses numbers the question never states, or rearranges an equation by hand has simplicity at most 2 and manual math at least 3 by rule and cannot win. Prefer graphing the given equations with the unknown as a slider, a regression on the original equation, or a list. Every row must be executable and the result row and value must give the answer.` }]
                  : []),
              ],
            },
          ],
          text: { format, verbosity: "low" },
          reasoning: { effort: variant.effort },
          max_output_tokens: 8000,
          store: false,
          ...(variant.serviceTier ? { service_tier: variant.serviceTier } : {}),
        });
        let bannedRows: string[] = [];
        let response = await attempt();
        // Mirror the production handler: up to two guided retries.
        const rejections: string[] = [];
        for (let attemptNumber = 1; attemptNumber < 3; attemptNumber += 1) {
          const parsedAttempt = response.output_parsed as z.infer<typeof compactStrategyPortfolioSchema> | null;
          if (!parsedAttempt || parsedAttempt.status !== "solved") break;
          try {
            selectCompactStrategy(parsedAttempt, { mode: MODE });
            break;
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            rejections.push(reason.slice(0, 160));
            bannedRows = [...bannedRows, ...(parsedAttempt.solution?.expressions.map((e) => e.latex) ?? [])];
            response = await attempt(rejections.join(" Then, after that, "));
            row.retried = attemptNumber;
          }
        }
        if (rejections.length) row.rejections = rejections;
        const usage = response.usage;
        row = {
          ...row,
          ms: Math.round(performance.now() - started),
          status: response.status,
          serviceTier: (response as { service_tier?: string }).service_tier,
          input: usage?.input_tokens,
          cached: usage?.input_tokens_details?.cached_tokens,
          output: usage?.output_tokens,
          reasoning: usage?.output_tokens_details?.reasoning_tokens,
        };
        const parsed = response.output_parsed as z.infer<typeof compactStrategyPortfolioSchema> | null;
        if (parsed) {
          row.candidates = parsed.candidates.length;
          if (parsed.status === "needs_clarification") row.clarification = parsed.clarification;
          row.question = parsed.question.slice(0, 200);
          row.selected = parsed.selectedCandidateId;
          row.mode = MODE;
          row.structure = parsed.structure;
          row.scorecards = parsed.candidates.map((c) => {
            const s = c.scores;
            return `${c.id}: ok${s.correctness} simp${s.simplicity} eff${s.student_effort} reuse${c.reusable ? 1 : 0} math${s.manual_math_knowledge + s.manual_algebra + s.manual_calculation} rows${s.steps_time} out${s.desmos_outsourcing} rel${s.reliability} — ${c.trick} (${c.name})`;
          });
          row.result = parsed.solution?.result;
          row.choices = parsed.choices;
          row.readAnswer = parsed.solution?.readAnswer;
          try {
            const selected = selectCompactStrategy(parsed, { mode: MODE });
            row.answer = selected.solution.answer;
            row.trick = selected.solution.trick;
            row.rows = selected.solution.expressions.length;
            row.latex = selected.solution.expressions.map((e) => e.latex);
            row.repairs = selected.strategySelection?.repairs;
          } catch (error) {
            row.rejected = String(error instanceof Error ? error.message : error);
            row.modelAnswer = parsed.solution?.answer;
            row.latex = parsed.solution?.expressions.map((e) => e.latex);
          }
        }
      } catch (error) {
        row = { ...row, ms: Math.round(performance.now() - started), error: String(error).slice(0, 300) };
      }
      console.log(JSON.stringify(row));
      await appendFile(output, `${JSON.stringify(row)}\n`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
