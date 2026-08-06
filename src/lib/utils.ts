import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Selecting an option in a Select/DropdownMenu nested inside a Dialog or
 * Sheet spuriously dismisses the Dialog/Sheet too — verified via direct
 * reproduction, not a guess. The mechanism: picking the option unmounts
 * the popup's DOM synchronously as part of that same click, so by the
 * time the outer Dialog's outside-press handler resolves its target, the
 * originally-clicked element (and all its popup ancestry — `data-open`,
 * `role="listbox"`, etc.) is already gone. The event's `target` resolves
 * to `document.documentElement` (`<html>`) instead.
 *
 * A real, intentional backdrop click can't produce that target in this
 * app: every Dialog/Sheet renders a full-viewport overlay div that would
 * catch a genuine outside click first. A target of `<html>` itself is
 * therefore always this race, never a real dismissal request.
 *
 * Use in a Dialog/Sheet's `onOpenChange` to cancel the false dismissal:
 *
 *   onOpenChange={(open, eventDetails) => {
 *     if (!open && eventDetails.reason === "outside-press" &&
 *         isPopupCloseArtifact(eventDetails.event.target)) {
 *       eventDetails.cancel()
 *       return
 *     }
 *     ...
 *   }}
 */
export function isPopupCloseArtifact(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target === document.documentElement || target === document.body) return true
  return target.closest('[data-open], [role="listbox"], [role="menu"]') !== null
}
