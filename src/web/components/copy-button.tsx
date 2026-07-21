import { Check, Copy } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type CopyButtonProps = {
  value: string;
  label?: string;
  className?: string;
  size?: ComponentProps<typeof Button>['size'];
  variant?: ComponentProps<typeof Button>['variant'];
};

export function CopyButton({ value, label, className, size = 'sm', variant = 'outline' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const area = document.createElement('textarea');
      area.value = value;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }, [value]);

  return (
    <Button type="button" variant={variant} size={label ? size : 'icon-sm'} className={className} onClick={copy}>
      {copied ? <Check className="text-success" /> : <Copy />}
      {label ? (copied ? 'Copied' : label) : <span className="sr-only">Copy</span>}
    </Button>
  );
}

/** Inline monospace value with a copy affordance, for IDs and tokens. */
export function CopyableValue({ value, className }: { value: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{value}</code>
      <CopyButton value={value} variant="ghost" />
    </span>
  );
}
