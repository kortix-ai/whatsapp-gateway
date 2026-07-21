import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowDownLeft, ArrowUpRight, MessagesSquare, Send, X } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { ErrorState, ListSkeleton } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { notifyCommand } from '@/lib/commands';
import { formatDateTime, friendlyJid } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useMessages, useSendMessage } from '@/features/whatsapp/api';
import { useNumberContext } from '@/features/numbers/number-context';
import { MessagePreview } from './message-preview';

export function MessagesPage() {
  const { account } = useNumberContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const chatJid = searchParams.get('chat') ?? undefined;
  const [direction, setDirection] = useState('all');
  const [limit, setLimit] = useState(50);
  const connected = account.status === 'connected';

  const { data: messages, isLoading, isError, error, refetch, isFetching } = useMessages(account.id, {
    chat_jid: chatJid,
    direction: direction === 'all' ? undefined : direction,
    limit,
  });

  function clearChat() {
    const next = new URLSearchParams(searchParams);
    next.delete('chat');
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={direction} onValueChange={setDirection}>
            <SelectTrigger size="sm" className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All directions</SelectItem>
              <SelectItem value="inbound">Inbound</SelectItem>
              <SelectItem value="outbound">Outbound</SelectItem>
            </SelectContent>
          </Select>
          {chatJid && (
            <Badge variant="secondary" className="gap-1 py-1 pr-1 pl-2 font-mono">
              {friendlyJid(chatJid)}
              <button type="button" onClick={clearChat} className="rounded-full p-0.5 hover:bg-background/60" aria-label="Clear chat filter">
                <X className="size-3" />
              </button>
            </Badge>
          )}
        </div>
        <SendMessageDialog accountId={account.id} defaultTo={chatJid} connected={connected} />
      </div>

      {isLoading && <ListSkeleton rows={6} />}
      {isError && <ErrorState error={error} onRetry={() => refetch()} />}

      {messages && messages.length === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessagesSquare />
            </EmptyMedia>
            <EmptyTitle>No messages</EmptyTitle>
            <EmptyDescription>
              {connected ? 'Messages appear here as they are sent and received.' : 'Connect this number to see messages.'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {messages && messages.length > 0 && (
        <>
          <ul className="space-y-2">
            {messages.map((message) => {
              const outbound = message.direction === 'outbound';
              return (
                <li key={message.id} className="flex gap-3 rounded-lg border bg-card p-3">
                  <span
                    className={cn(
                      'flex size-7 shrink-0 items-center justify-center rounded-md',
                      outbound ? 'bg-success/12 text-success' : 'bg-muted text-muted-foreground',
                    )}
                    title={message.direction}
                  >
                    {outbound ? <ArrowUpRight className="size-4" /> : <ArrowDownLeft className="size-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <MessagePreview message={message} accountId={account.id} />
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="font-mono">{friendlyJid(message.senderJid ?? message.chatJid)}</span>
                      <span aria-hidden>·</span>
                      <span>{formatDateTime(message.messageTimestamp)}</span>
                      {message.status && message.status !== 'received' && (
                        <>
                          <span aria-hidden>·</span>
                          <span>{message.status}</span>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {messages.length >= limit && (
            <div className="flex justify-center">
              <Button variant="outline" size="sm" loading={isFetching} onClick={() => setLimit((value) => value + 50)}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const sendSchema = z.object({
  to: z.string().min(3, 'Enter a phone number or JID'),
  text: z.string().min(1, 'Write a message'),
});

function SendMessageDialog({ accountId, defaultTo, connected }: { accountId: string; defaultTo?: string; connected: boolean }) {
  const [open, setOpen] = useState(false);
  const send = useSendMessage(accountId);
  const form = useForm<z.infer<typeof sendSchema>>({
    resolver: zodResolver(sendSchema),
    defaultValues: { to: defaultTo ?? '', text: '' },
  });

  function onSubmit(values: z.infer<typeof sendSchema>) {
    send.mutate(values, {
      onSuccess: (envelope) => {
        notifyCommand(envelope, { success: 'Message sent', pending: 'Message queued' });
        setOpen(false);
        form.reset({ to: defaultTo ?? '', text: '' });
      },
      onError: (error) => form.setError('text', { message: error instanceof ApiError ? error.message : 'Failed to send' }),
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) form.reset({ to: defaultTo ?? '', text: '' });
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" disabled={!connected} title={connected ? undefined : 'Connect this number first'}>
          <Send /> Send message
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send a message</DialogTitle>
          <DialogDescription>Delivered through the same durable command queue agents use.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="to"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Recipient</FormLabel>
                  <FormControl>
                    <Input placeholder="+1 555 123 4567 or 123@s.whatsapp.net" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="text"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Message</FormLabel>
                  <FormControl>
                    <Textarea rows={4} placeholder="Write your message…" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" loading={send.isPending}>
                <Send /> Send
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
