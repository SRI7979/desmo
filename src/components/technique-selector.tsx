"use client";

import { useId } from "react";
import { methodApproach } from "@/lib/method-scoring";
import type { MethodSummary } from "@/lib/method-summary";
import styles from "./technique-selector.module.css";

function ApproachLabel({ method }: { method: MethodSummary }) {
  const approach = method.approach ?? methodApproach(method);
  return <span className={styles.approach} data-approach={approach}>{approach === "math" ? "Math way" : "Desmos way"}</span>;
}

/**
 * A compact route picker inspired by the source UI's segmented method control.
 * It keeps every method that passed browser preflight available, even when the
 * solver found only one; the selected route's cost and shape remain visible.
 */
export default function TechniqueSelector({
  methods,
  selectedId,
  onSelect,
}: {
  methods: MethodSummary[];
  selectedId: string;
  onSelect: (methodId: string) => void;
}) {
  const headingId = useId();
  const selected = methods.find((method) => method.id === selectedId) ?? methods[0];
  if (!selected) return null;

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % methods.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + methods.length) % methods.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = methods.length - 1;
    else return;
    event.preventDefault();
    const button = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role='tab']")[next];
    button?.focus();
    onSelect(methods[next].id);
  }

  return (
    <section className={styles.container} aria-labelledby={headingId} data-testid="technique-selector">
      <div className={styles.routeHeading}>
        <h3 id={headingId}>Choose your route</h3>
        <span>{selected.cost.rows} {selected.cost.rows === 1 ? "row" : "rows"} · {selected.cost.derivationSteps} hand {selected.cost.derivationSteps === 1 ? "step" : "steps"}</span>
      </div>
      <div className={styles.routeList} role="tablist" aria-label="Solving method">
        {methods.map((method, index) => {
          const active = method.id === selected.id;
          const recommended = method.badges.includes("Recommended");
          return (
            <button
              key={method.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`${headingId}-details`}
              aria-label={`${method.name}${recommended ? ", Recommended" : ""}; ${method.shape}`}
              title={method.shape}
              tabIndex={active ? 0 : -1}
              className={styles.routeButton}
              data-selected={active || undefined}
              onClick={() => onSelect(method.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              <span className={styles.name}>{method.name}</span>
              {recommended && <span className={styles.recommended}>Recommended</span>}
              <ApproachLabel method={method} />
            </button>
          );
        })}
      </div>
      <div className={styles.routeDetails} role="tabpanel" id={`${headingId}-details`} aria-label={`${selected.name} method details`}>
        <p className={styles.shape}>{selected.shape}</p>
        <dl className={styles.stats}>
          <div><dt>Desmos rows</dt><dd>{selected.cost.rows}</dd></div>
          <div><dt>Hand steps</dt><dd>{selected.cost.derivationSteps}</dd></div>
          <div><dt>Math needed</dt><dd>{selected.mathLevel}</dd></div>
        </dl>
      </div>
    </section>
  );
}
