import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col gap-3 bg-bg p-4 md:static md:h-full md:rounded-card md:border md:border-border/70 md:bg-surface">
      <Skeleton className="h-12 w-2/3" />
      <Skeleton className="ml-auto h-14 w-1/2" />
      <Skeleton className="h-14 w-3/5" />
      <Skeleton className="ml-auto h-10 w-1/3" />
    </div>
  );
}
