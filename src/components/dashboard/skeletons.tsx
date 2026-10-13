import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export type SkeletonKind = "stat" | "short" | "card" | "tall";

/** Placeholder of a dashboard card while its data streams in (SPEC §8: skeletons, no spinners). */
export function WidgetSkeleton({ kind }: { kind: SkeletonKind }) {
  if (kind === "stat") {
    return (
      <Card className="h-full" data-skeleton>
        <Skeleton className="h-8 w-16" />
        <Skeleton className="mt-2.5 h-3.5 w-24" />
        <Skeleton className="mt-2 h-3 w-20" />
      </Card>
    );
  }
  const lines = kind === "short" ? 1 : kind === "tall" ? 5 : 3;
  return (
    <Card data-skeleton>
      <Skeleton className="mb-5 h-4 w-40" />
      <div className="space-y-3">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className={i % 2 ? "h-10 w-4/5" : "h-10 w-full"} />
        ))}
      </div>
    </Card>
  );
}
