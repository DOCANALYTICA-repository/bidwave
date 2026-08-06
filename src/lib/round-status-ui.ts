import type { StatusKey } from "@/components/bidwave";

/**
 * Maps a round's effective_round_status() + the team's own submission/score
 * state onto the exact §8.1 status vocabulary already encoded in
 * StatusPill's STATUS_TONES — no new tone words needed for the classroom
 * dashboard.
 */
export function classroomStatus({
  roundStatus,
  submissionStatus,
  canSubmit,
  scorePublished,
}: {
  roundStatus: string;
  submissionStatus?: "not_submitted" | "submitted" | null;
  canSubmit: boolean;
  scorePublished?: boolean;
}): StatusKey {
  if (roundStatus === "draft" || roundStatus === "scheduled") return "upcoming";

  if (roundStatus === "open") {
    if (submissionStatus === "submitted") return "submitted";
    return canSubmit ? "open-eligible" : "open-view-only";
  }

  // closed, scoring, scored, publicly_released, archived: the team never
  // sees "Scoring" as a separate word (§8.1 has none) — only whether their
  // score has been released.
  if (scorePublished) return "scored";
  return "closed";
}
