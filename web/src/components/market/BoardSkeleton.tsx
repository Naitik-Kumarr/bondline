import { Card } from "@/components/ui/Card";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

function AgentCardSkeleton() {
  return (
    <Card padding="none" className="overflow-hidden">
      <div className="p-5 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <Skeleton className="size-12" rounded="md" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-12" rounded="sm" />
              <Skeleton className="h-7 w-32" rounded="sm" />
            </div>
          </div>
          <Skeleton className="size-16" rounded="full" />
        </div>
        <Skeleton className="mt-4 h-7 w-44" rounded="full" />
        <SkeletonText lines={2} className="mt-5" />
        <Skeleton className="mt-7 h-14 w-full" rounded="md" />
        <div className="mt-7 flex gap-2">
          <Skeleton className="h-7 w-52" rounded="full" />
          <Skeleton className="h-7 w-32" rounded="full" />
        </div>
      </div>
      <div className="border-t border-line bg-page/70 p-3 sm:p-4">
        <div className="rounded-card border border-line bg-surface p-4 sm:p-5">
          <div className="flex items-start justify-between">
            <Skeleton className="h-5 w-28" rounded="sm" />
            <Skeleton className="h-9 w-32" rounded="full" />
          </div>
          <div className="mt-5 grid grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-2">
                <Skeleton className="h-3 w-14" rounded="sm" />
                <Skeleton className="h-5 w-16" rounded="sm" />
              </div>
            ))}
          </div>
          <Skeleton className="mt-6 h-2 w-full" rounded="full" />
        </div>
      </div>
    </Card>
  );
}

/** Stands in for the board while the chain is read: same blocks, same sizes, so nothing shifts. */
export function BoardSkeleton() {
  return (
    <div className="flex flex-col gap-16 sm:gap-24" aria-busy="true" aria-label="Reading the market from the chain">
      <Card padding="none" className="overflow-hidden">
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="border-b border-r border-line p-5 sm:p-6">
              <Skeleton className="h-3.5 w-24" rounded="sm" />
              <Skeleton className="mt-2.5 h-[30px] w-28" />
              <Skeleton className="mt-3 h-3 w-20" rounded="sm" />
            </div>
          ))}
        </div>
        <div className="px-5 py-4 sm:px-6">
          <Skeleton className="h-3.5 w-80 max-w-full" rounded="sm" />
        </div>
      </Card>
      {[0, 1].map((m) => (
        <div key={m}>
          <Skeleton className="h-10 w-64" rounded="md" />
          <Skeleton className="mt-4 h-4 w-[32rem] max-w-full" rounded="sm" />
          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            <AgentCardSkeleton />
            <AgentCardSkeleton />
          </div>
        </div>
      ))}
    </div>
  );
}
