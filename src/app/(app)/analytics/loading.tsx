import { Skeleton } from "@/components/ui/skeleton";
import { SectionSkeleton } from "@/components/analytics/skeleton";

export default function Loading() {
  return (
    <div>
      <Skeleton className="mb-2 h-8 w-48" />
      <Skeleton className="mb-5 h-4 w-80 max-w-full" />
      <Skeleton className="mb-4 h-12 w-full sm:w-96" />
      <Skeleton className="mb-4 h-16 w-full" />
      <SectionSkeleton />
    </div>
  );
}
