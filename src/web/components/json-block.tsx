import { CopyButton } from '@/components/copy-button';
import { cn } from '@/lib/utils';

export function JsonBlock({ value, className, maxHeight = 'max-h-96' }: { value: unknown; className?: string; maxHeight?: string }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <div className={cn('group relative overflow-hidden rounded-lg border bg-muted/40', className)}>
      <div className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100">
        <CopyButton value={text} variant="secondary" />
      </div>
      <pre className={cn('overflow-auto p-4 font-mono text-xs leading-relaxed text-foreground', maxHeight)}>{text}</pre>
    </div>
  );
}
