import { ChevronRight, Plus, Smartphone } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/page-header';
import { QueryListState } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { formatPhone, formatRelativeTime, friendlyJid } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAccounts } from './api';

export function NumbersListPage() {
  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Numbers"
        description="Each connection is one linked WhatsApp account operated through the gateway."
        actions={
          accounts && accounts.length > 0 ? (
            <Button asChild>
              <Link to="/app/numbers/new">
                <Plus /> New connection
              </Link>
            </Button>
          ) : null
        }
      />

      <QueryListState
        query={accountsQuery}
        skeletonRows={4}
        empty={{
          icon: <Smartphone />,
          title: 'No connections yet',
          description: 'Create a connection, then pair it from your phone through WhatsApp → Linked Devices.',
          action: (
            <Button asChild>
              <Link to="/app/numbers/new">
                <Plus /> Create your first connection
              </Link>
            </Button>
          ),
        }}
      >
        {(items) => (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((account) => {
            const subtitle = account.phoneNumber
              ? formatPhone(account.phoneNumber)
              : account.whatsappJid
                ? friendlyJid(account.whatsappJid)
                : 'Not paired yet';
            return (
              <li key={account.id}>
                <Link
                  to={`/app/numbers/${account.id}/overview`}
                  className={cn(
                    'group flex items-center gap-4 rounded-xl border bg-card p-4 transition-all',
                    'hover:border-foreground/20 hover:shadow-sm',
                    'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  )}
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
                    <Smartphone className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{account.displayName}</p>
                      <StatusBadge status={account.status} showDot={false} className="shrink-0" />
                    </div>
                    <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground/80">
                      {account.lastConnectedAt
                        ? `Last connected ${formatRelativeTime(account.lastConnectedAt)}`
                        : `Created ${formatRelativeTime(account.createdAt)}`}
                    </p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            );
          })}
        </ul>
        )}
      </QueryListState>
    </div>
  );
}
