"use client";

import { useId } from "react";
import { useTheme, type ThemePreference } from "./theme-provider";
import styles from "./theme-toggle.module.css";

const OPTIONS: Array<{ value: ThemePreference; label: string; path: string }> = [
  { value: "light", label: "Light", path: "M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" },
  { value: "dark", label: "Dark", path: "M20.2 15.2A8.6 8.6 0 0 1 8.8 3.8 8.7 8.7 0 1 0 20.2 15.2Z" },
  { value: "system", label: "System", path: "M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm8 12v3m-4 0h8" },
];

export function ThemeToggle({ className = "", showLabels = false, compact = false }: { className?: string; showLabels?: boolean; compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  const name = useId();

  return (
      <fieldset className={`${styles.group} ${showLabels ? styles.labeled : ""} ${compact ? styles.compact : ""} ${className}`}>
      <legend className={styles.visuallyHidden}>Appearance</legend>
      {OPTIONS.map(({ value, label, path }) => (
        <label key={value} className={styles.option} title={`${label} theme`}>
          <input
            type="radio"
            name={name}
            value={value}
            checked={theme === value}
            onChange={() => setTheme(value)}
            aria-label={`${label} theme`}
          />
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>
          <span className={showLabels ? styles.optionLabel : styles.visuallyHidden}>{label}</span>
        </label>
      ))}
    </fieldset>
  );
}
