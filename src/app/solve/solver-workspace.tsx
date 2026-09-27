"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { CalculatorVerificationProvider } from "@/components/calculator-verification";
import DesmosCalculator from "@/components/desmos-calculator";
import DesmoLogo from "@/components/desmo-logo";
import SolutionExplanation from "@/components/solution-explanation";
import { METHOD_LABELS } from "@/lib/method-labels";
import {
  ACCEPTED_IMAGE_TYPES,
  DEFAULT_SOLVE_MODE,
  MAX_IMAGE_BYTES,
  SOLVE_MODE_LABELS,
  SOLVE_MODES,
  solutionSchema,
  type Solution,
  type SolveMode,
} from "@/lib/solver-schema";
import styles from "./page.module.css";

const NO_EXPRESSIONS: Solution["expressions"] = [];
const MODE_HINTS: Record<SolveMode, string> = {
  weaponized: "Replace as much math as possible with reusable Desmos tricks.",
  desmos_first: "Strongly prefer Desmos; basic math only when it clearly simplifies.",
  fastest: "Assume strong math skills; pick the fastest reliable method.",
};
const MODE_STORAGE_KEY = "desmo.solveMode";

// The chosen mode is a per-browser convenience; the server default applies
// until the browser reports a saved choice, so hydration never mismatches.
const modeListeners = new Set<() => void>();
function readStoredMode(): SolveMode {
  try {
    const saved = window.localStorage.getItem(MODE_STORAGE_KEY);
    return SOLVE_MODES.find((item) => item === saved) ?? DEFAULT_SOLVE_MODE;
  } catch {
    return DEFAULT_SOLVE_MODE;
  }
}
function subscribeToMode(listener: () => void) {
  modeListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    modeListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}
function storeMode(next: SolveMode) {
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, next);
  } catch {
    // Storage may be unavailable; the selection still applies to this page.
  }
  modeListeners.forEach((listener) => listener());
}

function ArrowIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M5 12h14m-6-6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function SolverWorkspace({ accountNav }: { accountNav: ReactNode }) {
  const [image, setImage] = useState<{ file: File; url: string } | null>(null);
  const [solution, setSolution] = useState<Solution | null>(null);
  const storedMode = useSyncExternalStore(subscribeToMode, readStoredMode, () => DEFAULT_SOLVE_MODE);
  const [sessionMode, setSessionMode] = useState<SolveMode | null>(null);
  const mode = sessionMode ?? storedMode;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [revision, setRevision] = useState(0);
  const [problemId, setProblemId] = useState<string | null>(null);
  const [historyWarning, setHistoryWarning] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const busy = loading || sampleLoading;

  useEffect(
    () => () => {
      if (image) URL.revokeObjectURL(image.url);
    },
    [image],
  );
  useEffect(() => () => request.current?.abort(), []);

  function chooseMode(next: SolveMode) {
    setSessionMode(next);
    storeMode(next);
  }

  useEffect(() => {
    if (cooldownUntil === null) return;
    const interval = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
      setCooldownSeconds(remaining);
      if (remaining === 0) setCooldownUntil(null);
    }, 250);
    return () => window.clearInterval(interval);
  }, [cooldownUntil]);

  const selectFile = useCallback((file: File) => {
    if (!ACCEPTED_IMAGE_TYPES.some((type) => type === file.type)) {
      setError("Choose a PNG, JPG, or WebP screenshot.");
      return;
    }
    if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
      setError("Choose a screenshot smaller than 8 MB that is not empty.");
      return;
    }
    setImage({ file, url: URL.createObjectURL(file) });
    setSolution(null);
    setProblemId(null);
    setHistoryWarning(null);
    setError(null);
    setRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    const pasteImage = (event: ClipboardEvent) => {
      if (busy) return;
      const files = Array.from(event.clipboardData?.files ?? []).filter((item) =>
        item.type.startsWith("image/"),
      );
      if (files.length > 0) {
        event.preventDefault();
        if (files.length > 1) setError("Upload one image at a time, with one complete math question.");
        else selectFile(files[0]);
      }
    };
    window.addEventListener("paste", pasteImage);
    return () => window.removeEventListener("paste", pasteImage);
  }, [busy, selectFile]);

  async function loadSample() {
    setSampleLoading(true);
    setError(null);
    try {
      const response = await fetch("/sample-question.png");
      if (!response.ok)
        throw new Error(
          "The sample could not be loaded. Upload your own screenshot instead.",
        );
      selectFile(
        new File([await response.blob()], "sample-question.png", {
          type: "image/png",
        }),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not load the sample question.",
      );
    } finally {
      setSampleLoading(false);
    }
  }

  async function solve() {
    if (!image || busy || request.current || cooldownSeconds > 0) return;
    const controller = new AbortController();
    request.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 180_000);
    setLoading(true);
    setError(null);
    setSolution(null);
    setProblemId(null);
    setHistoryWarning(null);
    setNeedsSignIn(false);
    setRevision((value) => value + 1);
    try {
      const form = new FormData();
      form.append("image", image.file);
      form.append("mode", mode);
      const response = await fetch("/api/solve", {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 401) setNeedsSignIn(true);
        if (response.status === 429) {
          const retryAfter = response.headers.get("Retry-After");
          const seconds = retryAfter && /^\d+$/.test(retryAfter)
            ? Number(retryAfter)
            : retryAfter ? Math.ceil((Date.parse(retryAfter) - Date.now()) / 1000) : 60;
          const wait = Number.isFinite(seconds) ? Math.min(86_400, Math.max(1, seconds)) : 60;
          setCooldownSeconds(wait);
          setCooldownUntil(Date.now() + wait * 1000);
        }
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "The solver could not finish. Please try again.",
        );
      }
      const parsed = solutionSchema.safeParse(data?.solution);
      if (!parsed.success)
        throw new Error(
          process.env.NODE_ENV === "development"
            ? `Solution validation failed [client_schema]: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`
            : "The solver returned an invalid response. Please try again.",
        );
      if (controller.signal.aborted) return;
      setSolution(parsed.data);
      setProblemId(typeof data.problemId === "string" ? data.problemId : null);
      setHistoryWarning(typeof data.historyWarning === "string" ? data.historyWarning : null);
      setRevision((value) => value + 1);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not connect to the solver. Please try again.",
        );
      else if (timedOut)
        setError(
          "This took too long. Try a clearer screenshot or solve again.",
        );
    } finally {
      window.clearTimeout(timeout);
      if (request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  }

  function clearImage() {
    setImage(null);
    setSolution(null);
    setProblemId(null);
    setHistoryWarning(null);
    setError(null);
    setRevision((value) => value + 1);
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <DesmoLogo />
        {accountNav}
      </header>
      <main className={styles.main}>
        <h1 className={styles.srOnly}>Solver</h1>
        <CalculatorVerificationProvider>
        <div className={styles.workspace}>
          <section
            className={`${styles.card} ${styles.uploadCard}`}
            aria-labelledby="upload-title"
          >
            <div className={styles.cardHeading}>
              <h2 id="upload-title">Question</h2>
              <button
                type="button"
                className={styles.sampleButton}
                onClick={loadSample}
                disabled={busy}
              >
                {sampleLoading ? "Loading…" : "Use sample"}
              </button>
            </div>
            <input
              ref={fileInput}
              id="question-image"
              className={styles.srOnly}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) selectFile(file);
                event.target.value = "";
              }}
            />
            <label
              htmlFor="question-image"
              className={`${styles.uploadZone} ${image ? styles.hasImage : ""} ${dragging ? styles.dragging : ""} ${busy ? styles.uploadDisabled : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                if (!busy) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                if (!busy && event.dataTransfer.files.length > 1)
                  setError("Upload one image at a time, with one complete math question.");
                else if (!busy && event.dataTransfer.files[0])
                  selectFile(event.dataTransfer.files[0]);
              }}
            >
              {image ? (
                <>
                  <Image
                    src={image.url}
                    width={900}
                    height={600}
                    unoptimized
                    alt="Your uploaded math question"
                    className={styles.preview}
                  />
                  <span className={styles.replaceHint}>Replace image</span>
                </>
              ) : (
                <>
                  <span className={styles.uploadIcon} aria-hidden="true">
                    <svg
                      width="25"
                      height="25"
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <path
                        d="M12 16V4m-4 4 4-4 4 4M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <strong>Upload one math question</strong>
                  <span><span className={styles.browseLink}>Choose image</span> · drag or paste</span>
                  <small>PNG, JPG, or WebP · up to 8 MB</small>
                </>
              )}
            </label>
            {image && (
              <div className={styles.fileDetails}>
                <span title={image.file.name}>{image.file.name}</span>
                <button type="button" onClick={clearImage} disabled={busy}>
                  Remove
                </button>
              </div>
            )}
            <button
              className={styles.solveButton}
              type="button"
              disabled={!image || busy || cooldownSeconds > 0 || needsSignIn}
              onClick={solve}
            >
              {loading ? (
                <>
                  <span className={styles.spinner} /> Solving…
                </>
              ) : cooldownSeconds > 0 ? (
                `Try again in ${cooldownSeconds}s`
              ) : (
                <>
                  {error && image ? "Try again" : "Solve"} <ArrowIcon />
                </>
              )}
            </button>
            {loading && (
              <div className={styles.cancelRow}>
                <button
                  type="button"
                  className={styles.textButton}
                  onClick={() => request.current?.abort()}
                >
                  Cancel
                </button>
              </div>
            )}
            {(error || needsSignIn) && (
              <div className={styles.error} role="alert">
                {error || "Your session expired."}
                {needsSignIn && (
                  <> <Link href="/login?next=%2Fsolve">Sign in to continue</Link>.</>
                )}
              </div>
            )}
            <fieldset className={styles.modes} disabled={busy}>
              <legend className={styles.modesLegend}>Mode</legend>
              <div className={styles.modeOptions} role="radiogroup" aria-label="Solving mode">
                {SOLVE_MODES.map((item) => (
                  <label
                    key={item}
                    className={`${styles.modeOption} ${mode === item ? styles.modeSelected : ""}`}
                    title={MODE_HINTS[item]}
                  >
                    <input
                      type="radio"
                      name="mode"
                      value={item}
                      checked={mode === item}
                      onChange={() => chooseMode(item)}
                    />
                    {SOLVE_MODE_LABELS[item]}
                  </label>
                ))}
              </div>
              <p className={styles.modeHint}>{MODE_HINTS[mode]}</p>
            </fieldset>
            <p className={styles.privacyNote}>
              Images are sent to OpenAI. Results are saved to your private history.
            </p>
          </section>
          <section
            className={`${styles.card} ${styles.calculatorCard}`}
            aria-labelledby="calculator-title"
          >
            <div className={styles.calculatorHeading}>
              <h2 id="calculator-title">Calculator</h2>
            </div>
            <DesmosCalculator
              expressions={
                solution?.status === "solved"
                  ? solution.expressions
                  : NO_EXPRESSIONS
              }
              bounds={
                solution?.status === "solved" ? solution.graphBounds : null
              }
              answerState={
                solution?.status === "solved" ? solution.answerState : null
              }
              revision={revision}
            />
          </section>
          <section
            className={`${styles.card} ${styles.resultCard}`}
            aria-labelledby="result-title"
            aria-busy={loading}
          >
            <div className={styles.resultHeading}>
              <h2 id="result-title">Explanation</h2>
              {solution?.status === "solved" && (
                <span className={styles.methodBadge} data-testid="trick-badge">
                  {solution.trick ||
                    (solution.expressions.length > 0
                      ? "Desmos"
                      : METHOD_LABELS[solution.method])}
                </span>
              )}
            </div>
            <div className={styles.resultBody}>
              {loading ? (
                <div className={styles.loadingState} role="status">
                  <p className={styles.loadingLabel}><span className={styles.spinner} aria-hidden="true" /> Reading the question and checking a method…</p>
                  <div className={styles.loadingSkeleton} aria-hidden="true">
                    <span className={styles.skeletonAnswer} />
                    <span className={styles.skeletonLine} />
                    <span className={styles.skeletonShort} />
                    <span className={styles.skeletonEquation} />
                    <span className={styles.skeletonShort} />
                  </div>
                </div>
              ) : solution ? (
                <>
                  <SolutionExplanation solution={solution} />
                  {problemId && (
                    <p className={styles.savedNotice} role="status">
                      Saved to <Link href={`/history/${encodeURIComponent(problemId)}`}>your history</Link>.
                    </p>
                  )}
                  {historyWarning && <p className={styles.error} role="status">{historyWarning}</p>}
                </>
              ) : (
                <div className={styles.emptyResult}>
                  <p>Upload a question to see the method and each Desmos line explained.</p>
                </div>
              )}
            </div>
          </section>
        </div>
        </CalculatorVerificationProvider>
      </main>
    </div>
  );
}
