import "server-only";

import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { solutionSchema, type Solution } from "@/lib/solver-schema";
import { normalizeDesmosExpressions } from "@/lib/desmos-latex";

const BUCKET = "problem-images";
export const HISTORY_PAGE_SIZE = 20;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ProblemSummary = {
  id: string;
  question: string;
  answer: string;
  method: Solution["method"];
  status: Solution["status"];
  trick: string | null;
  created_at: string;
};

export async function saveProblem(input: {
  userId: string;
  bytes: Buffer;
  mime: string;
  solution: Solution;
}): Promise<string> {
  const parsed = solutionSchema.parse(input.solution);
  const solution = {
    ...parsed,
    expressions: normalizeDesmosExpressions(parsed.expressions),
  };
  const id = randomUUID();
  const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[input.mime];
  if (!extension || !uuidPattern.test(input.userId)) throw new Error("Invalid problem upload");
  const imagePath = `${input.userId}/${id}.${extension}`;
  const db = createAdminClient();
  const { error: uploadError } = await db.storage.from(BUCKET).upload(imagePath, input.bytes, {
    contentType: input.mime, upsert: false, cacheControl: "0",
  });
  if (uploadError) throw new Error("Could not save screenshot");
  try {
    const { error } = await db.from("problems").insert({
      id, user_id: input.userId, image_path: imagePath,
      question: solution.question, answer: solution.answer, method: solution.method,
      status: solution.status, solution,
    });
    if (error) throw new Error("Could not save solution");
  } catch (error) {
    // Best-effort cleanup if the record could not be committed.
    await db.storage.from(BUCKET).remove([imagePath]).catch(() => undefined);
    throw error;
  }
  return id;
}

export async function listProblems(userId: string, page = 1) {
  const safePage = Number.isSafeInteger(page) && page > 0 ? Math.min(page, 10000) : 1;
  const start = (safePage - 1) * HISTORY_PAGE_SIZE;
  const db = await createClient();
  const { data, error } = await db.from("problems")
    .select("id,question,answer,method,status,created_at,trick:solution->>trick")
    .eq("user_id", userId)
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .range(start, start + HISTORY_PAGE_SIZE);
  if (error) throw new Error("Could not load your history. Please try again.");
  return {
    problems: (data ?? []).slice(0, HISTORY_PAGE_SIZE) as ProblemSummary[],
    hasMore: (data?.length ?? 0) > HISTORY_PAGE_SIZE,
  };
}

export async function getProblem(userId: string, id: string) {
  if (!uuidPattern.test(id)) return null;
  const db = await createClient();
  // Use the user's session (RLS), plus an explicit owner filter. Never an admin read.
  const { data, error } = await db.from("problems")
    .select("id,solution,image_path,created_at")
    .eq("user_id", userId).eq("id", id).maybeSingle();
  if (error) throw new Error("Could not load this problem. Please try again.");
  if (!data) return null;
  const parsed = solutionSchema.parse(data.solution);
  // Older saved responses may contain Unicode math operators that render in
  // the explanation but fail in the Desmos API. Repair them on read too.
  const solution = {
    ...parsed,
    expressions: normalizeDesmosExpressions(parsed.expressions),
  };
  const { data: image } = await db.storage.from(BUCKET).createSignedUrl(data.image_path, 300);
  return { id: data.id as string, solution, imageUrl: image?.signedUrl ?? null, created_at: data.created_at as string };
}
