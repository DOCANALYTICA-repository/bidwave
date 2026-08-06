"use client";

/**
 * QZ-13 same-tab nav guard. A single pending "finish the quiz attempt
 * before you leave" callback, set by QuizRunner while phase === "in_progress"
 * and consumed by whatever same-tab action would navigate away (currently
 * just the /app header's Sign out button).
 *
 * An unmount-cleanup approach (finalize the attempt *after* React tears
 * down the quiz page) does not work for this specific case: signOut()'s
 * Server Action clears the Supabase auth session server-side and only
 * *then* redirects, so by the time the client unmounts and a cleanup
 * effect could call submit_quiz_attempt, the session is already gone and
 * the call fails auth. Running this guard first, before sign-out proceeds,
 * submits the attempt while the session is still valid.
 */
let pendingExit: (() => Promise<void>) | null = null;

export function setQuizExitGuard(fn: (() => Promise<void>) | null) {
  pendingExit = fn;
}

export async function runQuizExitGuard() {
  const fn = pendingExit;
  pendingExit = null;
  if (fn) await fn();
}
