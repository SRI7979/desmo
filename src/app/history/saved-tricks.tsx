"use client";

import Link from "next/link";
import { useState } from "react";
import MathText from "@/components/math-text";
import styles from "./page.module.css";

export type SavedTrickItem = {
  id: string;
  techniqueName: string;
  structure: string | null;
  question: string;
  problemId: string | null;
};

/** The student's bookmarked techniques, collapsed above their history. */
export default function SavedTricks({ initial }: { initial: SavedTrickItem[] }) {
  const [tricks, setTricks] = useState(initial);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(id: string) {
    setRemoving(id);
    setError(null);
    try {
      const response = await fetch("/api/tricks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!response.ok && response.status !== 404) throw new Error("request failed");
      setTricks((current) => current.filter((trick) => trick.id !== id));
    } catch {
      setError("That trick could not be removed. Please try again.");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <details className={styles.savedTricks} data-testid="saved-tricks">
      <summary>Saved tricks ({tricks.length})</summary>
      {tricks.length === 0 ? (
        <p className={styles.savedTricksEmpty}>Use “Save this trick” on a solution to keep its technique here.</p>
      ) : (
        <ul className={styles.list}>
          {tricks.map((trick) => (
            <li key={trick.id} className={styles.trick}>
              <div className={styles.trickText}>
                <span className={styles.badge}>{trick.techniqueName}</span>
                {trick.structure && <p><MathText>{trick.structure}</MathText></p>}
                <p className={styles.trickQuestion}><MathText>{trick.question}</MathText></p>
                {trick.problemId && <Link href={`/history/${trick.problemId}`} className={styles.openLabel}>Open problem <span aria-hidden="true">→</span></Link>}
              </div>
              <button type="button" className={styles.button} onClick={() => remove(trick.id)} disabled={removing === trick.id} aria-label={`Remove saved trick ${trick.techniqueName}`}>
                {removing === trick.id ? "Removing…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className={styles.savedTricksEmpty} role="alert">{error}</p>}
    </details>
  );
}
