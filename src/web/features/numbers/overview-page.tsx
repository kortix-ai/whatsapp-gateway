import { KeyRound, LogOut, MessagesSquare, QrCode, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CopyButton } from '@/components/copy-button';
import { DescriptionList, DescriptionRow } from '@/components/description-list';
import { StatusDot } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { formatDateTime, formatPhone, formatRelativeTime } from '@/lib/format';
import { statusMeta } from '@/lib/status';
import { useAccountStatus, useLogoutSession } from './api';
import { useNumberContext } from './number-context';

export function OverviewPage() {
  const { account } = useNumberContext();
  const { data: status } = useAccountStatus(account.id);
  const logout = useLogoutSession(account.id);

  const live = status?.status ?? account.status;
  const meta = statusMeta(live);
  const connected = live === 'connected';
  const phone = status?.phone_number ?? account.phoneNumber;
  const jid = status?.whatsapp_jid ?? account.whatsappJid;
  const lastError = status?.last_error ?? account.lastError;

  function handleLogout() {
    logout.mutate(undefined, {
      onSuccess: () => toast.success('Session ended', { description: 'The linked device was logged out.' }),
      onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not end the session.'),
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardContent className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <StatusDot status={live} className="mt-1.5" />
                <div>
                  <p className="text-base font-medium">{meta.label}</p>
                  <p className="text-sm text-muted-foreground">{meta.description}</p>
                </div>
              </div>
              {connected ? (
                <ConfirmDialog
                  trigger={
                    <Button variant="outline" size="sm">
                      <LogOut /> End session
                    </Button>
                  }
                  title="End this WhatsApp session?"
                  description="This logs out the linked device. Reconnecting requires scanning a new QR code or requesting a new pairing code."
                  confirmLabel="End session"
                  destructive
                  loading={logout.isPending}
                  onConfirm={handleLogout}
                />
              ) : (
                <Button size="sm" asChild>
                  <Link to="../pairing" relative="path">
                    <QrCode /> Pair number
                  </Link>
                </Button>
              )}
            </div>

            {lastError && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <span className="break-words">{lastError}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <DescriptionList>
          <DescriptionRow label="Connection ID">
            <span className="inline-flex items-center gap-1.5">
              <code className="font-mono text-xs">{account.id}</code>
              <CopyButton value={account.id} variant="ghost" />
            </span>
          </DescriptionRow>
          <DescriptionRow label="Phone">{phone ? formatPhone(phone) : <span className="text-muted-foreground">—</span>}</DescriptionRow>
          <DescriptionRow label="WhatsApp JID">
            {jid ? <code className="font-mono text-xs break-all">{jid}</code> : <span className="text-muted-foreground">—</span>}
          </DescriptionRow>
          <DescriptionRow label="Last connected">
            {account.lastConnectedAt ? (
              <span title={formatDateTime(account.lastConnectedAt)}>{formatRelativeTime(account.lastConnectedAt)}</span>
            ) : (
              <span className="text-muted-foreground">Never</span>
            )}
          </DescriptionRow>
          <DescriptionRow label="Created">{formatDateTime(account.createdAt)}</DescriptionRow>
        </DescriptionList>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-muted-foreground">Quick actions</p>
        <QuickLink to="../pairing" icon={<QrCode className="size-4" />} title="Pairing" description="Link or relink the device" />
        <QuickLink to={`/app/api-keys?connection=${account.id}`} icon={<KeyRound className="size-4" />} title="Create API key" description="Scope a key to this connection" />
        <QuickLink to="../messages" icon={<MessagesSquare className="size-4" />} title="Messages" description="Browse synchronized messages" />
      </div>
    </div>
  );
}

function QuickLink({
  to,
  icon,
  title,
  description,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  const relative = to.startsWith('/') ? undefined : 'path';
  return (
    <Button
      variant="outline"
      asChild
      className="h-auto w-full justify-start gap-3 px-3 py-3 text-left font-normal"
    >
      <Link to={to} relative={relative}>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {icon}
        </span>
        <span className="flex flex-col">
          <span className="text-sm font-medium">{title}</span>
          <span className="text-xs text-muted-foreground">{description}</span>
        </span>
      </Link>
    </Button>
  );
}
