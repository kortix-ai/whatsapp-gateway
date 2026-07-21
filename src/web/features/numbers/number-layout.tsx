import { ArrowLeft } from 'lucide-react';
import { Link, NavLink, Outlet, useParams } from 'react-router-dom';
import { ErrorState } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatPhone, friendlyJid } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAccount, useAccountStatus } from './api';

const TABS = [
  { to: 'overview', label: 'Overview' },
  { to: 'pairing', label: 'Pairing' },
  { to: 'chats', label: 'Chats' },
  { to: 'contacts', label: 'Contacts' },
  { to: 'groups', label: 'Groups' },
  { to: 'messages', label: 'Messages' },
  { to: 'actions', label: 'Actions' },
];

export function NumberLayout() {
  const { accountId } = useParams<{ accountId: string }>();
  const { data: account, isLoading, isError, error, refetch } = useAccount(accountId);
  const { data: status } = useAccountStatus(accountId);

  const liveStatus = status?.status ?? account?.status;
  const subtitle = account?.phoneNumber
    ? formatPhone(account.phoneNumber)
    : account?.whatsappJid
      ? friendlyJid(account.whatsappJid)
      : 'Not paired yet';

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
          <Link to="/app/numbers">
            <ArrowLeft /> Numbers
          </Link>
        </Button>

        {isLoading && !account ? (
          <div className="space-y-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        ) : account ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-xl font-semibold tracking-tight">{account.displayName}</h1>
            <StatusBadge status={liveStatus} />
            <span className="font-mono text-xs text-muted-foreground">{subtitle}</span>
          </div>
        ) : (
          <ErrorState error={error ?? new Error('Connection not found')} onRetry={() => refetch()} />
        )}
      </div>

      {account && (
        <>
          <div className="no-scrollbar -mx-1 overflow-x-auto border-b">
            <nav className="flex min-w-max gap-1 px-1">
              {TABS.map((tab) => (
                <NavLink
                  key={tab.to}
                  to={tab.to}
                  className={({ isActive }) =>
                    cn(
                      'relative border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                      'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
                      isActive
                        ? 'border-foreground text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground',
                    )
                  }
                >
                  {tab.label}
                </NavLink>
              ))}
            </nav>
          </div>

          <Outlet context={{ account }} />
        </>
      )}

      {isError && account === undefined && !isLoading && (
        <ErrorState error={error ?? new Error('Connection not found')} onRetry={() => refetch()} />
      )}
    </div>
  );
}
