"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import MathExpression from "@/components/math-expression";
import MathText from "@/components/math-text";
import type { TutorAnswer, TutorSource } from "@/lib/tutor";
import { cleanSelection, isExplainableSelection } from "@/lib/tutor-grounding";
import shared from "./solution-explanation.module.css";
import styles from "./tutor-panel.module.css";

export type { TutorSource };

/**
 * "Explain this" and "Save this trick": small additions to the solution card.
 * The browser sends only where to look (the solve or saved problem) and what
 * the student pointed at; the server resolves and verifies everything else.
 */

type TutorSelection = { kind: "row"; row: number } | { kind: "text"; text: string };
type Ask = { selection: TutorSelection; label: string };
type Practice =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; problem: string; answer: string; hint: string }
  | { status: "error"; message: string };
type TutorView =
  | { status: "idle" }
  | { status: "loading"; ask: Ask }
  | { status: "ready"; ask: Ask; answer: TutorAnswer; practice: Practice }
  | { status: "error"; ask: Ask; message: string };

const IDLE: TutorView = { status: "idle" };
const JSON_HEADERS = { "Content-Type": "application/json" };

function sourceKey(source: TutorSource | null): string {
  return source ? JSON.stringify(source) : "";
}

async function askTutor(source: TutorSource, selection: TutorSelection, practice: boolean, signal: AbortSignal): Promise<TutorAnswer> {
  const response = await fetch("/api/tutor", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ source, selection, practice }),
    signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || typeof data.meaning !== "string") {
    throw new Error(typeof data?.error === "string" ? data.error : "The tutor could not answer. Please try again.");
  }
  return data as TutorAnswer;
}

export type Tutor = {
  enabled: boolean;
  view: TutorView;
  /** Where the panel opens: under a calculator line, or at the top of the solution for highlighted text. */
  openAt: number | "top" | null;
  ask(selection: TutorSelection, label: string): void;
  requestPractice(): void;
  close(): void;
};

/** One tutor conversation per solution: a new technique or problem starts fresh. */
export function useTutor(source: TutorSource | null): Tutor {
  const key = sourceKey(source);
  const [state, setState] = useState<{ key: string; view: TutorView }>({ key, view: IDLE });
  const request = useRef<AbortController | null>(null);
  // The control that opened the panel gets focus back when it closes.
  const opener = useRef<HTMLElement | null>(null);
  // A switched technique or problem cancels a question about the old one.
  useEffect(() => () => request.current?.abort(), [key]);
  const view = state.key === key ? state.view : IDLE;

  function start(): AbortController {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    return controller;
  }

  function ask(selection: TutorSelection, label: string) {
    if (!source) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !active.closest("[data-tutor-panel]")) opener.current = active;
    const controller = start();
    const current: Ask = { selection, label };
    setState({ key, view: { status: "loading", ask: current } });
    askTutor(source, selection, false, controller.signal).then(
      (answer) => {
        if (request.current === controller) setState({ key, view: { status: "ready", ask: current, answer, practice: { status: "idle" } } });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ key, view: { status: "error", ask: current, message: error instanceof Error ? error.message : "The tutor could not answer." } });
      },
    );
  }

  function requestPractice() {
    if (!source || view.status !== "ready") return;
    const ready = view;
    const controller = start();
    setState({ key, view: { ...ready, practice: { status: "loading" } } });
    askTutor(source, ready.ask.selection, true, controller.signal).then(
      (answer) => {
        if (request.current !== controller) return;
        const practice: Practice = answer.practice
          ? { status: "ready", ...answer.practice }
          : { status: "error", message: "No practice problem came back. Try again." };
        setState({ key, view: { ...ready, practice } });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ key, view: { ...ready, practice: { status: "error", message: error instanceof Error ? error.message : "The practice problem did not load." } } });
      },
    );
  }

  function close() {
    request.current?.abort();
    setState({ key, view: IDLE });
    const target = opener.current;
    opener.current = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }

  const openAt = view.status === "idle" ? null : view.ask.selection.kind === "row" ? view.ask.selection.row : "top";
  return { enabled: source !== null, view, openAt, ask, requestPractice, close };
}

/** Never part of what a student is asking about. */
const NOT_CONTENT = "button, h3, h4, summary, [data-tutor-ignore], [data-tutor-panel]";

/**
 * The selected text, as the server can verify it: rendered math is replaced
 * by its own LaTeX (a partly selected formula counts as the whole formula),
 * and controls, headings, labels, and the tutor's own panel are left out, so
 * a selection that runs over "Line 2" or "The idea" still matches the text
 * under it. `display` is what the student actually sees.
 */
function selectionTexts(range: Range): { query: string; display: string } {
  const expanded = range.cloneRange();
  const formula = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest(".katex") ?? null;
  const first = formula(expanded.startContainer);
  const last = formula(expanded.endContainer);
  if (first) expanded.setStartBefore(first);
  if (last) expanded.setEndAfter(last);
  const query = expanded.cloneContents();
  const display = expanded.cloneContents();
  for (const fragment of [query, display]) fragment.querySelectorAll(NOT_CONTENT).forEach((node) => node.remove());
  query.querySelectorAll(".katex").forEach((node) => {
    const tex = node.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? "";
    node.replaceWith(document.createTextNode(` ${tex} `));
  });
  display.querySelectorAll(".katex-mathml").forEach((node) => node.remove());
  return { query: cleanSelection(query.textContent ?? ""), display: cleanSelection(display.textContent ?? "") };
}

type Offer = { text: string; display: string; top: number; left: number };

function readOffer(container: HTMLElement | null): Offer | null {
  const selection = window.getSelection();
  if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const ancestor = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
  // Wholly inside a heading, a label, a control, or the tutor's own answer: nothing to explain.
  if (ancestor?.closest(NOT_CONTENT)) return null;
  const { query, display } = selectionTexts(range);
  if (!isExplainableSelection(query)) return null;
  const rect = range.getBoundingClientRect();
  const box = container.getBoundingClientRect();
  return {
    text: query,
    display: display || query,
    top: rect.bottom - box.top + 6,
    left: Math.max(0, Math.min(rect.left - box.left, box.width - 132)),
  };
}

function shorten(text: string, length = 60): string {
  return text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text;
}

/** A small "Explain this" button under any text selected inside the solution card. */
export function SelectionExplain({ tutor, containerRef }: { tutor: Tutor; containerRef: RefObject<HTMLElement | null> }) {
  const [offer, setOffer] = useState<Offer | null>(null);
  const enabled = tutor.enabled;
  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    // selectionchange covers mouse, touch, and keyboard selection alike.
    const update = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setOffer(readOffer(containerRef.current)), 150);
    };
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOffer(null);
    };
    document.addEventListener("selectionchange", update);
    document.addEventListener("keydown", dismiss);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("selectionchange", update);
      document.removeEventListener("keydown", dismiss);
    };
  }, [enabled, containerRef]);
  if (!enabled || !offer) return null;
  return (
    <button
      type="button"
      className={`${shared.copyButton} ${styles.selectionButton}`}
      style={{ top: offer.top, left: offer.left }}
      // Keep the selection while the button is pressed.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        tutor.ask({ kind: "text", text: offer.text }, `“${shorten(offer.display)}”`);
        setOffer(null);
        window.getSelection()?.removeAllRanges();
      }}
      aria-label={`Explain the selected text: ${shorten(offer.display, 80)}`}
      data-testid="explain-selection"
    >
      <ExplainIcon />
      Explain this
    </button>
  );
}

export function ExplainIcon() {
  return (
    <svg viewBox="0 0 20 20" width="15" height="15" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8.2 8a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="13.8" r=".9" fill="currentColor" />
    </svg>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className={shared.skeletonLines} role="status">
      <span className={shared.srOnly}>{label}</span>
      <span className={shared.purposeShimmer} aria-hidden="true" />
      <span className={`${shared.purposeShimmer} ${shared.shimmerShort}`} aria-hidden="true" />
    </div>
  );
}

/** The tutor's answer, inline in the solution card. */
export function TutorPanel({ tutor }: { tutor: Tutor }) {
  const { view } = tutor;
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const ask = view.status === "idle" ? null : view.ask;
  // A new question moves focus (and the view) to the panel, for keyboard and screen-reader users.
  useEffect(() => {
    if (!ask) return;
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [ask]);
  if (view.status === "idle") return null;
  return (
    <section className={styles.panel} aria-labelledby={titleId} data-tutor-panel data-testid="tutor-panel">
      <div className={styles.heading}>
        <h3 id={titleId} ref={heading} tabIndex={-1}>{view.status === "ready" ? view.answer.title : "Tutor"}</h3>
        <button type="button" className={shared.copyButton} onClick={tutor.close} aria-label="Close the tutor">Close</button>
      </div>
      <p className={styles.about}>About {view.ask.label}</p>
      <div aria-live="polite">
        {view.status === "loading" ? (
          <Loading label="The tutor is writing an answer…" />
        ) : view.status === "error" ? (
          <div className={styles.actions}>
            <p className={styles.error} role="alert">{view.message}</p>
            <button type="button" className={shared.retryButton} onClick={() => tutor.ask(view.ask.selection, view.ask.label)}>Try again</button>
          </div>
        ) : (
          <>
            <p><MathText>{view.answer.meaning}</MathText></p>
            <h4>Why it’s used here</h4>
            <p><MathText>{view.answer.whyHere}</MathText></p>
            {view.answer.example && (
              <>
                <h4>Example</h4>
                <p><MathText>{view.answer.example.description}</MathText></p>
                {view.answer.example.rows.map((row, index) => (
                  <div key={index} className={`${shared.equation} ${styles.exampleRow}`}><MathExpression latex={row} /></div>
                ))}
              </>
            )}
            <PracticeSection practice={view.practice} onRequest={tutor.requestPractice} />
          </>
        )}
      </div>
    </section>
  );
}

function PracticeSection({ practice, onRequest }: { practice: Practice; onRequest: () => void }) {
  if (practice.status === "idle") {
    return (
      <div className={styles.actions}>
        <button type="button" className={shared.retryButton} onClick={onRequest}>Practice problem</button>
      </div>
    );
  }
  if (practice.status === "loading") return <><h4>Practice problem</h4><Loading label="Writing a practice problem…" /></>;
  if (practice.status === "error") {
    return (
      <div className={styles.actions}>
        <p className={styles.error} role="alert">{practice.message}</p>
        <button type="button" className={shared.retryButton} onClick={onRequest}>Try again</button>
      </div>
    );
  }
  return (
    <div data-testid="tutor-practice">
      <h4>Practice problem</h4>
      <p><MathText>{practice.problem}</MathText></p>
      <details className={shared.transcription}>
        <summary>Show hint</summary>
        <p><MathText>{practice.hint}</MathText></p>
      </details>
      <details className={shared.transcription}>
        <summary>Show answer</summary>
        <p><MathText>{practice.answer}</MathText></p>
      </details>
    </div>
  );
}

/** "Save this trick" ⇄ "Saved": bookmarks the technique of this solution (the server resolves what is saved). */
export function SaveTrickButton({ source }: { source: TutorSource }) {
  const key = sourceKey(source);
  type SaveState = { key: string; status: "idle" | "saving" | "saved" | "removing" | "error"; id: string | null; message?: string };
  const [state, setState] = useState<SaveState>({ key, status: "idle", id: null });
  const current: SaveState = state.key === key ? state : { key, status: "idle", id: null };
  const busy = current.status === "saving" || current.status === "removing";

  async function toggle() {
    if (busy) return;
    const remove = current.status === "saved" && current.id !== null;
    setState({ key, status: remove ? "removing" : "saving", id: current.id });
    try {
      const response = await fetch("/api/tricks", {
        method: remove ? "DELETE" : "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(remove ? { id: current.id } : { source }),
      });
      const data = await response.json().catch(() => null);
      // Removing a trick that is already gone is still removed.
      if (!response.ok && !(remove && response.status === 404)) {
        throw new Error(typeof data?.error === "string" ? data.error : remove ? "Could not remove this trick. Please try again." : "Could not save this trick. Please try again.");
      }
      if (!remove && typeof data?.trick?.id !== "string") throw new Error("The trick was not saved. Please try again.");
      setState(remove ? { key, status: "idle", id: null } : { key, status: "saved", id: data.trick.id });
    } catch (error) {
      setState({
        key,
        status: remove ? "saved" : "error",
        id: current.id,
        message: error instanceof Error ? error.message : remove ? "Could not remove this trick. Please try again." : "Could not save this trick. Please try again.",
      });
    }
  }

  const label = {
    idle: "Save this trick",
    saving: "Saving…",
    saved: "Saved",
    removing: "Removing…",
    error: "Not saved. Retry",
  }[current.status];
  return (
    <span className={styles.saveControl}>
      <button
        type="button"
        className={shared.copyButton}
        onClick={toggle}
        disabled={busy}
        aria-pressed={current.status === "saved"}
        title={current.status === "saved" ? "Saved to History. Click to remove." : "Keep this technique in your saved tricks on the History page."}
        data-testid="save-trick"
      >
        <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
          <path d="M6 3.5h8a1 1 0 0 1 1 1v12l-5-3.2-5 3.2v-12a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill={current.status === "saved" ? "currentColor" : "none"} />
        </svg>
        {label}
      </button>
      {current.message && <span className={styles.saveError} role="alert">{current.message}</span>}
    </span>
  );
}
