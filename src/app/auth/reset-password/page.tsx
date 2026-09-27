import DesmoLogo from "@/components/desmo-logo";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AuthForm } from "@/app/login/auth-form";
import styles from "@/app/login/page.module.css";

export const metadata = { title: "Reset password · Desmo" };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  if (!(await getCurrentUser())) redirect("/login?mode=forgot&notice=link-expired");
  return (
    <main className={styles.page}>
      <DesmoLogo centered />
      <section className={styles.card}>
        <AuthForm mode="reset" next="/solve" />
      </section>
    </main>
  );
}
