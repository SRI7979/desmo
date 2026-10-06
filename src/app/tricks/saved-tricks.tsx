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
  answer: string;
  selection: string | null;
  problemId: string | null;
};

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
      setError("That trick could not be removed, please try again");
    } finally {
      setRemoving(null);
    }
  }

  if (tricks.length === 0) {
    return (
      <div className={styles.empty} data-testid="saved-tricks">
        <h2>No saved tricks yet</h2>
        <p>Use Save this trick on a solution to keep its technique here</p>
        <Link href="/solve" className={styles.button}>Solve a question</Link>
      </div>
    );
  }

  return (
    <>
      <p className={styles.count} data-testid="saved-tricks">{tricks.length} {tricks.length === 1 ? "trick" : "tricks"} saved</p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <ul className={styles.list}>
        {tricks.map((trick) => (
          <li key={trick.id} className={styles.card}>
            <div className={styles.cardTop}>
              <h2>{trick.techniqueName}</h2>
              <button type="button" className={styles.remove} onClick={() => remove(trick.id)} disabled={removing === trick.id} aria-label={`Remove saved trick ${trick.techniqueName}`}>
                {removing === trick.id ? "Removing…" : "Remove"}
              </button>
            </div>
            {trick.structure && <p className={styles.structure}><MathText>{trick.structure}</MathText></p>}
            {trick.selection && <blockquote className={styles.selection}><MathText>{trick.selection}</MathText></blockquote>}
            <div className={styles.example}>
              <span>Saved from</span>
              <p><MathText>{trick.question}</MathText></p>
            </div>
            <div className={styles.cardBottom}>
              <span className={styles.answer}>Answer <strong><MathText>{trick.answer}</MathText></strong></span>
              {trick.problemId && <Link href={`/history/${trick.problemId}`}>Open problem <span aria-hidden="true">→</span></Link>}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
