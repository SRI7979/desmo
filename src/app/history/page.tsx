import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listProblems } from "@/lib/problem-history";
import { METHOD_LABELS } from "@/lib/method-labels";
import MathText from "@/components/math-text";
import HistoryShell from "./history-shell";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "History | Desmo", robots: { index: false, follow: false } };

export default async function HistoryPage({ searchParams }: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const user = await requireUser("/history");
  const query = await searchParams;
  const requestedPage = typeof query.page === "string" && /^\d+$/.test(query.page) ? Number(query.page) : 1;
  const page = Number.isSafeInteger(requestedPage) ? Math.max(1, Math.min(10_000, requestedPage)) : 1;
  // Provider errors and credentials stay out of the rendered page.
  let result: Awaited<ReturnType<typeof listProblems>> | null;
  try {
    result = await listProblems(user.id, page);
  } catch {
    result = null;
  }

  return (
    <HistoryShell email={user.email} avatarUrl={user.avatarUrl} name={user.name}>
      <div className={styles.heading}>
        <div><h1>Your problems</h1><p>Saved questions, answers, and Desmos entries</p></div>
        <Link href="/solve" className={styles.button}>New question</Link>
      </div>
      {result === null ? (
        <div className={styles.empty} role="alert">
          <h2>History couldn’t load</h2>
          <p>Your saved problems have not been changed</p>
          <a href={`/history?page=${page}`} className={styles.button}>Retry</a>
        </div>
      ) : result.problems.length === 0 ? (
        <div className={styles.empty}>
          <h2>{page === 1 ? "No saved problems yet" : "No problems on this page"}</h2>
          <p>{page === 1 ? "Upload a question to save its explanation here" : "Go back to your most recent problems"}</p>
          <Link href={page === 1 ? "/solve" : "/history"} className={styles.button}>
            {page === 1 ? "Open solver" : "Back to history"}
          </Link>
        </div>
      ) : (
        <>
          <ul className={styles.list}>
            {result.problems.map((problem) => (
              <li key={problem.id}>
                <Link href={`/history/${problem.id}`} className={styles.problem}>
                  <div className={styles.problemMeta}>
                    <span className={problem.status === "solved" ? styles.badge : styles.attention}>
                      {problem.status === "solved" ? problem.trick || METHOD_LABELS[problem.method] : "Needs attention"}
                    </span>
                    <time dateTime={problem.created_at}>
                      {new Date(problem.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}
                    </time>
                  </div>
                  <h2><MathText>{problem.question || "Upload needs attention"}</MathText></h2>
                  <div className={styles.problemFooter}>
                    <span><MathText>{problem.status === "solved" ? `Answer: ${problem.answer}` : "Review upload feedback"}</MathText></span>
                    <span className={styles.openLabel}>Open <span aria-hidden="true">→</span></span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <nav className={styles.pagination} aria-label="History pages">
            {page > 1 && <Link href={`/history?page=${page - 1}`} className={styles.button}>Previous</Link>}
            <span>Page {page}</span>
            {result.hasMore && <Link href={`/history?page=${page + 1}`} className={styles.button}>Next</Link>}
          </nav>
        </>
      )}
    </HistoryShell>
  );
}
