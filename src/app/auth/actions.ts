"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { safeAuthRedirect } from "@/lib/auth-redirect";
import { googleAuthorizationUrl } from "@/lib/google-oauth";
import { getSiteOrigin, getSupabaseConfig } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export type AuthMode = "signin" | "signup" | "forgot" | "reset";
export type AuthState = { error?: string; message?: string };

const emailSchema = z.email().max(254);
const passwordSchema = z.string().min(8).max(128);

export async function authenticate(_previous: AuthState, form: FormData): Promise<AuthState> {
  if (!getSupabaseConfig()) return { error: "Sign-in is not configured yet." };
  const mode = form.get("mode");
  const next = safeAuthRedirect(form.get("next"));
  const email = emailSchema.safeParse(String(form.get("email") ?? "").trim());
  const password = form.get("password");

  if (!["signin", "signup", "forgot", "reset"].includes(String(mode))) {
    return { error: "Choose a sign-in option and try again." };
  }
  if (mode !== "reset" && !email.success) return { error: "Enter a valid email address." };
  if (mode === "signin" && (typeof password !== "string" || !password || password.length > 128)) {
    return { error: "Enter your password." };
  }
  if ((mode === "signup" || mode === "reset") && !passwordSchema.safeParse(password).success) {
    return { error: "Use a password between 8 and 128 characters." };
  }
  if (mode === "reset" && password !== form.get("confirmPassword")) {
    return { error: "Your passwords do not match." };
  }

  const origin = getSiteOrigin();
  if ((mode === "signup" || mode === "forgot") && !origin) {
    return { error: "Email sign-up is not configured yet. Set the app's site URL first." };
  }

  try {
    const client = await createClient();
    if (mode === "forgot" && email.success && origin) {
      const callback = new URL("/auth/callback", origin);
      callback.searchParams.set("recovery", "1");
      const { error } = await client.auth.resetPasswordForEmail(email.data, { redirectTo: callback.toString() });
      if (error?.status === 429) return { error: "Too many requests. Wait a minute and try again." };
      if (error) return { error: "We could not send a reset email. Please try again shortly." };
      return { message: "If an account exists for that email, a password reset link is on its way." };
    }
    if (mode === "signup" && email.success && origin) {
      const callback = new URL("/auth/callback", origin);
      callback.searchParams.set("next", next);
      const { data, error } = await client.auth.signUp({
        email: email.data,
        password: password as string,
        options: { emailRedirectTo: callback.toString() },
      });
      if (error?.status === 429) return { error: "Too many requests. Wait a minute and try again." };
      if (error) return { error: "We could not create your account. Try a stronger password or sign in if you already have an account." };
      if (!data.session) return { message: "Check your email to confirm your account. If you already have an account, sign in instead." };
    } else if (mode === "signin" && email.success) {
      const { error } = await client.auth.signInWithPassword({ email: email.data, password: password as string });
      if (error?.status === 429) return { error: "Too many sign-in attempts. Wait a minute and try again." };
      if (error) return { error: "Check your email and password, and confirm your email if you just signed up." };
    } else if (mode === "reset") {
      const { data: user, error: userError } = await client.auth.getUser();
      if (userError || !user.user) return { error: "Your reset link has expired. Request a new one." };
      const { error } = await client.auth.updateUser({ password: password as string });
      if (error) return { error: "We could not update your password. Use a different password or request a new reset link." };
    }
  } catch {
    return { error: "Sign-in is temporarily unavailable. Please try again." };
  }

  revalidatePath("/", "layout");
  redirect(next);
}

export async function signInWithGoogle(_previous: AuthState, form: FormData): Promise<AuthState> {
  const config = getSupabaseConfig();
  const origin = getSiteOrigin();
  if (!config || !origin) return { error: "Google sign-in is not configured yet." };

  let url: string | null;
  try {
    const client = await createClient();
    url = await googleAuthorizationUrl(client.auth, origin, config.url, form.get("next"));
  } catch {
    return { error: "Google sign-in is temporarily unavailable. Please try again." };
  }
  if (!url) return { error: "Google sign-in could not start. Please try again." };
  redirect(url);
}

export async function signOut() {
  if (getSupabaseConfig()) {
    const client = await createClient();
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) redirect("/login?notice=signout-error");
  }
  revalidatePath("/", "layout");
  redirect("/login");
}
