"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { BrandMark, BackLink } from "@/components/bidwave";
import { login, type LoginActionState } from "@/app/login/actions";

// A "use server" file can only export async functions — the initial state
// literal has to live on the client side instead of alongside the action.
const loginInitialState: LoginActionState = { status: "idle" };

export function LoginForm() {
  const [state, formAction, isPending] = useActionState(login, loginInitialState);

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-8 px-6 py-24">
      <div className="flex w-full items-center justify-between">
        <BackLink href="/" label="Back to home" />
        <Link href="/register" className="text-xs text-ink-2 underline-offset-4 hover:text-gold hover:underline">
          New team? Register
        </Link>
      </div>
      <div className="flex flex-col items-center gap-4 text-center">
        <BrandMark name="bidwave" height={48} />
        <div>
          <h1 className="font-display text-2xl">Sign in</h1>
          <p className="text-sm text-ink-2">Team or admin — one shared account per team.</p>
        </div>
      </div>

      <form action={formAction} className="w-full space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="username" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>

        {state.status === "error" && state.formError && (
          <p className="rounded-lg border border-unsold/30 bg-unsold/10 px-3 py-2 text-sm text-unsold">
            {state.formError}
          </p>
        )}

        <Button type="submit" disabled={isPending} className="w-full">
          {isPending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="text-center text-xs text-ink-3">
        Password reset is handled by the event admin — no self-service reset is available.
      </p>
    </div>
  );
}
