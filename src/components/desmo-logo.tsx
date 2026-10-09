import Link from "next/link";
import styles from "./desmo-logo.module.css";

export default function DesmoLogo({ centered = false, variant = "default" }: { centered?: boolean; variant?: "default" | "workspace" }) {
  return (
    <Link
      href="/"
      className={`${styles.logo}${centered ? ` ${styles.centered}` : ""}${variant === "workspace" ? ` ${styles.workspaceLogo}` : ""}`}
      aria-label="Desmo home"
    >
      <span className={styles.mark} aria-hidden="true">
        <svg
          width={variant === "workspace" ? "16" : "27"}
          height={variant === "workspace" ? "16" : "27"}
          viewBox={variant === "workspace" ? "0 0 16 16" : "0 0 24 24"}
          fill="none"
          focusable="false"
        >
          <path
            d={variant === "workspace" ? "M2 11.5c2.2 0 2.6-7 6-7s3.8 7 6 7" : "M3 17c5 0 4-10 9-10s4 10 9 10M3 12h18"}
            stroke="currentColor"
            strokeWidth={variant === "workspace" ? "1.8" : "2.4"}
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span className={styles.wordmark}>Desmo</span>
    </Link>
  );
}
