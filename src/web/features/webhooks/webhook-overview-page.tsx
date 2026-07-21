import { Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CopyButton } from '@/components/copy-button';
import { DescriptionList, DescriptionRow } from '@/components/description-list';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { ApiError } from '@/lib/api';
import { formatDateTime, humanizeEventType } from '@/lib/format';
import { EventTypePicker, type EventMode } from './event-picker';
import { useDeleteWebhook, useUpdateWebhook, useWebhookEventTypes } from './api';
import { useWebhookContext } from './webhook-context';

export function WebhookOverviewPage() {
  const { endpoint } = useWebhookContext();
  const navigate = useNavigate();
  const update = useUpdateWebhook(endpoint.id);
  const remove = useDeleteWebhook();

  function toggleEnabled(enabled: boolean) {
    update.mutate(
      { enabled },
      {
        onSuccess: () => toast.success(enabled ? 'Endpoint enabled' : 'Endpoint disabled'),
        onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Update failed'),
      },
    );
  }

  function handleDelete() {
    remove.mutate(endpoint.id, {
      onSuccess: () => {
        toast.success('Endpoint deleted');
        navigate('/app/webhooks');
      },
      onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Delete failed'),
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Switch checked={endpoint.enabled} onCheckedChange={toggleEnabled} id="enabled" />
            <label htmlFor="enabled" className="text-sm font-medium">
              {endpoint.enabled ? 'Deliveries are enabled' : 'Deliveries are paused'}
            </label>
          </div>
          <ConfirmDialog
            trigger={
              <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
                <Trash2 /> Delete endpoint
              </Button>
            }
            title="Delete this endpoint?"
            description="Deliveries stop immediately and delivery history is removed. This cannot be undone."
            confirmLabel="Delete endpoint"
            destructive
            loading={remove.isPending}
            onConfirm={handleDelete}
          />
        </CardContent>
      </Card>

      <DescriptionList>
        <DescriptionRow label="Endpoint ID">
          <span className="inline-flex items-center gap-1.5">
            <code className="font-mono text-xs">{endpoint.id}</code>
            <CopyButton value={endpoint.id} variant="ghost" />
          </span>
        </DescriptionRow>
        <DescriptionRow label="URL">
          <span className="inline-flex items-center gap-1.5">
            <code className="font-mono text-xs break-all">{endpoint.url}</code>
            <CopyButton value={endpoint.url} variant="ghost" />
          </span>
        </DescriptionRow>
        <DescriptionRow label="Description">
          {endpoint.description || <span className="text-muted-foreground">—</span>}
        </DescriptionRow>
        <DescriptionRow label="Connections">
          {endpoint.accountIds.length === 0 ? 'All connections' : `${endpoint.accountIds.length} scoped`}
        </DescriptionRow>
        <DescriptionRow label="Created">{formatDateTime(endpoint.createdAt)}</DescriptionRow>
      </DescriptionList>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Subscribed events</h2>
          <EditEventsDialog />
        </div>
        {endpoint.eventTypes.length === 0 ? (
          <div className="rounded-lg border bg-card px-4 py-3 text-sm">
            <Badge variant="success">All events</Badge>
            <span className="ml-2 text-muted-foreground">Every current and future event type.</span>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5 rounded-lg border bg-card p-4">
            {endpoint.eventTypes.map((type) => (
              <Badge key={type} variant="secondary" className="font-mono" title={type}>
                {humanizeEventType(type)}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EditEventsDialog() {
  const { endpoint } = useWebhookContext();
  const eventTypes = useWebhookEventTypes();
  const update = useUpdateWebhook(endpoint.id);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<EventMode>(endpoint.eventTypes.length === 0 ? 'all' : 'selected');
  const [selected, setSelected] = useState<string[]>(endpoint.eventTypes);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setMode(endpoint.eventTypes.length === 0 ? 'all' : 'selected');
    setSelected(endpoint.eventTypes);
    setError(null);
  }

  function save() {
    if (mode === 'selected' && selected.length === 0) {
      setError('Select at least one event, or choose “All events”.');
      return;
    }
    update.mutate(
      { event_types: mode === 'all' ? [] : selected },
      {
        onSuccess: () => {
          toast.success('Events updated');
          setOpen(false);
        },
        onError: (error) => setError(error instanceof ApiError ? error.message : 'Update failed'),
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil /> Edit events
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Subscribed events</DialogTitle>
        </DialogHeader>
        {eventTypes.data && (
          <EventTypePicker
            eventTypes={eventTypes.data}
            mode={mode}
            selected={selected}
            onModeChange={setMode}
            onChange={setSelected}
          />
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save} loading={update.isPending}>
            Save events
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
