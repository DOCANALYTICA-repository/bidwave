import type { Metadata } from "next";
import { ScheduleSection } from "@/components/marketing/schedule-section";

export const metadata: Metadata = { title: "Schedule" };

export default function SchedulePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8 px-6 py-16">
      <div className="text-center">
        <h1 className="font-display text-4xl">Schedule</h1>
        <p className="mt-2 text-ink-2">17–19 August 2026 · CHRIST University</p>
      </div>
      <ScheduleSection />
    </div>
  );
}
