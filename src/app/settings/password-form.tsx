"use client";

import { useActionState } from "react";
import { updatePassword, type PasswordState } from "./actions";
import styles from "./page.module.css";

export default function PasswordForm() {
  const [state, action, pending] = useActionState<PasswordState, FormData>(updatePassword, {});
  return (
    <form action={action} className={styles.form}>
      <label>
        New password
        <input name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} disabled={pending} />
      </label>
      <label>
        Confirm password
        <input name="confirmation" type="password" autoComplete="new-password" required minLength={8} maxLength={128} disabled={pending} />
      </label>
      {state.error && <p className={styles.error} role="alert">{state.error}</p>}
      {state.message && <p className={styles.success} role="status">{state.message}</p>}
      <button type="submit" data-primary disabled={pending}>{pending ? "Updating…" : "Update password"}</button>
    </form>
  );
}
