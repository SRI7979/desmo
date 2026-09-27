import Link from "next/link";
import styles from "../page.module.css";

export default function ProblemNotFound() {
  return (
    <main className={styles.empty}>
      <h1>Problem not found</h1>
      <p>This problem isn’t in your history.</p>
      <Link href="/history" className={styles.button}>Back to history</Link>
    </main>
  );
}
