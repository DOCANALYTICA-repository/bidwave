import Link from "next/link";
import { ROUND_COPY_LIST } from "@/lib/rounds-catalog";
import { RoundCard } from "@/components/marketing/round-card";
import { Button } from "@/components/ui/button";

export function RoundsTeaser() {
  const preview = ROUND_COPY_LIST.slice(0, 3);
  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
      <div className="mb-8 flex items-center justify-between">
        <h2 className="font-display text-2xl">Six Rounds. One Champion.</h2>
        <Button variant="outline" render={<Link href="/rounds" />}>
          View all rounds
        </Button>
      </div>
      <div className="grid gap-6 sm:grid-cols-3">
        {preview.map((copy) => (
          <RoundCard key={copy.slug} copy={copy} />
        ))}
      </div>
    </section>
  );
}
