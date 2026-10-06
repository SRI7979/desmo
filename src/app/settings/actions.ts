"use server";

import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type PasswordState = { error?: string; message?: string };

export async function updatePassword(_previous: PasswordState, form: FormData): Promise<PasswordState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in to change your password" };
  const password = form.get("password");
  const confirmation = form.get("confirmation");
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    return { error: "Use a password between 8 and 128 characters" };
  }
  if (password !== confirmation) return { error: "Your passwords do not match" };

  try {
    const client = await createClient();
    const { error } = await client.auth.updateUser({ password });
    if (error) return { error: "Your password could not be updated, please try again" };
    return { message: "Password updated" };
  } catch {
    return { error: "Your password could not be updated, please try again" };
  }
}
