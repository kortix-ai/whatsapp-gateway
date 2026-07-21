import { AlertCircle, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * The loading / error / empty / populated branching every list page shares.
 * The four conditionals are deliberately parallel (not an if/else chain): a
 * failed background refetch has both isError and data set, and renders the
 * error banner above the stale list, matching react-query v5 semantics.
 * Children own the list container so grids, fragments, and pagers all fit.
 */
export function QueryListState<T>({ query, skeletonRows = 5, empty, children }: {
  query: {
    data: T[] | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    refetch: () => unknown;
  };
  skeletonRows?: number;
  empty: { icon: ReactNode; title: ReactNode; description: ReactNode; action?: ReactNode };
  children: (items: T[]) => ReactNode;
}) {
  return (
    <>
      {query.isLoading && <ListSkeleton rows={skeletonRows} />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {query.data && query.data.length === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">{empty.icon}</EmptyMedia>
            <EmptyTitle>{empty.title}</EmptyTitle>
            <EmptyDescription>{empty.description}</EmptyDescription>
          </EmptyHeader>
          {empty.action && <EmptyContent>{empty.action}</EmptyContent>}
        </Empty>
      )}
      {query.data && query.data.length > 0 && children(query.data)}
    </>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const message = error instanceof ApiError || error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <Alert variant="destructive" className={className}>
      <AlertCircle />
      <AlertTitle>Could not load this data</AlertTitle>
      <AlertDescription>
        {message}
        {onRetry && (
          <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
            <RefreshCw /> Retry
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function ListSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  );
}

export function TableRowsSkeleton({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b">
          {Array.from({ length: cols }).map((__, c) => (
            <td key={c} className="p-3">
              <Skeleton className="h-4 w-full max-w-[12rem]" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function InlineHint({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-xs text-muted-foreground', className)}>{children}</p>;
}
