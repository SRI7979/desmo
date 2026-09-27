import Link from "next/link";
import { signOut } from "@/app/auth/actions";
import styles from "./account-nav.module.css";

export default function AccountNav({
  email,
  active,
}: {
  email?: string;
  active: "solve" | "history";
}) {
  return (
    <nav className={styles.nav} aria-label="Account">
      <Link href="/solve" aria-current={active === "solve" ? "page" : undefined}>
        Solver
      </Link>
      <Link href="/history" aria-current={active === "history" ? "page" : undefined}>
        History
      </Link>
      {email && <span className={styles.email} title={email}>{email}</span>}
      <form action={signOut}>
        <button type="submit">Sign out</button>
      </form>
    </nav>
  );
}
