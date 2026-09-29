"use client";

import Link from "next/link";
import { useActionState } from "react";
import { authenticate, signInWithGoogle, type AuthMode, type AuthState } from "@/app/auth/actions";
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
  const [googleState, googleAction, googlePending] = useActionState<AuthState, FormData>(signInWithGoogle, {});
  const modeLink = (target: string) => `/login?mode=${target}&next=${encodeURIComponent(next)}`;
  const showGoogle = mode === "signin" || mode === "signup";

  return (
    <>
      <h1>{titles[mode]}</h1>
      <p className={styles.subtitle}>
        {mode === "forgot" ? "We’ll email you a link to choose a new password." : mode === "reset" ? "Use at least 8 characters." : "Your problems and explanations, saved in one place."}
      </p>
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {showGoogle && (
        <>
          <form action={googleAction} className={styles.oauthForm}>
            <input type="hidden" name="next" value={next} />
            <button type="submit" className={styles.googleButton} disabled={googlePending || pending}>
              <svg className={styles.googleIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path fill="#4285F4" d="M21.35 12.24c0-.7-.06-1.4-.18-2.08H12v3.94h5.24a4.49 4.49 0 0 1-1.94 2.94v2.44h3.14c1.84-1.7 2.91-4.2 2.91-7.24Z" />
                <path fill="#34A853" d="M12 21.5c2.62 0 4.82-.87 6.43-2.36l-3.14-2.44c-.87.59-1.99.94-3.29.94-2.53 0-4.68-1.71-5.45-4.01H3.31v2.51A9.72 9.72 0 0 0 12 21.5Z" />
                <path fill="#FBBC05" d="M6.55 13.63a5.86 5.86 0 0 1 0-3.76V7.36H3.31a9.5 9.5 0 0 0 0 8.78l3.24-2.51Z" />
                <path fill="#EA4335" d="M12 5.86c1.39 0 2.64.48 3.62 1.43l2.72-2.72A9.25 9.25 0 0 0 12 2.5a9.72 9.72 0 0 0-8.69 4.86l3.24 2.51c.77-2.3 2.92-4.01 5.45-4.01Z" />
              </svg>
              {googlePending ? "Connecting to Google…" : "Continue with Google"}
            </button>
            {googleState.error && <p role="alert" className={styles.error}>{googleState.error}</p>}
          </form>
          <p className={styles.divider}><span>or continue with email</span></p>
        </>
      )}
      <form action={action} className={styles.form}>
        <input type="hidden" name="mode" value={mode} />
        <input type="hidden" name="next" value={next} />
        {mode !== "reset" && (
          <label className={styles.field}>
            Email
            <input name="email" type="email" autoComplete="email" required maxLength={254} disabled={pending || googlePending} />
          </label>
        )}
        {mode !== "forgot" && (
          <label className={styles.field}>
            {mode === "reset" ? "New password" : "Password"}
            <input name="password" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} required minLength={mode === "signin" ? 1 : 8} maxLength={128} disabled={pending || googlePending} />
          </label>
        )}
        {mode === "reset" && (
          <label className={styles.field}>
            Confirm password
            <input name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={128} disabled={pending || googlePending} />
          </label>
        )}
        {mode === "signin" && <Link className={styles.forgot} href={modeLink("forgot")}>Forgot password?</Link>}
        {state.error && <p role="alert" className={styles.error}>{state.error}</p>}
        {state.message && <p role="status" className={styles.notice}>{state.message}</p>}
        <button type="submit" className={`${styles.button} ${showGoogle ? styles.emailButton : ""}`} disabled={pending || googlePending}>
          {pending ? "Please wait…" : labels[mode]}
        </button>
      </form>
      <p className={styles.switchMode}>
        {mode === "signin" ? <>New here? <Link href={modeLink("signup")}>Create an account</Link></> : <Link href={modeLink("signin")}>Back to sign in</Link>}
      </p>
    </>
  );
}
