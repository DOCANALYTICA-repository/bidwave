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
};

const POLL_MS = 2500;

/**
 * QZ-10..16: pre-flight confirmation -> locked fullscreen -> one question
 * per screen on a lockstep server schedule -> exit detection auto-submits
 * once. See docs/QUIZ_LIMITATIONS.md for what a browser genuinely cannot
 * lock down.
 */
export function QuizRunner({ roundId, alreadySubmitted }: { roundId: string; alreadySubmitted: boolean }) {
  const [phase, setPhase] = useState<"preflight" | "starting" | "in_progress" | "submitted" | "error">(
    alreadySubmitted ? "submitted" : "preflight",
  );
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [state, setState] = useState<QuizQuestionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ raw_score?: number; max_score?: number; percent?: number } | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("online");
  const sessionTokenRef = useRef<string | null>(null);
  const submittingRef = useRef(false);
  const pollFailuresRef = useRef(0);

  const finalize = useCallback(
    async (reason: string) => {
      if (submittingRef.current || phase === "submitted") return;
      submittingRef.current = true;
      const token = sessionTokenRef.current;
      if (!token) return;
      const res = await submitQuizAttemptAction(roundId, reason, token);
      if (res.data) {
        const d = res.data as { raw_score: number; max_score: number; percent: number };
        setResult(d);
        setPhase("submitted");
        toast.success("Quiz submitted.");
      }
      submittingRef.current = false;
    },
    [roundId, phase],
  );

  // Exit detection — QZ-13/ERR-05. fullscreenchange/visibilitychange still
  // have JS time to make a normal call; pagehide may not, so it uses
  // sendBeacon against the Route Handler instead (a Server Action can't be
  // invoked from sendBeacon).
  useEffect(() => {
    if (phase !== "in_progress") return;

    function onFullscreenChange() {
      if (!document.fullscreenElement) void finalize("fullscreen_exit");
    }
    function onVisibilityChange() {
      if (document.hidden) void finalize("visibility_hidden");
    }
    function onPageHide() {
      const token = sessionTokenRef.current;
      if (!token) return;
      const blob = new Blob(
        [JSON.stringify({ roundId, reason: "page_hidden", sessionToken: token })],
        { type: "application/json" },
      );
      navigator.sendBeacon("/api/quiz/submit", blob);
    }
    // A native browser back/forward press fires neither of the three
    // listeners above (Next.js serves it as a client-side route swap, not a
    // document unload) — the same "same-tab navigation" gap
    // quiz-exit-guard.ts closes for the Sign-out button, just triggered by
    // the browser chrome instead of an in-app click. Reuses the 'navigation'
    // reason (not a new one) — submit_quiz_attempt()'s reason allow-list
    // (supabase/migrations/20260730050000_quiz_engine.sql) already covers
    // this exact "same-tab client nav" category; a distinct reason string
    // here would just need its own migration for no behavioral benefit.
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
      void finalize("navigation");
    }

    const nav = (window as unknown as { navigation?: EventTarget }).navigation;
    function onNavigate(e: Event) {
      if ((e as unknown as { navigationType?: string }).navigationType === "traverse") {
        onBackForward();
      }
    }

    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    if (nav) {
      nav.addEventListener("navigate", onNavigate);
    } else {
      window.addEventListener("popstate", onBackForward);
    }
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      if (nav) {
        nav.removeEventListener("navigate", onNavigate);
      } else {
        window.removeEventListener("popstate", onBackForward);
      }
    };
  }, [phase, finalize, roundId]);

  // Same-tab client-side navigation (e.g. clicking "Sign out" in the shared
  // /app header) doesn't fire fullscreenchange/visibilitychange/pagehide —
  // Next.js can serve it as a client transition with no document unload.
  // An unmount-cleanup approach doesn't work here: signOut()'s Server
  // Action clears the auth session server-side *before* the redirect, so
  // a submit fired after unmount fails auth. Instead, register a guard
  // while in_progress that whatever triggers the navigation (currently
  // just the Sign out button) awaits *before* proceeding, while the
  // session is still valid. See src/lib/quiz-exit-guard.ts.
  useEffect(() => {
    if (phase !== "in_progress") return;
    setQuizExitGuard(() => finalize("navigation"));
    return () => setQuizExitGuard(null);
  }, [phase, finalize]);

  // Polling doubles as the ~3s heartbeat (get_quiz_state stamps
  // session_seen_at on every call) and as how the lockstep schedule's
  // auto-advance actually reaches the UI — there is no push channel.
  useEffect(() => {
    if (phase !== "in_progress" || !sessionToken) return;
    let cancelled = false;

    async function poll() {
      // The lockstep schedule has no push channel — polling is both the
      // heartbeat and how a connection drop becomes visible. A thrown
      // exception (network down) is treated the same as a returned RPC
      // error: both count toward the reconnecting/offline banner, but
      // never stop the interval — the next tick is always allowed to
      // recover on its own (ERR-08, NFR-05).
      try {
        const res = await getQuizStateAction(roundId, sessionToken!);
        if (cancelled) return;
        if (res.error) {
          setError(res.error);
          return;
        }
        pollFailuresRef.current = 0;
        setConnectionStatus("online");
        const data = res.data as QuizQuestionState;
        setState(data);
        if (data.status === "submitted") {
          setResult(data as never);
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

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [phase, sessionToken, roundId, finalize]);

  async function handleStart() {
    setPhase("starting");
    setError(null);
    // NFR-01/QZ-11: fire-and-forget. Some browser/OS/automation contexts
    // never resolve or reject this promise at all (no user-gesture dialog
    // to answer), which would otherwise stall the entire start sequence
    // forever. Fullscreen is a "strongest practical" best-effort per
    // §10.3, never a hard block on starting the attempt.
    document.documentElement.requestFullscreen?.().catch(() => undefined);

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
    setState((s) => (s ? { ...s, saved_option_id: optionId } : s));
    await saveQuizAnswerAction(roundId, sessionToken, state.question.id, optionId);
  }

  if (phase === "preflight") {
    return (
      <div className="mx-auto max-w-lg space-y-4 px-6 py-16 text-center">
        <h1 className="font-display text-2xl">Round 1 — Quiz</h1>
        <p className="text-sm text-ink-2">
          One continuous, timed attempt. Each question has its own timer and advances
          automatically — there is no way to go back. Leaving fullscreen, switching tabs, or
          refreshing this page ends your attempt immediately. Make sure you are ready before
          starting.
        </p>
        {error && <p className="text-sm text-unsold">{error}</p>}
        <Button onClick={handleStart}>I&apos;m ready — start</Button>
      </div>
    );
  }

  if (phase === "starting") {
    return <p className="px-6 py-16 text-center text-sm text-ink-2">Starting…</p>;
  }

  if (phase === "error") {
    return <p className="px-6 py-16 text-center text-sm text-unsold">{error}</p>;
  }

  if (phase === "submitted") {
    return (
      <div className="mx-auto max-w-md space-y-3 px-6 py-16 text-center">
        <h1 className="font-display text-2xl">Submitted</h1>
        <p className="text-sm text-ink-2">Your attempt has been recorded.</p>
        {result?.max_score != null && (
          <p className="text-xs text-ink-3">
            Your score will appear on your dashboard once it is released by the admin.
          </p>
        )}
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
      <div className="flex items-center justify-between text-xs text-ink-3">
        <span>
          Question {state.index} of {state.total}
        </span>
        {state.closes_at && (
          <Countdown
            target={state.closes_at}
            serverNowAtMount={new Date().toISOString()}
            className="text-sm text-gold"
          />
        )}
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
    </div>
  );
}
