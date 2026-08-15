"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Countdown, ReconnectBanner, BackLink, type ConnectionStatus } from "@/components/bidwave";
import { Button } from "@/components/ui/button";
import {
  startQuizAttempt,
  getQuizStateAction,
  saveQuizAnswerAction,
  submitQuizAttemptAction,
  recordQuizStrikeAction,
  ackQuizWarningAction,
  resumeQuizAttemptAction,
} from "@/app/app/quiz/[roundId]/actions";
import { setQuizExitGuard } from "@/lib/quiz-exit-guard";

type QuizOption = { id: string; position: number; label: string };
type QuizQuestionState = {
  status: "in_progress" | "submitted" | "time_expired";
  attempt_id: string;
  index?: number;
  total?: number;
  question?: { id: string; prompt: string; weight: number; options: QuizOption[] };
  closes_at?: string;
  scheduled_ends_at?: string;
  saved_option_id?: string | null;
  submitted_at?: string;
  submit_reason?: string;
  exit_policy?: ExitPolicy;
  strike_count?: number;
  strike_limit?: number;
  warning_pending?: boolean;
  answered_count?: number;
  server_now?: string;
};

type Receipt = {
  submitted_at?: string;
  submit_reason?: string;
  answered_count?: number;
  question_count?: number;
  total?: number;
};

export type ExitPolicy = "strict" | "lenient";

const POLL_MS = 2500;
/** How often the local deadline watcher checks the current question's clock. */
const TICK_MS = 250;
/** Grace past a question's deadline before we start retrying the refetch. */
const STALL_MS = 2000;

/**
 * QZ-10..16: pre-flight confirmation -> one question per screen on a
 * lockstep server schedule -> exit detection. See docs/QUIZ_LIMITATIONS.md
 * for what a browser genuinely cannot lock down.
 *
 * Two exit policies, chosen per round (rounds.quiz_exit_policy):
 *
 *   'strict'  — Round 1's original behaviour, preserved bit-for-bit so its
 *               recorded attempts stay governed by the rules in force when
 *               they ran. Fullscreen is requested and monitored; the first
 *               exit signal of any kind submits the attempt.
 *
 *   'lenient' — the Round 1 re-attempt. Fullscreen is neither requested nor
 *               monitored (a brightness slider or notification shade drops
 *               it, which ended 7 real attempts), a refresh RESUMES rather
 *               than submits (a pagehide beacon submitted one team's
 *               attempt with zero answers), and only tab switch / minimise
 *               / navigating away count — costing a warning first, and only
 *               ending the attempt on the round's strike limit. The server
 *               owns that counter; see record_quiz_strike.
 */
export function QuizRunner({
  roundId,
  roundTitle,
  instructions,
  exitPolicy,
  strikeLimit,
  alreadySubmitted,
  hasInProgressAttempt = false,
}: {
  roundId: string;
  roundTitle?: string;
  instructions?: string | null;
  exitPolicy: ExitPolicy;
  strikeLimit: number;
  alreadySubmitted: boolean;
  hasInProgressAttempt?: boolean;
}) {
  const lenient = exitPolicy === "lenient";

  const [phase, setPhase] = useState<
    "preflight" | "starting" | "resuming" | "in_progress" | "submitted" | "session_replaced" | "error"
  >(alreadySubmitted ? "submitted" : lenient && hasInProgressAttempt ? "resuming" : "preflight");
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [state, setState] = useState<QuizQuestionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("online");
  const [warningPending, setWarningPending] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const sessionTokenRef = useRef<string | null>(null);
  const submittingRef = useRef(false);
  const pollFailuresRef = useRef(0);
  const strikingRef = useRef(false);
  /**
   * server_now minus the client clock at the same instant. The lockstep
   * schedule is server-authoritative, so every deadline comparison below
   * goes through this rather than a raw Date.now(). Recomputed on every
   * successful poll.
   */
  const clockOffsetRef = useRef(0);
  /** Refetch scheduling for the deadline watcher, so it can't spin. */
  const nextRefetchAtRef = useRef(0);
  const refetchRef = useRef<(() => Promise<void>) | null>(null);

  const serverNow = useCallback(() => Date.now() + clockOffsetRef.current, []);

  function applyState(data: QuizQuestionState) {
    if (data.server_now) {
      clockOffsetRef.current = new Date(data.server_now).getTime() - Date.now();
    }
    setState(data);
    if (typeof data.warning_pending === "boolean") setWarningPending(data.warning_pending);
  }

  function applyReceipt(d: Partial<Receipt> | null | undefined) {
    if (!d) return;
    setReceipt((prev) => ({ ...prev, ...d }));
  }

  const finalize = useCallback(
    async (reason: string) => {
      if (submittingRef.current || phase === "submitted") return;
      const token = sessionTokenRef.current;
      if (!token) return;
      submittingRef.current = true;
      try {
        const res = await submitQuizAttemptAction(roundId, reason, token);
        if (res.data) {
          applyReceipt(res.data as Receipt);
          setPhase("submitted");
          toast.success("Quiz submitted.");
        } else if (res.error) {
          setError(res.error);
        }
      } finally {
        submittingRef.current = false;
      }
    },
    [roundId, phase],
  );

  /**
   * Lenient policy only. Reports the exit and lets the server decide the
   * consequence — it may come back 'warned' (attempt continues) or already
   * submitted, and the client must not assume either.
   */
  const recordStrike = useCallback(
    async (kind: string) => {
      const token = sessionTokenRef.current;
      if (!token || submittingRef.current || strikingRef.current) return;
      strikingRef.current = true;
      try {
        const res = await recordQuizStrikeAction(roundId, token, kind);
        const data = res.data as
          | { status: string; strike_count?: number; submitted_at?: string; submit_reason?: string }
          | undefined;
        if (!data) return;
        if (data.status === "submitted") {
          applyReceipt(data as Receipt);
          setPhase("submitted");
          toast.error("Your attempt has ended and was submitted.");
        } else if (data.status === "warned") {
          setWarningPending(true);
        } else if (data.status === "session_replaced") {
          setPhase("session_replaced");
        }
      } finally {
        strikingRef.current = false;
      }
    },
    [roundId],
  );

  // ---------------------------------------------------------------------
  // Exit detection
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (phase !== "in_progress") return;

    function onFullscreenChange() {
      if (!document.fullscreenElement) void finalize("fullscreen_exit");
    }
    function onVisibilityChange() {
      if (document.hidden) {
        if (lenient) void recordStrike("visibility_hidden");
        else void finalize("visibility_hidden");
      } else if (lenient) {
        // Coming back from a throttled/background tab: setInterval is
        // clamped hard while hidden, so the deadline watcher may be many
        // seconds stale. Resync immediately rather than waiting a tick.
        void refetchRef.current?.();
      }
    }
    function onPageHide() {
      const token = sessionTokenRef.current;
      if (!token) return;
      const blob = new Blob([JSON.stringify({ roundId, reason: "page_hidden", sessionToken: token })], {
        type: "application/json",
      });
      navigator.sendBeacon("/api/quiz/submit", blob);
    }
    // A native browser back/forward press fires neither fullscreenchange,
    // visibilitychange nor pagehide (Next.js serves it as a client-side
    // route swap, not a document unload) — the same "same-tab navigation"
    // gap quiz-exit-guard.ts closes for the Sign-out button, just triggered
    // by the browser chrome instead of an in-app click.
    //
    // The legacy `popstate` event is *not* a usable signal for this in Next
    // 16: confirmed by direct reproduction that on Chromium, App Router's
    // client router intercepts back/forward via the Navigation API
    // (`window.navigation`'s `navigate` event) and completes its route swap
    // — unmounting this component and running this effect's cleanup, which
    // removes the popstate listener — *before* the browser gets around to
    // dispatching `popstate` to window listeners. A `popstate` handler
    // registered here is reliably gone by the time `popstate` itself fires.
    // The Navigation API's `navigate` event, by contrast, fires
    // synchronously to all listeners before the intercepting listener's
    // (necessarily async, since it RSC-fetches the previous route) work
    // resolves — so this component is still mounted when it runs. Falls
    // back to `popstate` on browsers without the Navigation API (Firefox,
    // Safari as of writing — see docs/BROWSER_SUPPORT.md), where Next can't
    // intercept this way either and the ordering problem above doesn't
    // arise. Safe as fire-and-forget either way: unlike sign-out,
    // back-navigation never clears the auth session first, so there's no
    // race to guard against.
    function onBackForward() {
      if (lenient) void recordStrike("navigation");
      else void finalize("navigation");
    }

    const nav = (window as unknown as { navigation?: EventTarget }).navigation;
    function onNavigate(e: Event) {
      if ((e as unknown as { navigationType?: string }).navigationType === "traverse") {
        onBackForward();
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    // Under the lenient policy fullscreen is not monitored at all, and
    // pagehide must NOT submit — a refresh or an OS backgrounding has to be
    // survivable, and resume_quiz_attempt is how the team comes back.
    if (!lenient) {
      document.addEventListener("fullscreenchange", onFullscreenChange);
      window.addEventListener("pagehide", onPageHide);
    }
    if (nav) {
      nav.addEventListener("navigate", onNavigate);
    } else {
      window.addEventListener("popstate", onBackForward);
    }
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (!lenient) {
        document.removeEventListener("fullscreenchange", onFullscreenChange);
        window.removeEventListener("pagehide", onPageHide);
      }
      if (nav) {
        nav.removeEventListener("navigate", onNavigate);
      } else {
        window.removeEventListener("popstate", onBackForward);
      }
    };
  }, [phase, finalize, recordStrike, roundId, lenient]);

  // Same-tab client-side navigation (e.g. clicking "Sign out" in the shared
  // /app header) doesn't fire visibilitychange/pagehide — Next.js can serve
  // it as a client transition with no document unload. An unmount-cleanup
  // approach doesn't work here: signOut()'s Server Action clears the auth
  // session server-side *before* the redirect, so a call fired after
  // unmount fails auth. Instead, register a guard while in_progress that
  // whatever triggers the navigation awaits *before* proceeding, while the
  // session is still valid. See src/lib/quiz-exit-guard.ts.
  useEffect(() => {
    if (phase !== "in_progress") return;
    setQuizExitGuard(() => (lenient ? recordStrike("navigation") : finalize("navigation")));
    return () => setQuizExitGuard(null);
  }, [phase, finalize, recordStrike, lenient]);

  // ---------------------------------------------------------------------
  // Polling + the deadline watcher
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (phase !== "in_progress" || !sessionToken) return;
    let cancelled = false;

    async function poll() {
      // Polling is both the heartbeat (get_quiz_state stamps
      // session_seen_at) and how a connection drop becomes visible. A
      // thrown exception and a returned RPC error both count toward the
      // reconnecting/offline banner, but NEITHER may stop the interval —
      // the next tick must always be allowed to recover (ERR-08, NFR-05).
      //
      // This used to `setError(...); return;` on any returned error, which
      // left the runner permanently frozen on the current question after a
      // single transient failure — the "the quiz didn't move on" report.
      try {
        const res = await getQuizStateAction(roundId, sessionToken!);
        if (cancelled) return;
        if (res.error) {
          if (/session was replaced/i.test(res.error)) {
            setPhase("session_replaced");
            return;
          }
          if (/no active quiz attempt/i.test(res.error)) {
            setError(res.error);
            setPhase("error");
            return;
          }
          pollFailuresRef.current += 1;
          setConnectionStatus(pollFailuresRef.current >= 3 ? "offline" : "reconnecting");
          return;
        }
        pollFailuresRef.current = 0;
        setConnectionStatus("online");
        setError(null);
        const data = res.data as QuizQuestionState;
        applyState(data);
        setAdvancing(false);
        if (data.status === "submitted") {
          applyReceipt(data as Receipt);
          setPhase("submitted");
          toast.success("Quiz submitted.");
        } else if (data.status === "time_expired") {
          void finalize("completed");
        }
      } catch {
        if (cancelled) return;
        pollFailuresRef.current += 1;
        setConnectionStatus(pollFailuresRef.current >= 3 ? "offline" : "reconnecting");
      }
    }

    refetchRef.current = poll;
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      refetchRef.current = null;
      clearInterval(id);
    };
  }, [phase, sessionToken, roundId, finalize]);

  /**
   * The lockstep schedule has no push channel, and waiting for the next
   * poll tick meant a question could sit on screen for up to POLL_MS after
   * its timer visibly hit zero — longer in a throttled tab, and forever if
   * the poll had already wedged itself on an error. This watches the
   * current question's own deadline against the server-corrected clock and
   * refetches the moment it passes, then keeps retrying with backoff if the
   * index hasn't moved.
   */
  useEffect(() => {
    if (phase !== "in_progress") return;
    const closesAt = state?.closes_at ? new Date(state.closes_at).getTime() : null;
    if (!closesAt) return;

    nextRefetchAtRef.current = 0;
    let attempt = 0;

    const id = setInterval(() => {
      const now = serverNow();
      if (now < closesAt) return;
      setAdvancing(true);
      if (now < nextRefetchAtRef.current) return;
      // 1s, 2s, 4s, capped at 8s — a stalled server response must not turn
      // into a refetch storm, but must also never give up.
      const backoff = Math.min(1000 * 2 ** attempt, 8000);
      nextRefetchAtRef.current = now + (now > closesAt + STALL_MS ? backoff : 0) + 250;
      attempt += 1;
      void refetchRef.current?.();
    }, TICK_MS);

    return () => clearInterval(id);
  }, [phase, state?.closes_at, state?.index, serverNow]);

  // ---------------------------------------------------------------------
  // Entry paths
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (phase !== "resuming") return;
    let cancelled = false;
    (async () => {
      const res = await resumeQuizAttemptAction(roundId);
      if (cancelled) return;
      if (res.error) {
        setError(res.error);
        setPhase("error");
        return;
      }
      if (res.data?.status === "submitted") {
        setPhase("submitted");
        return;
      }
      if (res.data?.session_token) {
        sessionTokenRef.current = res.data.session_token;
        setSessionToken(res.data.session_token);
        setPhase("in_progress");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, roundId]);

  async function handleStart() {
    setPhase("starting");
    setError(null);
    // NFR-01/QZ-11: fire-and-forget. Some browser/OS/automation contexts
    // never resolve or reject this promise at all (no user-gesture dialog
    // to answer), which would otherwise stall the entire start sequence
    // forever. Fullscreen is a "strongest practical" best-effort per §10.3,
    // never a hard block on starting the attempt. Skipped entirely under
    // the lenient policy, where fullscreen is not monitored: asking for it
    // and then not caring when it drops is just a jarring non-event.
    if (!lenient) document.documentElement.requestFullscreen?.().catch(() => undefined);

    const res = await startQuizAttempt(roundId);
    if (res.error) {
      setError(res.error);
      setPhase("error");
      return;
    }
    sessionTokenRef.current = res.data!.session_token;
    setSessionToken(res.data!.session_token);
    setPhase("in_progress");
  }

  async function handleSelect(optionId: string) {
    if (!sessionToken || !state?.question) return;
    const previous = state.saved_option_id;
    setState((s) =>
      s
        ? {
            ...s,
            saved_option_id: optionId,
            answered_count: previous ? s.answered_count : (s.answered_count ?? 0) + 1,
          }
        : s,
    );
    const res = await saveQuizAnswerAction(roundId, sessionToken, state.question.id, optionId);
    if (res.error) {
      // Roll the optimistic selection back rather than leaving the team
      // believing an answer was recorded that wasn't.
      setState((s) => (s ? { ...s, saved_option_id: previous ?? null } : s));
      toast.error(res.error);
    }
  }

  async function handleAckWarning() {
    setWarningPending(false);
    const token = sessionTokenRef.current;
    if (token) await ackQuizWarningAction(roundId, token);
  }

  async function handleResume() {
    setError(null);
    setPhase("resuming");
  }

  // ---------------------------------------------------------------------
  // Screens
  // ---------------------------------------------------------------------

  if (phase === "preflight") {
    return (
      <div className="mx-auto max-w-xl space-y-6 px-6 py-16">
        <div className="space-y-1 text-center">
          <h1 className="font-display text-2xl">{roundTitle ?? "Quiz"}</h1>
          <p className="text-sm text-ink-3">Read this before you begin.</p>
        </div>

        {instructions && (
          <p className="whitespace-pre-wrap rounded-xl border border-border bg-card p-4 text-sm leading-relaxed text-ink-2">
            {instructions}
          </p>
        )}

        <ul className="space-y-2.5 rounded-xl border border-border bg-card p-4 text-sm leading-relaxed text-ink-2">
          <li>One continuous, timed attempt. Each question has its own timer.</li>
          <li>Questions advance automatically. You cannot go back to a previous question.</li>
          <li>Your answer is saved the moment you select it — there is nothing else to press.</li>
          {lenient ? (
            <>
              <li className="text-foreground">
                <strong className="font-semibold">Refreshing or closing this page is safe.</strong> You
                will return to the question you were on, with your answers intact.
              </li>
              <li className="text-foreground">
                <strong className="font-semibold">You do not need to be in fullscreen.</strong>{" "}
                Changing your brightness, opening the notification shade, or taking a call will not
                affect your attempt.
              </li>
              <li className="text-foreground">
                <strong className="font-semibold">
                  Do not switch tabs, minimise the window, or navigate away.
                </strong>{" "}
                The first time you do, you will get a warning.{" "}
                {strikeLimit <= 2
                  ? "The second time, your attempt ends and your answers are submitted as they are."
                  : `After ${strikeLimit} times, your attempt ends and your answers are submitted as they are.`}
              </li>
              <li>You can press &ldquo;Finish &amp; submit&rdquo; at any point to end early.</li>
            </>
          ) : (
            <li className="text-foreground">
              <strong className="font-semibold">
                Leaving fullscreen, switching tabs, or refreshing ends your attempt immediately.
              </strong>
            </li>
          )}
        </ul>

        {error && <p className="text-center text-sm text-unsold">{error}</p>}
        <div className="text-center">
          <Button onClick={handleStart}>I&apos;m ready — start</Button>
        </div>
      </div>
    );
  }

  if (phase === "starting") {
    return <p className="px-6 py-16 text-center text-sm text-ink-2">Starting…</p>;
  }

  if (phase === "resuming") {
    return (
      <p className="px-6 py-16 text-center text-sm text-ink-2">
        Reconnecting you to your attempt…
      </p>
    );
  }

  if (phase === "session_replaced") {
    return (
      <div className="mx-auto max-w-md space-y-4 px-6 py-16 text-center">
        <h1 className="font-display text-2xl">Opened somewhere else</h1>
        <p className="text-sm leading-relaxed text-ink-2">
          This attempt is open in another tab or on another device. Only one can be active at a
          time — your answers are safe either way.
        </p>
        {lenient ? (
          <Button onClick={handleResume}>Continue on this device</Button>
        ) : (
          <BackLink href="/app" label="Back to dashboard" />
        )}
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="mx-auto max-w-md space-y-4 px-6 py-16 text-center">
        <p className="text-sm text-unsold">{error}</p>
        <BackLink href="/app" label="Back to dashboard" />
      </div>
    );
  }

  if (phase === "submitted") {
    const reasonLine = (() => {
      switch (receipt?.submit_reason) {
        case "manual":
          return "You submitted your attempt.";
        case "completed":
        case "timeout":
          return "Time ran out and your attempt was submitted automatically.";
        case "visibility_hidden":
        case "navigation":
        case "page_hidden":
        case "fullscreen_exit":
          return "Your attempt ended because you left the quiz.";
        case "admin":
          return "An organiser ended this attempt.";
        default:
          return "Your attempt has been recorded.";
      }
    })();
    const answered = receipt?.answered_count;
    const total = receipt?.question_count ?? receipt?.total;

    return (
      <div className="mx-auto max-w-md space-y-4 px-6 py-16 text-center">
        <h1 className="font-display text-2xl">Submitted</h1>
        <p className="text-sm text-ink-2">{reasonLine}</p>
        <dl className="space-y-2 rounded-xl border border-border bg-card p-4 text-left text-sm">
          {receipt?.submitted_at && (
            <div className="flex justify-between gap-4">
              <dt className="text-ink-3">Submitted at</dt>
              <dd className="font-mono tabular-nums">{formatTimestamp(receipt.submitted_at)}</dd>
            </div>
          )}
          {answered != null && total != null && (
            <div className="flex justify-between gap-4">
              <dt className="text-ink-3">Questions answered</dt>
              <dd className="font-mono tabular-nums">
                {answered} of {total}
              </dd>
            </div>
          )}
        </dl>
        <p className="text-xs text-ink-3">
          Your score will appear on your dashboard once it is released by the admin.
        </p>
        <div className="pt-2">
          <BackLink href="/app" label="Back to dashboard" />
        </div>
      </div>
    );
  }

  // in_progress
  if (!state?.question) {
    return (
      <>
        <ReconnectBanner status={connectionStatus} />
        <p className="px-6 py-16 text-center text-sm text-ink-2">Loading…</p>
      </>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 px-6 py-16">
      <ReconnectBanner status={connectionStatus} />

      {/* Persistent header: where you are, how long is left, how much you've
          answered, and a way out that isn't a surprise. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex items-baseline gap-3 text-xs text-ink-3">
          <span>
            Question {state.index} of {state.total}
          </span>
          {state.answered_count != null && <span>{state.answered_count} answered</span>}
        </div>
        <div className="flex items-center gap-3">
          {state.closes_at && (
            <Countdown
              target={state.closes_at}
              serverNowAtMount={state.server_now ?? new Date().toISOString()}
              className="text-sm text-gold"
            />
          )}
          <Button size="sm" variant="tile" onClick={() => setConfirmFinish(true)}>
            Finish &amp; submit
          </Button>
        </div>
      </div>

      <p className="font-heading text-lg font-semibold">{state.question.prompt}</p>
      <div className="space-y-2">
        {state.question.options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => handleSelect(opt.id)}
            className={`block w-full cursor-pointer rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
              state.saved_option_id === opt.id
                ? "border-gold bg-gold/10"
                : "border-border bg-card hover:border-gold/40"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {advancing && (
        <p className="text-center text-xs text-ink-3" role="status">
          Moving to the next question…
        </p>
      )}

      {confirmFinish && (
        <Overlay labelledBy="finish-title">
          <h2 id="finish-title" className="font-display text-xl">
            Finish and submit?
          </h2>
          <p className="text-sm leading-relaxed text-ink-2">
            You&apos;ve answered {state.answered_count ?? 0} of {state.total} questions. Questions you
            haven&apos;t answered will be marked as not attempted. This cannot be undone.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              onClick={() => {
                setConfirmFinish(false);
                void finalize("manual");
              }}
            >
              Yes, submit now
            </Button>
            <Button variant="tile" onClick={() => setConfirmFinish(false)}>
              Keep going
            </Button>
          </div>
        </Overlay>
      )}

      {/* Server-computed (get_quiz_state.warning_pending), so it survives a
          refresh — under the lenient policy a refresh is legal, and a
          client-only warning could simply be reloaded away. */}
      {lenient && warningPending && !confirmFinish && (
        <Overlay labelledBy="warning-title" tone="warning">
          <h2 id="warning-title" className="font-display text-xl">
            You left the quiz.
          </h2>
          <p className="text-sm leading-relaxed text-ink-2">
            Switching tabs, minimising the window, or navigating away is not allowed during this
            round.{" "}
            {(state.strike_limit ?? strikeLimit) - (state.strike_count ?? 1) <= 1 ? (
              <>
                This is your only warning — if it happens again, your attempt ends immediately and
                your answers are submitted as they are.
              </>
            ) : (
              <>
                You have{" "}
                {(state.strike_limit ?? strikeLimit) - (state.strike_count ?? 1)} more before your
                attempt ends and your answers are submitted as they are.
              </>
            )}
          </p>
          <p className="text-xs text-ink-3">
            The question timer has kept running while this message was on screen.
          </p>
          <div className="pt-1">
            <Button onClick={handleAckWarning}>I understand — continue</Button>
          </div>
        </Overlay>
      )}
    </div>
  );
}

/**
 * A plain fixed overlay rather than a Base UI Dialog: both of these are
 * deliberately non-dismissible (no Esc, no outside-press), which is most of
 * what Dialog would be providing, and it sidesteps the nested-popup
 * onOpenChange caveat documented in CLAUDE.md.
 */
function Overlay({
  children,
  labelledBy,
  tone = "default",
}: {
  children: React.ReactNode;
  labelledBy: string;
  tone?: "default" | "warning";
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 px-6 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      <div
        className={`w-full max-w-md space-y-3 rounded-xl border bg-card p-6 ${
          tone === "warning" ? "border-gold/50" : "border-border"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

// Explicit locale/options for consistent display regardless of the client's
// locale config — same convention as src/app/app/page.tsx.
function formatTimestamp(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    hour12: false,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
