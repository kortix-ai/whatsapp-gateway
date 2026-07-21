import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function DescriptionList({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn('grid gap-px overflow-hidden rounded-lg border bg-border', className)}>{children}</dl>;
}

export function DescriptionRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 bg-card px-4 py-3 sm:grid-cols-[minmax(0,10rem)_1fr] sm:items-baseline sm:gap-4">
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase sm:text-sm sm:normal-case sm:tracking-normal">
        {label}
      </dt>
      <dd className="min-w-0 text-sm text-foreground">{children}</dd>
    </div>
  );
}
