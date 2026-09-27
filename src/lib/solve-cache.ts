import { createHash } from "node:crypto";
import { z } from "zod";

import { answerChoiceSchema, type AnswerChoice } from "./solver-schema";
import { methodSchema, type Method } from "./strategy-selection";
import { TECHNIQUE_IDS } from "./technique-vocabulary";

/**
 * Determinism cache: the same problem returns the same methods, the same order,
 * and the same default every time.
 *
 *   cacheKey = sha256(normalized problem text + choices) + "." + promptConfigVersion
 *
 * The problem key comes from the extracted text, never raw image bytes, so a
 * differently cropped screenshot of the same problem maps to the same entry.
 * An identical re-upload (the same image bytes, or the same problem text)
 * skips even the extraction call: its input hash maps straight to the key. promptConfigVersion hashes everything that shapes
 * a result, so improvements always reach previously cached problems.
 */

export const CACHE_ENTRY_VERSION = 1;

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Transcription-invariant text: the same problem transcribed twice with
 * different spacing, Unicode operators, or superscript styles normalizes to
 * the same string. Content (digits, letters, operators, punctuation) is kept.
 */
export function normalizeProblemText(text: string): string {
  return text
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .normalize("NFKC")
    .replace(/[−–—]/g, "-")
    .replace(/[×·⋅∙]/g, "*")
    .replace(/÷/g, "/")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/≠/g, "!=")
    .replace(/π/g, "pi")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\^\{([^{}]+)\}/g, "^$1")
    .toLowerCase()
    .replace(/\s+/g, "");
}

export function problemKey(question: string, choices: readonly AnswerChoice[] | null): string {
  return sha256(
    JSON.stringify({
      question: normalizeProblemText(question),
      choices: choices?.map((choice) => [choice.label.trim().toUpperCase(), normalizeProblemText(choice.text)]) ?? null,
    }),
  );
}

export function cacheKeyFor(key: string, promptConfigVersion: string): string {
  return `${key}.${promptConfigVersion}`;
}

/** The exact submitted input: image bytes, or the problem text and choices. */
export function inputHash(input: Uint8Array | { problem: string; choices: readonly string[] | null }): string {
  const hash = createHash("sha256");
  if (input instanceof Uint8Array) hash.update("image:").update(input);
  else hash.update(`text:${JSON.stringify([input.problem, input.choices])}`);
  return hash.digest("hex");
}

/**
 * Everything that shapes a cached result: both prompts, the strategy library,
 * the training examples, the cost weights, the technique vocabulary, the
 * response schemas, and the model. Any change yields a new version, so the
 * next solve of a cached problem regenerates.
 */
export function promptConfigVersion(parts: {
  candidateInstructions: string;
  explanationInstructions: string;
  strategyLibrary: string;
  trainingExamples: string;
  candidatePrompt: string;
  costWeights: unknown;
  vocabulary: unknown;
  schemas: unknown;
  model: string;
}): string {
  return sha256(JSON.stringify(parts)).slice(0, 24);
}

// The fixed-length purposes list comes last: ahead of other fields, models
// were observed to spill readAnswer and steps into it as extra strings.
export const explanationSchema = z
  .object({
    why: z.string().min(1).max(1200),
    readAnswer: z.string().max(1000).nullable(),
    steps: z.array(z.string().min(1).max(800)).max(5),
    purposes: z.array(z.string().min(1).max(600)).max(16),
  })
  .strict();
export type Explanation = z.infer<typeof explanationSchema>;

export const cacheEntrySchema = z.object({
  version: z.literal(CACHE_ENTRY_VERSION),
  cacheKey: z.string().min(1),
  promptConfigVersion: z.string().min(1),
  question: z.string(),
  choices: z.array(answerChoiceSchema).nullable(),
  structure: z.string().nullable(),
  methods: z.array(methodSchema).min(1),
  winnerId: z.string().min(1),
  modelPreference: z.enum(TECHNIQUE_IDS).nullable(),
  createdAt: z.string(),
});
export type CacheEntry = z.infer<typeof cacheEntrySchema>;

export function eligibleMethods(entry: CacheEntry): Method[] {
  return entry.methods.filter((method) => method.rejected === null);
}

export function findMethod(entry: CacheEntry, methodId: string): Method | null {
  return eligibleMethods(entry).find((method) => method.id === methodId) ?? null;
}

/**
 * Writes are first-writer-wins: two concurrent solves of the same problem
 * both end up returning whichever entry (or explanation) was stored first.
 */
export interface SolveCache {
  lookupInput(inputHash: string, promptConfigVersion: string): Promise<string | null>;
  rememberInput(inputHash: string, promptConfigVersion: string, cacheKey: string): Promise<void>;
  getEntry(cacheKey: string): Promise<CacheEntry | null>;
  putEntry(entry: CacheEntry): Promise<CacheEntry>;
  getExplanation(cacheKey: string, methodId: string): Promise<Explanation | null>;
  putExplanation(cacheKey: string, methodId: string, explanation: Explanation): Promise<Explanation>;
}

function parseEntry(value: unknown): CacheEntry | null {
  const parsed = cacheEntrySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseExplanation(value: unknown): Explanation | null {
  const parsed = explanationSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Process-local cache for tests and the eval harness (no persistence). */
export function createMemorySolveCache(): SolveCache & { size(): { entries: number; explanations: number; inputs: number } } {
  const inputs = new Map<string, string>();
  const entries = new Map<string, CacheEntry>();
  const explanations = new Map<string, Explanation>();
  const clone = <T>(value: T): T => structuredClone(value);
  return {
    async lookupInput(hash, version) {
      return inputs.get(`${hash}.${version}`) ?? null;
    },
    async rememberInput(hash, version, cacheKey) {
      if (!inputs.has(`${hash}.${version}`)) inputs.set(`${hash}.${version}`, cacheKey);
    },
    async getEntry(cacheKey) {
      const entry = entries.get(cacheKey);
      return entry ? clone(entry) : null;
    },
    async putEntry(entry) {
      if (!entries.has(entry.cacheKey)) entries.set(entry.cacheKey, clone(entry));
      return clone(entries.get(entry.cacheKey)!);
    },
    async getExplanation(cacheKey, methodId) {
      const explanation = explanations.get(`${cacheKey} ${methodId}`);
      return explanation ? clone(explanation) : null;
    },
    async putExplanation(cacheKey, methodId, explanation) {
      const key = `${cacheKey} ${methodId}`;
      if (!explanations.has(key)) explanations.set(key, clone(explanation));
      return clone(explanations.get(key)!);
    },
    size() {
      return { entries: entries.size, explanations: explanations.size, inputs: inputs.size };
    },
  };
}

/** The subset of a Supabase client this cache uses; see the solve_cache migration. */
type SupabaseLike = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        eq(column: string, value: string): { maybeSingle(): PromiseLike<{ data: unknown; error: unknown }> };
        maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
    upsert(
      row: Record<string, unknown>,
      options: { onConflict: string; ignoreDuplicates: boolean },
    ): PromiseLike<{ error: unknown }>;
  };
};

/**
 * Backed by the existing Supabase project (tables solve_cache,
 * solve_cache_inputs, solve_cache_explanations; service role only).
 */
export function createSupabaseSolveCache(client: { from(table: string): unknown }): SolveCache {
  // Narrowed here: comparing the full generated client type is needlessly deep.
  const db = client as unknown as SupabaseLike;
  async function one(table: string, filters: [string, string][], columns: string) {
    const [first, second] = filters;
    const query = db.from(table).select(columns).eq(first[0], first[1]);
    const { data, error } = await (second ? query.eq(second[0], second[1]) : query).maybeSingle();
    if (error) throw new Error(`solve cache read failed (${table})`);
    return data as Record<string, unknown> | null;
  }
  async function insert(table: string, row: Record<string, unknown>, conflict: string) {
    const { error } = await db.from(table).upsert(row, { onConflict: conflict, ignoreDuplicates: true });
    if (error) throw new Error(`solve cache write failed (${table})`);
  }
  return {
    async lookupInput(hash, version) {
      const row = await one("solve_cache_inputs", [["input_hash", hash], ["prompt_config_version", version]], "cache_key");
      return typeof row?.cache_key === "string" ? row.cache_key : null;
    },
    async rememberInput(hash, version, cacheKey) {
      await insert("solve_cache_inputs", { input_hash: hash, prompt_config_version: version, cache_key: cacheKey }, "input_hash,prompt_config_version");
    },
    async getEntry(cacheKey) {
      const row = await one("solve_cache", [["cache_key", cacheKey]], "entry");
      return row ? parseEntry(row.entry) : null;
    },
    async putEntry(entry) {
      await insert(
        "solve_cache",
        { cache_key: entry.cacheKey, prompt_config_version: entry.promptConfigVersion, entry },
        "cache_key",
      );
      return (await this.getEntry(entry.cacheKey)) ?? entry;
    },
    async getExplanation(cacheKey, methodId) {
      const row = await one("solve_cache_explanations", [["cache_key", cacheKey], ["method_id", methodId]], "explanation");
      return row ? parseExplanation(row.explanation) : null;
    },
    async putExplanation(cacheKey, methodId, explanation) {
      await insert("solve_cache_explanations", { cache_key: cacheKey, method_id: methodId, explanation }, "cache_key,method_id");
      return (await this.getExplanation(cacheKey, methodId)) ?? explanation;
    },
  };
}

/**
 * A cache outage (unreachable database, migration not yet applied) must never
 * fail a solve: reads miss and writes return what they were given, so the
 * solve still completes, just without determinism until the cache recovers.
 */
export function withCacheFallback(cache: SolveCache, onError: (operation: string, error: unknown) => void): SolveCache {
  const guard = async <T>(operation: string, run: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      onError(operation, error);
      return fallback;
    }
  };
  return {
    lookupInput: (hash, version) => guard("lookupInput", () => cache.lookupInput(hash, version), null),
    rememberInput: (hash, version, key) => guard("rememberInput", () => cache.rememberInput(hash, version, key), undefined),
    getEntry: (key) => guard("getEntry", () => cache.getEntry(key), null),
    putEntry: (entry) => guard("putEntry", () => cache.putEntry(entry), entry),
    getExplanation: (key, id) => guard("getExplanation", () => cache.getExplanation(key, id), null),
    putExplanation: (key, id, explanation) => guard("putExplanation", () => cache.putExplanation(key, id, explanation), explanation),
  };
}
