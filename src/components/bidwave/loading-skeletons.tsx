import { Skeleton } from "@/components/ui/skeleton";

/**
 * No route had a loading.tsx anywhere in the app, so every navigation sat
 * on a blank screen until the full RSC payload (including every
 * Promise.all query) resolved. These give each route shape a fallback
 * that resembles what's about to render, instead of a generic spinner.
 */
export function ListPageSkeleton({ withSearch = false }: { withSearch?: boolean }) {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-6 py-10">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
      {withSearch && <Skeleton className="h-10 w-full" />}
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}

export function CardGridSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-6 py-10">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: cards }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    </div>
  );
}
