import { requireUser } from "@/lib/auth";
import HistoryShell from "@/app/history/history-shell";
import PasswordForm from "./password-form";
import { ThemeToggle } from "@/components/theme-toggle";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings | Desmo", robots: { index: false, follow: false } };

export default async function SettingsPage() {
  const user = await requireUser("/settings");
  return (
    <HistoryShell email={user.email} avatarUrl={user.avatarUrl} name={user.name} active="settings">
      <div className={styles.page}>
        <h1>Settings</h1>
        <section className={styles.card} aria-labelledby="account-heading">
          <h2 id="account-heading">Account</h2>
          <div className={styles.accountRow}>
            <span>Email</span>
            <strong>{user.email || "No email available"}</strong>
          </div>
        </section>
        <section className={styles.card} aria-labelledby="appearance-heading">
          <h2 id="appearance-heading">Appearance</h2>
          <p>Choose your theme</p>
          <ThemeToggle showLabels />
        </section>
        <section className={styles.card} aria-labelledby="password-heading">
          <h2 id="password-heading">Password</h2>
          <p>Choose a new password for your account</p>
          <PasswordForm />
        </section>
      </div>
    </HistoryShell>
  );
}
