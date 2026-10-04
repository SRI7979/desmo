"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CalculatorVerificationProvider } from "@/components/calculator-verification";
import DesmosCalculator from "@/components/desmos-calculator";
import DesmoLogo from "@/components/desmo-logo";
import { preflight } from "@/components/preflight-gate";
import SolutionExplanation from "@/components/solution-explanation";
import TechniqueSelector from "@/components/technique-selector";
import { startSolveTiming, type SolveTimer } from "@/lib/client-timing";
import { calculatorPayload, preflightInRankOrder, reportable, type ReportedVerdict } from "@/lib/desmos-preflight";
import type { MethodSummary } from "@/lib/method-summary";
import { retryCountdown } from "@/lib/retry-countdown";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  solutionSchema,
  type Solution,
} from "@/lib/solver-schema";
import {
  baseSolution,
  explanationFromEvents,
  parseMethodsPayload,
  provisionalSolution,
  readNdjsonEvents,
  selectorMethods,
  type ExplanationStatus,
  type MethodsPayload,
  type VerdictStatus,
} from "@/lib/technique-selection-ui";
import styles from "./page.module.css";

const NO_EXPRESSIONS: Solution["expressions"] = [];
const NO_METHODS: MethodSummary[] = [];
const NDJSON = "application/x-ndjson";

/** Adapts a fetch response body into the string chunks readNdjsonEvents expects. */
async function* decodeBody(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      yield decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
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

type PreflightReply =
  | { status: "ready" | "retry"; payload: MethodsPayload }
  | { status: "failed"; error: string };

const HONEST_FAILURE =
  "Every method found for this problem has a Desmos line that errors, so none is shown. Try a tighter crop of just this question.";
const UNVERIFIED =
  "The calculator could not check this method's Desmos lines, so they are not shown. Reload the page and solve again.";

function isEvent(value: unknown): value is Record<string, unknown> & { type: string } {
  return Boolean(value) && typeof value === "object" && typeof (value as { type?: unknown }).type === "string";
}

export default function SolverWorkspace({ accountNav }: { accountNav: ReactNode }) {
  const [image, setImage] = useState<{ file: File; url: string } | null>(null);
  const [solution, setSolution] = useState<Solution | null>(null);
  const [methods, setMethods] = useState<MethodSummary[]>(NO_METHODS);
  const [verdicts, setVerdicts] = useState<Record<string, VerdictStatus>>({});
  const [selectedMethodId, setSelectedMethodId] = useState<string | null>(null);
  const [explanationStatus, setExplanationStatus] = useState<ExplanationStatus>("ready");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [revision, setRevision] = useState(0);
  const [problemId, setProblemId] = useState<string | null>(null);
  const [historyWarning, setHistoryWarning] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  // A daily limit or a full day's capacity: information, not an error.
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const switchRequest = useRef<AbortController | null>(null);
  // Invalidates a switch's in-flight explanation if a newer switch or a fresh
  // solve supersedes it before the response arrives.
  const switchToken = useRef(0);
  // One per solve: pre-flight results, stream events, and reports from an
  // earlier solve are ignored once a new one starts.
  const solveToken = useRef(0);
  // What async handlers read after an await, where state would be stale.
  const current = useRef<{
    methods: MethodSummary[];
    cacheKey: string | null;
    selectedId: string | null;
    base: Solution | null;
    /** The method the open solve stream is explaining, until the stream ends. */
    streamMethodId: string | null;
  }>({ methods: NO_METHODS, cacheKey: null, selectedId: null, base: null, streamMethodId: null });
  // Explanations that arrived, by method, so switching back is instant.
  const explained = useRef(new Map<string, Solution>());
  // Where this solve's time goes, as the student experiences it (no UI).
  const timer = useRef<SolveTimer | null>(null);
  const busy = loading || sampleLoading;
  // Only techniques whose rows ran cleanly in the hidden Desmos instance.
  const listed = useMemo(() => selectorMethods(methods, verdicts), [methods, verdicts]);

  useEffect(
    () => () => {
      if (image) URL.revokeObjectURL(image.url);
    },
    [image],
  );
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => () => switchRequest.current?.abort(), []);

  useEffect(() => {
    if (cooldownUntil === null) return;
    const interval = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
      setCooldownSeconds(remaining);
      if (remaining === 0) setCooldownUntil(null);
    }, 250);
    return () => window.clearInterval(interval);
  }, [cooldownUntil]);

  const resetResult = useCallback(() => {
    solveToken.current += 1;
    switchToken.current += 1;
    switchRequest.current?.abort();
    current.current = { methods: NO_METHODS, cacheKey: null, selectedId: null, base: null, streamMethodId: null };
    explained.current = new Map();
    setSolution(null);
    setMethods(NO_METHODS);
    setVerdicts({});
    setSelectedMethodId(null);
    setExplanationStatus("ready");
    setProblemId(null);
    setHistoryWarning(null);
  }, []);

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
    resetResult();
    setError(null);
    setRevision((value) => value + 1);
  }, [resetResult]);

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

  /**
   * Shows a technique that passed pre-flight. Its rows and answer come from
   * the methods already on hand, so the calculator swaps (or clears, for a
   * technique with no rows) at once. Only the default's explanation is written
   * up front; any other technique's is requested now, the first time it is
   * chosen, and kept, so choosing it again is instant with no request.
   */
  function showMethod(method: MethodSummary) {
    const base = current.current.base;
    if (!base) return;
    const ready = explained.current.get(method.id);
    current.current.selectedId = method.id;
    setSelectedMethodId(method.id);
    setSolution(ready ?? provisionalSolution(base, method));
    setExplanationStatus(ready ? "ready" : "pending");
    setRevision((value) => value + 1);
    if (!ready && method.id !== current.current.streamMethodId) void fetchExplanation(method.id);
  }

  /**
   * Generates (or reads the server's cached copy of) one technique's
   * explanation. Any failure, including an HTTP error, a lost connection, or
   * the one-line fallback summary, leaves the rows and answer in place and
   * turns the explanation panel into a retry; it is never swallowed.
   */
  async function fetchExplanation(methodId: string) {
    const key = current.current.cacheKey;
    if (!key) return;
    switchRequest.current?.abort();
    const controller = new AbortController();
    switchRequest.current = controller;
    const token = ++switchToken.current;
    let delivered: Solution | null = null;
    try {
      const response = await fetch("/api/solve/method", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: NDJSON },
        body: JSON.stringify({ cacheKey: key, methodId }),
        signal: controller.signal,
      });
      if (response.ok && response.body) {
        const events: unknown[] = [];
        for await (const event of readNdjsonEvents(decodeBody(response.body))) {
          if (switchToken.current !== token) return;
          events.push(event);
        }
        delivered = explanationFromEvents(events);
      }
    } catch {
      // Handled below: a newer request superseded this one, or it failed.
    }
    if (switchToken.current !== token) return;
    if (switchRequest.current === controller) switchRequest.current = null;
    if (delivered) explained.current.set(methodId, delivered);
    if (current.current.selectedId !== methodId) return;
    if (delivered) setSolution(delivered);
    setExplanationStatus(delivered ? "ready" : "failed");
  }

  function retryExplanation() {
    const methodId = current.current.selectedId;
    if (!methodId) return;
    setExplanationStatus("pending");
    void fetchExplanation(methodId);
  }

  async function sendReport(key: string, reports: ReportedVerdict[]): Promise<PreflightReply | null> {
    try {
      const response = await fetch("/api/solve/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cacheKey: key, verdicts: reports }),
      });
      const data = await response.json().catch(() => null);
      if (response.status === 422) return { status: "failed", error: typeof data?.error === "string" ? data.error : HONEST_FAILURE };
      const payload = response.ok ? parseMethodsPayload(data) : null;
      return payload && (data.status === "ready" || data.status === "retry") ? { status: data.status, payload } : null;
    } catch {
      return null;
    }
  }

  /** Nothing can honestly be shown: say so, and show no rows at all. */
  function fail(message: string) {
    resetResult();
    request.current?.abort();
    setLoading(false);
    setError(message);
  }

  /**
   * The pre-flight gate for one solve. Techniques are checked in rank order in
   * a hidden Desmos instance; the first whose every row runs cleanly is shown
   * (one check when the winner is clean), and a technique with any erroring
   * row is never shown or listed. Every result is reported so later solves of
   * this problem reuse it. When every technique errors, the server retries
   * call 1 once with the Desmos errors attached; if that fails too, this is an
   * honest failure with no rows.
   */
  async function runPreflight(payload: MethodsPayload, token: number, options: { retried?: boolean; distrust?: boolean } = {}) {
    current.current = {
      ...current.current,
      methods: payload.methods,
      cacheKey: payload.cacheKey,
      base: baseSolution(payload),
      streamMethodId: options.retried || options.distrust ? null : payload.selectedMethodId,
    };
    setMethods(payload.methods);
    setVerdicts({});
    const reports: ReportedVerdict[] = [];
    const run = await preflightInRankOrder(payload.methods, preflight, {
      trusted: (method) => !options.distrust && method.verified,
      isCancelled: () => solveToken.current !== token,
      onVerdict: (method, verdict, checked) => {
        setVerdicts((previous) => ({ ...previous, [method.id]: verdict.status }));
        const report = checked ? reportable(method.id, verdict) : null;
        if (report) reports.push(report);
      },
      onPromote: (method) => {
        setLoading(false);
        timer.current?.mark("rows_shown");
        showMethod(method);
        if (method.verified && !options.distrust && method.rows.length > 0) void confirmCached(method, payload, token);
      },
    }).catch(() => null);
    if (solveToken.current !== token) return;
    if (!run) return fail(UNVERIFIED);
    if (run.promoted) {
      if (reports.length > 0) void sendReport(payload.cacheKey, reports);
      return;
    }
    const everyMethodErrored = payload.methods.every((method) => run.verdicts.get(method.id)?.status === "error");
    if (!everyMethodErrored) {
      if (reports.length > 0) void sendReport(payload.cacheKey, reports);
      return fail(UNVERIFIED);
    }
    const reply = await sendReport(payload.cacheKey, reports);
    if (solveToken.current !== token) return;
    if (reply?.status === "retry" && !options.retried) {
      // The stream was explaining a method that errored; the retry's methods replace it.
      request.current?.abort();
      explained.current = new Map();
      return runPreflight(reply.payload, token, { retried: true });
    }
    fail(reply?.status === "failed" ? reply.error : HONEST_FAILURE);
  }

  /**
   * A method the server's cache marked verified is shown without a
   * selection-time check, but the rendering gate still checks it. If this
   * browser's Desmos disagrees, it is reported and never shown, and the rest
   * are re-checked here instead of trusting the cache.
   */
  async function confirmCached(method: MethodSummary, payload: MethodsPayload, token: number) {
    const verdict = await preflight(calculatorPayload(method.rows, method.answerState)).catch(() => null);
    if (solveToken.current !== token || verdict?.status !== "error") return;
    void sendReport(payload.cacheKey, [{ methodId: method.id, status: "error", errors: verdict.errors }]);
    explained.current.delete(method.id);
    setLoading(true);
    setSolution(null);
    await runPreflight({ ...payload, methods: payload.methods.filter((item) => item.id !== method.id) }, token, { distrust: true });
  }

  function handleStreamSolution(event: Record<string, unknown>) {
    if (typeof event.problemId === "string") setProblemId(event.problemId);
    if (typeof event.historyWarning === "string") setHistoryWarning(event.historyWarning);
    current.current.streamMethodId = null;
    const parsed = solutionSchema.safeParse(event.solution);
    if (!parsed.success) return;
    if (parsed.data.status === "needs_clarification") {
      setLoading(false);
      setSolution(parsed.data);
      return;
    }
    const methodId = typeof event.methodId === "string" ? event.methodId : null;
    if (!methodId) return;
    // The default's explanation is written during the solve; a fallback
    // summary means it failed, so the panel offers a retry instead.
    const delivered = explanationFromEvents([event]);
    if (delivered) explained.current.set(methodId, delivered);
    if (current.current.selectedId !== methodId) return;
    if (delivered) setSolution(delivered);
    setExplanationStatus(delivered ? "ready" : "failed");
  }

  async function solve() {
    if (!image || busy || request.current || cooldownSeconds > 0) return;
    const controller = new AbortController();
    request.current = controller;
    let timedOut = false;
    // Leave room for the server's 180 s route limit to return its own error.
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 195_000);
    resetResult();
    const token = solveToken.current;
    timer.current = startSolveTiming();
    setLoading(true);
    setError(null);
    setNotice(null);
    setNeedsSignIn(false);
    setRevision((value) => value + 1);
    try {
      const form = new FormData();
      form.append("image", image.file);
      const response = await fetch("/api/solve", {
        method: "POST",
        headers: { Accept: NDJSON },
        body: form,
        signal: controller.signal,
      });
      timer.current?.mark("response");
      timer.current?.serverTiming(response.headers.get("server-timing"));
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        if (response.status === 401) setNeedsSignIn(true);
        // Waiting a few seconds does not help either limit, so no countdown;
        // history and already-solved problems stay available.
        if ((data?.kind === "daily_cap" || data?.kind === "at_capacity") && typeof data.error === "string") {
          setNotice(data.error);
          return;
        }
        const wait = retryCountdown(response.status, data, response.headers.get("Retry-After"));
        if (wait !== null) {
          setCooldownSeconds(wait);
          setCooldownUntil(Date.now() + wait * 1000);
        }
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : response.status === 413
              // The host refused the upload before the app saw it (on Vercel, over 4.5 MB).
              ? "That screenshot is too large to upload. Crop it to the question or export a smaller image."
              : "The solver could not finish. Please try again.",
        );
      }
      if (!response.body) throw new Error("The solver returned an empty response. Please try again.");
      // Rows arrive with the "methods" event and go through pre-flight while
      // the server writes the explanation; the "solution" event fills it in.
      let sawResult = false;
      for await (const event of readNdjsonEvents(decodeBody(response.body))) {
        if (solveToken.current !== token) break;
        if (!isEvent(event)) continue;
        if (event.type === "methods") {
          timer.current?.mark("methods");
          const payload = parseMethodsPayload(event);
          if (!payload) throw new Error("The solver returned an invalid response. Please try again.");
          sawResult = true;
          void runPreflight(payload, token);
        } else if (event.type === "solution") {
          sawResult = true;
          timer.current?.mark("explanation");
          handleStreamSolution(event);
        } else if (event.type === "saved") {
          // History is written after the explanation is sent, so it never delays it.
          if (typeof event.problemId === "string") setProblemId(event.problemId);
          if (typeof event.historyWarning === "string") setHistoryWarning(event.historyWarning);
        } else if (event.type === "error") {
          if (!sawResult) throw new Error(typeof event.error === "string" ? event.error : "The solver could not finish. Please try again.");
          current.current.streamMethodId = null;
          const selected = current.current.selectedId;
          if (selected && !explained.current.has(selected)) setExplanationStatus("failed");
        }
      }
      if (!sawResult && solveToken.current === token) throw new Error("The solver returned an invalid response. Please try again.");
      if (solveToken.current === token) timer.current?.finish();
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
        // Pre-flight may still be choosing what to show; it ends loading itself.
        if (solveToken.current !== token || current.current.selectedId || !current.current.methods.length) setLoading(false);
      }
    }
  }

  function clearImage() {
    setImage(null);
    resetResult();
    setError(null);
    setRevision((value) => value + 1);
    if (fileInput.current) fileInput.current.value = "";
  }

  function switchTechnique(methodId: string) {
    if (methodId === current.current.selectedId) return;
    const method = listed.find((item) => item.id === methodId);
    if (method) showMethod(method);
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
            {notice && (
              <p className={styles.limitNotice} role="status" data-testid="limit-notice">
                {notice} <Link href="/history">Open your history</Link>.
              </p>
            )}
            {(error || needsSignIn) && (
              <div className={styles.error} role="alert">
                {error || "Your session expired."}
                {needsSignIn && (
                  <> <Link href="/login?next=%2Fsolve">Sign in to continue</Link>.</>
                )}
              </div>
            )}
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
              {solution?.status === "solved" && listed.length > 0 && selectedMethodId && (
                <TechniqueSelector methods={listed} selectedId={selectedMethodId} onSelect={switchTechnique} />
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
                  <SolutionExplanation solution={solution} explanationStatus={explanationStatus} onRetryExplanation={retryExplanation} />
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
