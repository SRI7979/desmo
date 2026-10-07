import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalculatorVerificationProvider } from "@/components/calculator-verification";
import DesmosCalculator from "@/components/desmos-calculator";
import SolutionExplanation from "@/components/solution-explanation";
import MathText from "@/components/math-text";
import { METHOD_LABELS } from "@/lib/method-labels";
import { requireUser } from "@/lib/auth";
import { getProblem } from "@/lib/problem-history";
import HistoryShell from "../history-shell";
import styles from "../page.module.css";
import workspace from "@/app/solve/page.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Saved problem | Desmo", robots: { index: false, follow: false } };

export default async function SavedProblemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/history/${encodeURIComponent(id)}`);
  let problem: Awaited<ReturnType<typeof getProblem>>;
  try {
    problem = await getProblem(user.id, id);
  } catch {
    return (
      <HistoryShell email={user.email} avatarUrl={user.avatarUrl}>
        <div className={styles.empty} role="alert">
          <h1>This problem couldn’t load</h1>
          <p>Your saved work has not been changed.</p>
          <a href={`/history/${encodeURIComponent(id)}`} className={styles.button}>Retry</a>
          <Link href="/history" className={styles.backLink}>Back to history</Link>
        </div>
      </HistoryShell>
    );
  }
  if (!problem) notFound();
  const { solution } = problem;
  return (
    <HistoryShell email={user.email} avatarUrl={user.avatarUrl}>
      <div className={styles.heading}>
        <div>
          <Link href="/history" className={styles.backLink}>← History</Link>
          <h1>Saved problem</h1>
          <p><time dateTime={problem.created_at}>{new Date(problem.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}</time></p>
        </div>
        <Link href="/solve" className={styles.button}>New question</Link>
      </div>
      <CalculatorVerificationProvider>
      <div className={workspace.workspace}>
        <section className={`${workspace.card} ${workspace.uploadCard}`} aria-labelledby="question-title">
          <div className={workspace.cardHeading}><h2 id="question-title">Question</h2></div>
          {problem.imageUrl ? (
            <Image src={problem.imageUrl} alt="Your saved question" width={1200} height={900} unoptimized loading="eager" className={styles.savedImage} />
          ) : (
            <p className={styles.imageWarning}>The image is unavailable. Your explanation is still saved. <a href={`/history/${problem.id}`}>Reload image</a>.</p>
          )}
          {!problem.imageUrl && solution.question && <p className={styles.questionText}><MathText>{solution.question}</MathText></p>}
        </section>
        <section className={`${workspace.card} ${workspace.calculatorCard}`} aria-labelledby="calculator-title">
          {/* The calculator's own Desmos bar is the visible header. */}
          <h2 id="calculator-title" className={workspace.srOnly}>Calculator</h2>
          <DesmosCalculator expressions={solution.status === "solved" ? solution.expressions : []} bounds={solution.status === "solved" ? solution.graphBounds : null} answerState={solution.status === "solved" ? solution.answerState : null} revision={0} />
        </section>
        <section className={`${workspace.card} ${workspace.resultCard}`} aria-labelledby="result-title">
          <div className={workspace.resultHeading}>
            <h2 id="result-title">Explanation</h2>
            {solution.status === "solved" && <span className={workspace.methodBadge}>{solution.trick || (solution.expressions.length > 0 ? "Desmos" : METHOD_LABELS[solution.method])}</span>}
          </div>
          <div className={workspace.resultBody}><SolutionExplanation solution={solution} tutorSource={solution.status === "solved" ? { kind: "history", problemId: problem.id } : undefined} /></div>
        </section>
      </div>
      </CalculatorVerificationProvider>
    </HistoryShell>
  );
}
