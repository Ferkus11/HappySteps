import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div aria-busy>
      <Skeleton className="mb-2 h-8 w-48" />
      <Skeleton className="mb-5 h-4 w-64" />
      <div className="mb-3 flex gap-2">
        <Skeleton className="h-11 w-28 rounded-full" />
        <Skeleton className="h-11 w-28 rounded-full" />
      </div>
      <Skeleton className="mb-4 h-36 rounded-card" />
      <div className="space-y-2.5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-[82px] rounded-card" />
        ))}
      </div>
    </div>
  );
}
