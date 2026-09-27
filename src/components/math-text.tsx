import { splitMathText } from "@/lib/math-text";
import MathExpression from "./math-expression";
import styles from "./math-text.module.css";

export default function MathText({ children }: { children: string }) {
  const parts = splitMathText(children);
  return <>{parts.map((part, index) => {
    if (part.type === "text") {
      return parts[index - 1]?.type === "math" ? part.value.replace(/^[,.;:!?]+/, "") : part.value;
    }
    // Keep sentence punctuation with the formula, including when it wraps.
    const next = parts[index + 1];
    const punctuation = next?.type === "text" ? next.value.match(/^[,.;:!?]+/)?.[0] : undefined;
    const latex = part.value + (punctuation ? `\\text{${punctuation}}` : "");
    return <span className={styles.math} key={index}><MathExpression latex={latex} /></span>;
  })}</>;
}
