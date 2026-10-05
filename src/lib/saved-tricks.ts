import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { SavedTrick, SavedTrickInput } from "@/lib/tutor";

/**
 * Saved tricks ("Save this trick"). Every query uses the signed-in student's
 * own session, so row-level security enforces ownership (see the
 * tutor_and_saved_tricks migration); an explicit user filter is added too,
 * like the history queries. Never an admin client.
 */

const COLUMNS = "id,created_at,technique_id,technique_name,structure,topic,question,answer,expressions,selection,problem_id,cache_key";
export const SAVED_TRICKS_LIMIT = 100;

type Row = {
  id: string;
  created_at: string;
  technique_id: string | null;
  technique_name: string;
  structure: string | null;
  topic: string | null;
  question: string;
  answer: string;
  expressions: unknown;
  selection: string | null;
  problem_id: string | null;
  cache_key: string | null;
};

function fromRow(row: Row): SavedTrick {
  return {
    id: row.id,
    createdAt: row.created_at,
    techniqueId: row.technique_id,
    techniqueName: row.technique_name,
    structure: row.structure,
    topic: row.topic,
    question: row.question,
    answer: row.answer,
    expressions: Array.isArray(row.expressions) ? (row.expressions as SavedTrick["expressions"]) : [],
    selection: row.selection,
    problemId: row.problem_id,
    cacheKey: row.cache_key,
  };
}

/** Saves a trick once: saving the same technique of the same solve (or saved problem) again returns the existing row. */
export async function saveTrick(userId: string, trick: SavedTrickInput): Promise<SavedTrick> {
  const db = await createClient();
  const { data, error } = await db
    .from("saved_tricks")
    .insert({
      user_id: userId,
      technique_id: trick.techniqueId,
      technique_name: trick.techniqueName,
      structure: trick.structure,
      topic: trick.topic,
      question: trick.question,
      answer: trick.answer,
      expressions: trick.expressions,
      selection: trick.selection,
      problem_id: trick.problemId,
      cache_key: trick.cacheKey,
    })
    .select(COLUMNS)
    .single();
  if (!error && data) return fromRow(data as Row);
  // 23505: already saved (a unique constraint); return the row that exists.
  if ((error as { code?: string } | null)?.code !== "23505") throw new Error("Could not save this trick.", { cause: error });
  let existing = db.from("saved_tricks").select(COLUMNS).eq("user_id", userId);
  existing = trick.cacheKey ? existing.eq("cache_key", trick.cacheKey) : existing.eq("problem_id", trick.problemId ?? "").is("cache_key", null);
  existing = trick.techniqueId ? existing.eq("technique_id", trick.techniqueId) : existing.is("technique_id", null);
  const { data: found, error: readError } = await existing.limit(1).maybeSingle();
  if (readError || !found) throw new Error("Could not save this trick.", { cause: readError });
  return fromRow(found as Row);
}

export async function listTricks(userId: string): Promise<SavedTrick[]> {
  const db = await createClient();
  const { data, error } = await db
    .from("saved_tricks")
    .select(COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(SAVED_TRICKS_LIMIT);
  if (error) throw new Error("Could not load your saved tricks.", { cause: error });
  return ((data ?? []) as Row[]).map(fromRow);
}

/** True when a row was removed; false when there was no such trick of this student's. */
export async function removeTrick(userId: string, id: string): Promise<boolean> {
  const db = await createClient();
  const { data, error } = await db.from("saved_tricks").delete().eq("user_id", userId).eq("id", id).select("id");
  if (error) throw new Error("Could not remove this saved trick.", { cause: error });
  return (data?.length ?? 0) > 0;
}
