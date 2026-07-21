import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Settings2, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CopyButton } from '@/components/copy-button';
import { SearchInput } from '@/components/search-input';
import { QueryListState } from '@/components/states';
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
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ApiError } from '@/lib/api';
import { notifyCommand } from '@/lib/commands';
import { friendlyJid } from '@/lib/format';
import { useDebouncedValue } from '@/lib/hooks';
import type { Group } from '@/lib/types';
import { useCreateGroup, useGroupParticipants, useGroups, useUpdateGroup } from '@/features/whatsapp/api';
import { useNumberContext } from '@/features/numbers/number-context';

type Participant = { id: string; admin: boolean };

function readParticipants(raw: unknown): Participant[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry): Participant | null => {
      if (typeof entry === 'string') return { id: entry, admin: false };
      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>;
        const id = record.id ?? record.jid;
        if (typeof id === 'string') return { id, admin: Boolean(record.admin || record.isAdmin || record.isSuperAdmin) };
      }
      return null;
    })
    .filter((value): value is Participant => value !== null);
}

export function GroupsPage() {
  const { account } = useNumberContext();
  const connected = account.status === 'connected';
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search, 300);
  const groups = useGroups(account.id, { q: q || undefined });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput value={search} onChange={setSearch} placeholder="Search groups…" className="sm:max-w-xs" />
        <CreateGroupDialog accountId={account.id} connected={connected} />
      </div>

      <QueryListState
        query={groups}
        skeletonRows={5}
        empty={{ icon: <UsersRound />, title: 'No groups', description: 'Create a group, or wait for existing groups to synchronize.' }}
      >
        {(items) => (
        <ul className="divide-y overflow-hidden rounded-lg border">
          {items.map((group) => {
            const participants = readParticipants(group.participants);
            return (
              <li key={group.jid} className="flex items-center gap-3 bg-card px-4 py-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
                  <UsersRound className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{group.subject || friendlyJid(group.jid)}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{group.jid}</p>
                </div>
                {participants.length > 0 && <Badge variant="muted">{participants.length} members</Badge>}
                <ManageGroupDialog accountId={account.id} group={group} participants={participants} connected={connected} />
              </li>
            );
          })}
        </ul>
        )}
      </QueryListState>
    </div>
  );
}

const createSchema = z.object({
  subject: z.string().min(1, 'Name the group').max(100),
  participants: z.string().min(1, 'Add at least one participant'),
});

function splitList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function CreateGroupDialog({ accountId, connected }: { accountId: string; connected: boolean }) {
  const [open, setOpen] = useState(false);
  const create = useCreateGroup(accountId);
  const form = useForm<z.infer<typeof createSchema>>({
    resolver: zodResolver(createSchema),
    defaultValues: { subject: '', participants: '' },
  });

  function onSubmit(values: z.infer<typeof createSchema>) {
    create.mutate(
      { subject: values.subject, participants: splitList(values.participants) },
      {
        onSuccess: (envelope) => {
          notifyCommand(envelope, { success: 'Group created', pending: 'Group creation queued' });
          setOpen(false);
          form.reset();
        },
        onError: (error) =>
          form.setError('participants', { message: error instanceof ApiError ? error.message : 'Failed to create group' }),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={!connected} title={connected ? undefined : 'Connect this number first'}>
          <Plus /> Create group
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a group</DialogTitle>
          <DialogDescription>Add participants by phone number in international format.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="subject"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Group name</FormLabel>
                  <FormControl>
                    <Input placeholder="Project team" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="participants"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Participants</FormLabel>
                  <FormControl>
                    <Input placeholder="+15551234567, +15557654321" {...field} />
                  </FormControl>
                  <FormDescription>Separate multiple numbers with commas.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" loading={create.isPending}>
                Create group
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

const renameSchema = z.object({
  subject: z.string().max(100).optional(),
  description: z.string().max(2048).optional(),
});

function ManageGroupDialog({
  accountId,
  group,
  participants,
  connected,
}: {
  accountId: string;
  group: Group;
  participants: Participant[];
  connected: boolean;
}) {
  const [open, setOpen] = useState(false);
  const update = useUpdateGroup(accountId);
  const manageParticipants = useGroupParticipants(accountId);
  const [newParticipants, setNewParticipants] = useState('');
  const [action, setAction] = useState<'add' | 'remove' | 'promote' | 'demote'>('add');

  const renameForm = useForm<z.infer<typeof renameSchema>>({
    resolver: zodResolver(renameSchema),
    defaultValues: { subject: group.subject ?? '', description: '' },
  });

  function onRename(values: z.infer<typeof renameSchema>) {
    const payload: { subject?: string; description?: string } = {};
    if (values.subject && values.subject !== group.subject) payload.subject = values.subject;
    if (values.description) payload.description = values.description;
    if (!payload.subject && !payload.description) return;
    update.mutate(
      { groupId: group.jid, ...payload },
      { onSuccess: (envelope) => notifyCommand(envelope, { success: 'Group updated', pending: 'Update queued' }) },
    );
  }

  function applyParticipants() {
    const list = splitList(newParticipants);
    if (!list.length) return;
    manageParticipants.mutate(
      { groupId: group.jid, participants: list, action },
      {
        onSuccess: (envelope) => {
          notifyCommand(envelope, { success: 'Participants updated', pending: 'Update queued' });
          setNewParticipants('');
        },
      },
    );
  }

  function removeParticipant(id: string) {
    manageParticipants.mutate(
      { groupId: group.jid, participants: [id], action: 'remove' },
      { onSuccess: (envelope) => notifyCommand(envelope, { success: 'Participant removed', pending: 'Removal queued' }) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings2 /> Manage
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="truncate">{group.subject || friendlyJid(group.jid)}</DialogTitle>
          <DialogDescription className="flex items-center gap-1.5 font-mono text-xs">
            {group.jid}
            <CopyButton value={group.jid} variant="ghost" />
          </DialogDescription>
        </DialogHeader>

        {!connected && (
          <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground dark:text-warning">
            Connect this number to administer the group.
          </p>
        )}

        <Form {...renameForm}>
          <form onSubmit={renameForm.handleSubmit(onRename)} className="space-y-3">
            <FormField
              control={renameForm.control}
              name="subject"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Subject</FormLabel>
                  <FormControl>
                    <Input disabled={!connected} {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={renameForm.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Input placeholder="Optional new description" disabled={!connected} {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            <Button type="submit" size="sm" variant="outline" loading={update.isPending} disabled={!connected}>
              Save changes
            </Button>
          </form>
        </Form>

        <Separator />

        <div className="space-y-3">
          <Label>Add or change participants</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={newParticipants}
              onChange={(event) => setNewParticipants(event.target.value)}
              placeholder="+15551234567, +15557654321"
              disabled={!connected}
            />
            <Select value={action} onValueChange={(value) => setAction(value as typeof action)}>
              <SelectTrigger className="sm:w-[130px]" disabled={!connected}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="add">Add</SelectItem>
                <SelectItem value="remove">Remove</SelectItem>
                <SelectItem value="promote">Promote</SelectItem>
                <SelectItem value="demote">Demote</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            onClick={applyParticipants}
            loading={manageParticipants.isPending}
            disabled={!connected || !newParticipants.trim()}
          >
            Apply
          </Button>
        </div>

        {participants.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <Label>Current members ({participants.length})</Label>
              <ul className="max-h-56 space-y-1 overflow-y-auto">
                {participants.map((participant) => (
                  <li key={participant.id} className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{friendlyJid(participant.id)}</span>
                    {participant.admin && <Badge variant="muted">Admin</Badge>}
                    <ConfirmDialog
                      trigger={
                        <Button variant="ghost" size="icon-sm" disabled={!connected} aria-label="Remove participant">
                          <span aria-hidden>×</span>
                        </Button>
                      }
                      title="Remove this participant?"
                      description={`${friendlyJid(participant.id)} will be removed from ${group.subject || 'the group'}.`}
                      confirmLabel="Remove"
                      destructive
                      onConfirm={() => removeParticipant(participant.id)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
