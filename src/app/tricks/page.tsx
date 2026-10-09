import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listTricks } from "@/lib/saved-tricks";
import HistoryShell from "@/app/history/history-shell";
import SavedTricks, { type SavedTrickItem } from "./saved-tricks";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Saved tricks | Desmo", robots: { index: false, follow: false } };

export default async function TricksPage() {
  const user = await requireUser("/tricks");
  let tricks: SavedTrickItem[] | null;
  try {
    tricks = (await listTricks(user.id)).map(({ id, techniqueName, structure, question, answer, selection, problemId }) => ({
      id, techniqueName, structure, question, answer, selection, problemId,
    }));
  } catch {
    tricks = null;
  }

  return (
    <HistoryShell email={user.email} avatarUrl={user.avatarUrl} name={user.name} active="tricks">
      <div className={styles.page}>
        <div className={styles.heading}>
          <div>
            <h1>Saved tricks</h1>
            <p>Techniques to use again on test day</p>
          </div>
          <Link href="/solve" className={styles.button}>Open solver</Link>
        </div>
        {tricks === null ? (
          <div className={styles.empty} role="alert">
            <h2>Saved tricks couldn’t load</h2>
            <p>Try again in a moment</p>
            <a href="/tricks" className={styles.button}>Retry</a>
          </div>
        ) : <SavedTricks initial={tricks} />}
      </div>
    </HistoryShell>
  );
}
