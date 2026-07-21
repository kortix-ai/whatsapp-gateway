import { cn } from '@/lib/utils';
import { statusMeta, type StatusTone } from '@/lib/status';
import type { ConnectionStatus } from '@/lib/types';

const toneClasses: Record<StatusTone, { dot: string; text: string; ring: string }> = {
  success: { dot: 'bg-success', text: 'text-success', ring: 'bg-success/60' },
  warning: { dot: 'bg-warning', text: 'text-warning-foreground dark:text-warning', ring: 'bg-warning/60' },
  destructive: { dot: 'bg-destructive', text: 'text-destructive', ring: 'bg-destructive/60' },
  muted: { dot: 'bg-muted-foreground/50', text: 'text-muted-foreground', ring: 'bg-muted-foreground/40' },
};

export function StatusDot({ status, className }: { status: ConnectionStatus | null | undefined; className?: string }) {
  const meta = statusMeta(status);
  const tone = toneClasses[meta.tone];
  const animated = meta.tone === 'warning';
  return (
    <span className={cn('relative flex size-2 shrink-0', className)} aria-hidden>
      {animated && <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-75', tone.ring)} />}
      <span className={cn('relative inline-flex size-2 rounded-full', tone.dot)} />
    </span>
  );
}

export function StatusBadge({
  status,
  className,
  showDot = true,
}: {
  status: ConnectionStatus | null | undefined;
  className?: string;
  showDot?: boolean;
}) {
  const meta = statusMeta(status);
  const tone = toneClasses[meta.tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card px-2.5 py-0.5 text-xs font-medium',
        tone.text,
        className,
      )}
    >
      {showDot && <StatusDot status={status} />}
      {meta.label}
    </span>
  );
}
