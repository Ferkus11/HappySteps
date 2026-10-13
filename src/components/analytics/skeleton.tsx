import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder of a section while its numbers are aggregated (KPI row + two chart cards). */
export function SectionSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" data-testid="analytics-skeleton">
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-72 w-full" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
      </div>
    </div>
  );
}
