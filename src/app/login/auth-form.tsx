"use client";

import Link from "next/link";
import { useActionState } from "react";
import { authenticate, type AuthMode, type AuthState } from "@/app/auth/actions";
import styles from "./page.module.css";

const titles: Record<AuthMode, string> = {
  signin: "Welcome back",
  signup: "Create your account",
  forgot: "Reset your password",
  reset: "Choose a new password",
};

const labels: Record<AuthMode, string> = {
  signin: "Sign in",
  signup: "Create account",
  forgot: "Send reset link",
  reset: "Save password",
};

export function AuthForm({ mode, next, notice }: { mode: AuthMode; next: string; notice?: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(authenticate, {});
  const modeLink = (target: string) => `/login?mode=${target}&next=${encodeURIComponent(next)}`;

  return (
    <>
      <h1>{titles[mode]}</h1>
      <p className={styles.subtitle}>
        {mode === "forgot" ? "We’ll email you a link to choose a new password." : mode === "reset" ? "Use at least 8 characters." : "Your problems and explanations, saved in one place."}
      </p>
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      <form action={action} className={styles.form}>
        <input type="hidden" name="mode" value={mode} />
        <input type="hidden" name="next" value={next} />
        {mode !== "reset" && (
          <label className={styles.field}>
            Email
            <input name="email" type="email" autoComplete="email" required maxLength={254} disabled={pending} />
          </label>
        )}
        {mode !== "forgot" && (
          <label className={styles.field}>
            {mode === "reset" ? "New password" : "Password"}
            <input name="password" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} required minLength={mode === "signin" ? 1 : 8} maxLength={128} disabled={pending} />
          </label>
        )}
        {mode === "reset" && (
          <label className={styles.field}>
            Confirm password
            <input name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={128} disabled={pending} />
          </label>
        )}
        {mode === "signin" && <Link className={styles.forgot} href={modeLink("forgot")}>Forgot password?</Link>}
        {state.error && <p role="alert" className={styles.error}>{state.error}</p>}
        {state.message && <p role="status" className={styles.notice}>{state.message}</p>}
        <button type="submit" className={styles.button} disabled={pending}>
          {pending ? "Please wait…" : labels[mode]}
        </button>
      </form>
      <p className={styles.switchMode}>
        {mode === "signin" ? <>New here? <Link href={modeLink("signup")}>Create an account</Link></> : <Link href={modeLink("signin")}>Back to sign in</Link>}
      </p>
    </>
  );
}
