import Link from "next/link";
import { redirect } from "next/navigation";
import DesmoLogo from "@/components/desmo-logo";
import { getCurrentUser } from "@/lib/auth";
import { safeAuthRedirect } from "@/lib/auth-redirect";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { AuthForm } from "./auth-form";
import styles from "./page.module.css";

export const metadata = { title: "Sign in · Desmo" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = safeAuthRedirect(params.next);
  const mode = params.mode === "signup" || params.mode === "forgot" ? params.mode : "signin";
  const user = await getCurrentUser();
  if (user && params.notice !== "signout-error") redirect(next);
  const configured = Boolean(getSupabaseConfig());
  const notice = params.notice === "link-expired"
    ? "This link has expired or was already used. Sign in or request a new password reset."
    : params.notice === "signout-error" ? "Sign-out could not be completed. Please try again." : undefined;

  return (
    <main className={styles.page}>
      <DesmoLogo centered />
      <section className={styles.card}>
        {configured ? <AuthForm mode={mode} next={next} notice={notice} key={mode} /> : (
          <>
            <h1>Accounts are almost ready</h1>
            <p className={styles.subtitle}>Connect Supabase to enable sign-in and save your problems.</p>
            <p className={styles.setup}>Add the Supabase URL and publishable key to <code>.env.local</code>, then restart the app. The project README has the setup steps.</p>
            <Link href="/" className={styles.button}>Back to Desmo</Link>
          </>
        )}
      </section>
    </main>
  );
}
