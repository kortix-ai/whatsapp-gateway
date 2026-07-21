import { ChevronRight, Plus, Webhook } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/page-header';
import { QueryListState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useWebhookEndpoints } from './api';

export function WebhooksListPage() {
  const endpointsQuery = useWebhookEndpoints();
  const endpoints = endpointsQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Webhooks"
        description="Signed, retrying deliveries of normalized WhatsApp events to your endpoints."
        actions={
          endpoints && endpoints.length > 0 ? (
            <Button asChild>
              <Link to="/app/webhooks/new">
                <Plus /> New endpoint
              </Link>
            </Button>
          ) : null
        }
      />

      <QueryListState
        query={endpointsQuery}
        skeletonRows={3}
        empty={{
          icon: <Webhook />,
          title: 'No webhook endpoints',
          description: 'Point an endpoint at your receiver to stream events, signed with HMAC-SHA256.',
          action: (
            <Button asChild>
              <Link to="/app/webhooks/new">
                <Plus /> Create an endpoint
              </Link>
            </Button>
          ),
        }}
      >
        {(items) => (
        <ul className="space-y-3">
          {items.map((endpoint) => (
            <li key={endpoint.id}>
              <Link
                to={`/app/webhooks/${endpoint.id}/overview`}
                className={cn(
                  'group flex items-center gap-4 rounded-xl border bg-card p-4 transition-all',
                  'hover:border-foreground/20 hover:shadow-sm',
                  'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                )}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
                  <Webhook className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{endpoint.description || endpoint.url}</p>
                    <Badge variant={endpoint.enabled ? 'success' : 'muted'} className="shrink-0">
                      {endpoint.enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </div>
                  <p className="truncate font-mono text-xs text-muted-foreground">{endpoint.url}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground/80">
                    {endpoint.eventTypes.length === 0 ? 'All events' : `${endpoint.eventTypes.length} event types`}
                    {endpoint.accountIds.length > 0 && ` · ${endpoint.accountIds.length} connection${endpoint.accountIds.length > 1 ? 's' : ''}`}
                  </p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
        )}
      </QueryListState>
    </div>
  );
}
