import { KeyRound, ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CopyButton } from '@/components/copy-button';

/**
 * Blocking, one-time reveal of a secret (API key, webhook signing secret).
 * Built on AlertDialog so it cannot be dismissed by an outside click or escape —
 * the operator must explicitly acknowledge that they have stored the value,
 * because the server never returns it again.
 */
export function SecretDialog({
  open,
  onAcknowledge,
  title,
  description,
  secret,
  meta,
}: {
  open: boolean;
  onAcknowledge: () => void;
  title: string;
  description: ReactNode;
  secret: string;
  meta?: ReactNode;
}) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <div className="mb-1 flex size-10 items-center justify-center rounded-lg bg-success/12 text-success">
            <KeyRound className="size-5" />
          </div>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3">
          <div className="flex items-stretch gap-2">
            <code className="flex-1 overflow-x-auto rounded-md border bg-muted px-3 py-2.5 font-mono text-sm break-all">
              {secret}
            </code>
            <CopyButton value={secret} variant="default" className="self-stretch" />
          </div>
          {meta}
          <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground dark:text-warning">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <span>This value is shown only once. Store it in a secret manager now — it cannot be retrieved later.</span>
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogAction onClick={onAcknowledge}>I have stored it securely</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
