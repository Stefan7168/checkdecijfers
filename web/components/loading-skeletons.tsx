// Placeholder-only content for the three "something is loading" spots
// (chat answer, chart panel, thread switch) — never real data, so every
// root is aria-hidden: a screen reader should hear nothing new until real
// content lands, not a pulsing block with no information.
import { Skeleton } from './ui/skeleton.tsx';

export function AnswerSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      <Skeleton className="h-3.5 w-3/4" />
      <Skeleton className="h-3.5 w-full" />
      <Skeleton className="h-3.5 w-2/3" />
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="flex h-full flex-col gap-3" aria-hidden="true">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-full min-h-40 w-full" />
    </div>
  );
}
