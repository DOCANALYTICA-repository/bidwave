"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/require-role";

export type QuizActionState = { status: "idle" | "error" | "success"; formError?: string };

export async function adminSaveQuizQuestion(
  _prev: QuizActionState,
  formData: FormData,
): Promise<QuizActionState> {
  await requireAdmin();

  const roundId = String(formData.get("roundId"));
  const questionId = (formData.get("questionId") as string) || null;
  const position = Number(formData.get("position") ?? 0);
  const prompt = String(formData.get("prompt") ?? "");
  const timerSeconds = Number(formData.get("timerSeconds") ?? 60);
  const weight = Number(formData.get("weight") ?? 1);
  const isActive = formData.get("isActive") === "on";

  let options: unknown;
  try {
    options = JSON.parse(String(formData.get("options") ?? "[]"));
  } catch {
    return { status: "error", formError: "Invalid options." };
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_upsert_quiz_question", {
    p_question_id: questionId,
    p_round_id: roundId,
    p_position: position,
    p_prompt: prompt,
    p_timer_seconds: timerSeconds,
    p_weight: weight,
    p_is_active: isActive,
    p_options: options as never,
  });

  if (error) return { status: "error", formError: error.message };
  revalidatePath(`/admin/rounds/${roundId}`);
  return { status: "success" };
}

export async function adminDeleteQuizQuestion(questionId: string, roundId: string): Promise<void> {
  await requireAdmin();
  const admin = createAdminClient();
  await admin.rpc("admin_delete_quiz_question", { p_question_id: questionId });
  revalidatePath(`/admin/rounds/${roundId}`);
}

export async function validateQuizBankAction(roundId: string) {
  await requireAdmin();
  const admin = createAdminClient();
  const { data } = await admin.rpc("validate_quiz_bank", { p_round_id: roundId });
  return (data ?? []) as { question_id?: string; position?: number; problem: string }[];
}

export async function adminResetQuizAttemptAction(attemptId: string, roundId: string, reason: string): Promise<void> {
  await requireAdmin();
  const admin = createAdminClient();
  await admin.rpc("admin_reset_quiz_attempt", { p_attempt_id: attemptId, p_reason: reason });
  revalidatePath(`/admin/rounds/${roundId}`);
}
