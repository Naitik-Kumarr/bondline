import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

/** One receipt's shape, while the chain is read. */
export function ReceiptsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Reading the receipts from the chain">
      {Array.from({ length: rows }, (_, i) => (
        <Card key={i} compact padding="none" className="p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Skeleton className="h-6 w-16" rounded="full" />
              <Skeleton className="h-5 w-36" rounded="sm" />
            </div>
            <Skeleton className="h-4 w-32" rounded="sm" />
          </div>
          <SkeletonText lines={2} className="mt-5 max-w-[34rem]" />
          <Skeleton className="mt-5 h-9 w-24" rounded="full" />
        </Card>
      ))}
    </div>
  );
}

/** The whole agent page while it loads: header, prices and a few blocks, at their real sizes. */
export function AgentSkeleton() {
  return (
    <div aria-busy="true" aria-label="Reading the agent's record">
      <Container className="pb-12 pt-10 sm:pb-16 sm:pt-14">
        <Skeleton className="h-4 w-32" rounded="sm" />
        <div className="mt-8 flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-5">
            <Skeleton className="size-16 sm:size-[84px]" rounded="lg" />
            <div className="flex flex-col gap-3">
              <Skeleton className="h-3 w-20" rounded="sm" />
              <Skeleton className="h-12 w-64 max-w-[60vw]" rounded="md" />
            </div>
          </div>
          <Skeleton className="size-[104px]" rounded="full" />
        </div>
        <Skeleton className="mt-7 h-7 w-56" rounded="full" />
        <SkeletonText lines={2} className="mt-6 max-w-[46rem]" />
      </Container>
      <Container className="py-10 sm:py-14">
        <Skeleton className="h-3 w-28" rounded="sm" />
        <Skeleton className="mt-4 h-10 w-[28rem] max-w-full" rounded="md" />
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <Skeleton className="h-56 w-full" rounded="lg" />
          <Skeleton className="h-56 w-full" rounded="lg" />
        </div>
      </Container>
      <Container className="py-10 sm:py-14">
        <Skeleton className="h-48 w-full" rounded="lg" />
      </Container>
    </div>
  );
}
