import type { Method } from "./strategy-selection";

/**
 * What the client receives for each technique it may show. Every field the
 * server already computed on `Method` except the rejection bookkeeping
 * (`rejected` is always null here; `repairs` is per-selection-run logging) —
 * the client needs the full winner-quality record, not a hand-picked subset,
 * so a technique switch can render its rows, graph bounds, and slider
 * position immediately, without waiting on a network round trip.
 * `verified`: a browser's hidden Desmos instance already ran these rows
 * cleanly (cached with the entry), so this client need not re-check it
 * before choosing a default. The rendering gate still checks what it shows.
 */
export type MethodSummary = Omit<Method, "rejected" | "repairs"> & { verified: boolean };
