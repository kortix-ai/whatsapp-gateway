import { RefreshCw, Send } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ErrorState, ListSkeleton } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { formatDateTime, humanizeEventType } from '@/lib/format';
import type { WebhookDelivery } from '@/lib/types';
import { useReplayDelivery, useWebhookDeliveries } from './api';
import { useWebhookContext } from './webhook-context';

function deliveryVariant(status: string): 'success' | 'warning' | 'destructive' | 'muted' {
  if (status === 'delivered') return 'success';
  if (status === 'failed' || status === 'dead') return 'destructive';
  if (status === 'pending' || status === 'retrying' || status === 'delivering') return 'warning';
  return 'muted';
}

export function WebhookDeliveriesPage() {
  const { endpoint } = useWebhookContext();
  const [status, setStatus] = useState('all');
  const deliveries = useWebhookDeliveries({
    endpoint_id: endpoint.id,
    ...(status === 'all' ? {} : { status }),
  });
  const replay = useReplayDelivery();

  function handleReplay(delivery: WebhookDelivery) {
    replay.mutate(delivery.id, {
      onSuccess: () => toast.success('Delivery queued for replay'),
      onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Replay failed'),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger size="sm" className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="delivered">Delivered</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="retrying">Retrying</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="dead">Dead-lettered</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" onClick={() => deliveries.refetch()}>
          <RefreshCw /> Refresh
        </Button>
      </div>

      {deliveries.isLoading && <ListSkeleton rows={6} />}
      {deliveries.isError && <ErrorState error={deliveries.error} onRetry={() => deliveries.refetch()} />}

      {deliveries.data && deliveries.data.length === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Send />
            </EmptyMedia>
            <EmptyTitle>No deliveries yet</EmptyTitle>
            <EmptyDescription>Deliveries appear here as matching events occur.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {deliveries.data && deliveries.data.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-lg border">
          {deliveries.data.map((delivery) => (
            <li key={delivery.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-card px-4 py-3">
              <Badge variant={deliveryVariant(delivery.status)} className="w-24 justify-center">
                {delivery.status}
              </Badge>
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-sm">{humanizeEventType(delivery.event.type)}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(delivery.event.occurredAt)}
                  {delivery.attemptCount > 0 && ` · ${delivery.attemptCount} attempt${delivery.attemptCount > 1 ? 's' : ''}`}
                  {delivery.lastStatusCode != null && ` · HTTP ${delivery.lastStatusCode}`}
                </p>
              </div>
              {delivery.status !== 'delivered' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleReplay(delivery)}
                  loading={replay.isPending && replay.variables === delivery.id}
                >
                  <RefreshCw /> Replay
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
