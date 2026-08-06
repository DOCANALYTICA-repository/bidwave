"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth-actions";
import { runQuizExitGuard } from "@/lib/quiz-exit-guard";

/**
 * QZ-13: a plain `<form action={signOut}>` would invalidate the session
 * before a same-tab quiz-exit guard could ever run. Calling signOut()
 * directly (Server Actions are callable as plain functions from client
 * event handlers) lets us await the guard first, while the session is
 * still valid.
 */
export function SignOutButton() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          await runQuizExitGuard();
          await signOut();
        });
      }}
    >
      Sign out
    </Button>
  );
}
