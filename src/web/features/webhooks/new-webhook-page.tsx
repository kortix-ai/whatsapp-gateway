import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { PageHeader } from '@/components/page-header';
import { SecretDialog } from '@/components/secret-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { formatPhone } from '@/lib/format';
import type { CreatedWebhookEndpoint } from '@/lib/types';
import { useAccounts } from '@/features/numbers/api';
import { EventTypePicker, type EventMode } from './event-picker';
import { useCreateWebhook, useWebhookEventTypes } from './api';

const schema = z.object({
  url: z.string().url('Enter a valid https URL'),
  description: z.string().max(200).optional(),
});

export function NewWebhookPage() {
  const navigate = useNavigate();
  const eventTypes = useWebhookEventTypes();
  const accounts = useAccounts();
  const create = useCreateWebhook();

  const [mode, setMode] = useState<EventMode>('all');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [scopedAccounts, setScopedAccounts] = useState<string[]>([]);
  const [eventError, setEventError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedWebhookEndpoint | null>(null);

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { url: '', description: '' },
  });

  function onSubmit(values: z.infer<typeof schema>) {
    setEventError(null);
    if (mode === 'selected' && selectedEvents.length === 0) {
      setEventError('Select at least one event, or choose “All events”.');
      return;
    }
    create.mutate(
      {
        url: values.url,
        ...(values.description ? { description: values.description } : {}),
        event_types: mode === 'all' ? [] : selectedEvents,
        ...(scopedAccounts.length ? { account_ids: scopedAccounts } : {}),
      },
      { onSuccess: (endpoint) => setCreated(endpoint) },
    );
  }

  function toggleAccount(id: string) {
    setScopedAccounts((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
        <Link to="/app/webhooks">
          <ArrowLeft /> Webhooks
        </Link>
      </Button>

      <PageHeader title="New webhook endpoint" description="Events are POSTed with an HMAC-SHA256 signature you verify on receipt." />

      <Card>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-6">
              {create.isError && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {create.error instanceof ApiError ? create.error.message : 'Unable to create the endpoint.'}
                  </AlertDescription>
                </Alert>
              )}
              <FormField
                control={form.control}
                name="url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Endpoint URL</FormLabel>
                    <FormControl>
                      <Input placeholder="https://api.example.com/webhooks/whatsapp" inputMode="url" {...field} />
                    </FormControl>
                    <FormDescription>Must be a public HTTPS URL. Loopback and private addresses are rejected.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Description <span className="font-normal text-muted-foreground">(optional)</span>
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="Production agent receiver" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-2">
                <Label>Events</Label>
                {eventTypes.data && (
                  <EventTypePicker
                    eventTypes={eventTypes.data}
                    mode={mode}
                    selected={selectedEvents}
                    onModeChange={setMode}
                    onChange={setSelectedEvents}
                  />
                )}
                {eventError && <p className="text-xs text-destructive">{eventError}</p>}
              </div>

              {accounts.data && accounts.data.length > 0 && (
                <div className="space-y-2">
                  <Label>Connections</Label>
                  <p className="text-xs text-muted-foreground">
                    Leave all unchecked to deliver events for every connection. Select specific connections to scope this endpoint.
                  </p>
                  <div className="grid gap-1 sm:grid-cols-2">
                    {accounts.data.map((account) => (
                      <label
                        key={account.id}
                        className="flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-sm hover:bg-accent/40"
                      >
                        <Checkbox checked={scopedAccounts.includes(account.id)} onCheckedChange={() => toggleAccount(account.id)} />
                        <span className="min-w-0 flex-1 truncate">{account.displayName}</span>
                        <span className="font-mono text-xs text-muted-foreground">{formatPhone(account.phoneNumber) || '—'}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
            <CardFooter className="justify-end gap-2 border-t">
              <Button type="button" variant="ghost" asChild>
                <Link to="/app/webhooks">Cancel</Link>
              </Button>
              <Button type="submit" loading={create.isPending} disabled={!eventTypes.data}>
                Create endpoint
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>

      {created && (
        <SecretDialog
          open
          title="Webhook endpoint created"
          description="Copy the signing secret now to verify incoming deliveries."
          secret={created.secret}
          meta={
            <p className="text-xs text-muted-foreground">
              Verify each request with <code className="rounded bg-muted px-1 py-0.5 font-mono">HMAC-SHA256</code> over{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono">timestamp + "." + body</code>, compared against the{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono">X-WhatsApp-Signature</code> header.
            </p>
          }
          onAcknowledge={() => navigate(`/app/webhooks/${created.id}/overview`)}
        />
      )}
    </div>
  );
}
