import { ArrowLeft } from 'lucide-react';
import { Link, NavLink, Outlet, useParams } from 'react-router-dom';
import { ErrorState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useWebhookEndpoint } from './api';

const TABS = [
  { to: 'overview', label: 'Overview' },
  { to: 'deliveries', label: 'Deliveries' },
];

export function WebhookLayout() {
  const { endpointId } = useParams<{ endpointId: string }>();
  const { data: endpoint, isLoading, isError, error, refetch } = useWebhookEndpoint(endpointId);

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
        <Link to="/app/webhooks">
          <ArrowLeft /> Webhooks
        </Link>
      </Button>

      {isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
      )}
      {isError && <ErrorState error={error} onRetry={() => refetch()} />}

      {endpoint && (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="max-w-full truncate text-xl font-semibold tracking-tight">
              {endpoint.description || endpoint.url}
            </h1>
            <Badge variant={endpoint.enabled ? 'success' : 'muted'}>{endpoint.enabled ? 'Enabled' : 'Disabled'}</Badge>
          </div>

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

          <Outlet context={{ endpoint }} />
        </>
      )}
    </div>
  );
}
