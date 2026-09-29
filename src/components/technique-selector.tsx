"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { MethodSummary } from "@/lib/method-summary";
import { navigate, selectorMode, type NavState } from "@/lib/technique-selection-ui";
import styles from "./technique-selector.module.css";

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}
    >
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className={styles.check} width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8.5 6.2 12 13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const LEVEL_DOTS: Record<MethodSummary["mathLevel"], number> = { low: 1, medium: 2, high: 3 };

function MathLevelDots({ level }: { level: MethodSummary["mathLevel"] }) {
  const filled = LEVEL_DOTS[level];
  return (
    <span className={styles.levelDots}>
      <span className={styles.srOnly}>{`Math level: ${level}.`}</span>
      <span className={styles.levelDotsInner} aria-hidden="true">
        {[1, 2, 3].map((dot) => (
          <span key={dot} className={`${styles.levelDot} ${dot <= filled ? styles.levelDotFilled : ""}`} />
        ))}
      </span>
    </span>
  );
}

function BadgeRow({ badges }: { badges: readonly string[] }) {
  if (badges.length === 0) return null;
  return (
    <span className={styles.badgeRow}>
      {badges.map((badge) => (
        <span key={badge} className={styles.badge}>
          {badge}
        </span>
      ))}
    </span>
  );
}

/**
 * Sits above the explanation, replacing the old static trick-name badge.
 * Collapsed: current technique's name and badges. Open: its effort details,
 * plus every eligible technique when there is more than one (the server never
 * sends a rejected one). Selecting one calls onSelect immediately; the caller is
 * responsible for swapping the calculator from its already-cached rows and
 * loading the explanation — this component only picks.
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
  const mode = selectorMode(methods);
  const selectedIndex = Math.max(
    0,
    methods.findIndex((method) => method.id === selectedId),
  );
  const current = methods[selectedIndex] ?? methods[0];
  const [nav, setNav] = useState<NavState>({ open: false, activeIndex: selectedIndex });
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const detailsId = `${listId}-details`;
  const optionId = (index: number) => `${listId}-option-${index}`;

  useEffect(() => {
    if (!nav.open) return;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setNav((value) => ({ ...value, open: false }));
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [nav.open]);

  if (!current) return null;

  function choose(index: number) {
    setNav({ open: false, activeIndex: index });
    onSelect(methods[index].id);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (mode === "single") {
      if (event.key === "Escape" && nav.open) {
        event.preventDefault();
        setNav((value) => ({ ...value, open: false }));
      } else if (event.key === "Tab" && nav.open) {
        setNav((value) => ({ ...value, open: false }));
      }
      return;
    }
    if (event.key === "Tab") {
      if (nav.open) setNav((value) => ({ ...value, open: false }));
      return;
    }
    const result = navigate(nav, event.key, methods.length, selectedIndex);
    if (result === nav) return;
    event.preventDefault();
    setNav({ open: result.open, activeIndex: result.activeIndex });
    if (result.action === "select") onSelect(methods[result.activeIndex].id);
  }

  return (
    <div className={styles.container} ref={containerRef} data-testid="technique-selector">
      <button
        type="button"
        role={mode === "multi" ? "combobox" : undefined}
        aria-haspopup={mode === "multi" ? "listbox" : undefined}
        aria-expanded={nav.open}
        aria-controls={mode === "multi" ? listId : detailsId}
        aria-activedescendant={mode === "multi" && nav.open ? optionId(nav.activeIndex) : undefined}
        className={styles.trigger}
        onClick={() => setNav((value) => ({ open: !value.open, activeIndex: value.open ? value.activeIndex : selectedIndex }))}
        onKeyDown={handleKeyDown}
      >
        <span className={styles.srOnly}>Solving technique:</span>
        <span className={styles.name}>{current.name}</span>
        <BadgeRow badges={current.badges} />
        <ChevronIcon open={nav.open} />
      </button>
      {nav.open && (
        <div
          className={styles.popover}
          id={mode === "single" ? detailsId : undefined}
          role={mode === "single" ? "region" : undefined}
          aria-label={mode === "single" ? `${current.name} method details` : undefined}
        >
          <div className={styles.details}>
            <p className={styles.detailsHeading}>Method details</p>
            <dl className={styles.stats}>
              <div className={styles.stat}>
                <dt>Desmos rows</dt>
                <dd>{current.cost.rows}</dd>
              </div>
              <div className={styles.stat}>
                <dt>Hand steps</dt>
                <dd>{current.cost.derivationSteps}</dd>
              </div>
              <div className={styles.stat}>
                <dt>Math needed</dt>
                <dd>{current.mathLevel}</dd>
              </div>
            </dl>
            <p className={styles.detailsShape}>{current.shape}</p>
          </div>
          {mode === "single" ? (
            <p className={styles.singleNote}>This is the only method available for this solution.</p>
          ) : (
            <ul className={styles.listbox} role="listbox" id={listId} aria-label="Solving technique" tabIndex={-1}>
              {methods.map((method, index) => {
                const selected = method.id === selectedId;
                return (
                  <li
                    key={method.id}
                    id={optionId(index)}
                    role="option"
                    aria-selected={selected}
                    className={`${styles.option} ${index === nav.activeIndex ? styles.optionActive : ""} ${selected ? styles.optionSelected : ""}`}
                    onMouseEnter={() => setNav((value) => ({ ...value, activeIndex: index }))}
                    onClick={() => choose(index)}
                  >
                    <div className={styles.optionTop}>
                      <span className={styles.optionNameRow}>
                        {selected && <CheckIcon />}
                        <span className={styles.optionName}>{method.name}</span>
                      </span>
                      <MathLevelDots level={method.mathLevel} />
                    </div>
                    <div className={styles.optionBottom}>
                      <span className={styles.shape}>{method.shape}</span>
                      <BadgeRow badges={method.badges} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
