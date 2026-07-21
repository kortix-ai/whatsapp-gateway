import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/page-header';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { SecretDialog } from '@/components/secret-dialog';
import { ErrorState, ListSkeleton } from '@/components/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { formatDateTime, formatRelativeTime, isExpired, titleCase } from '@/lib/format';
import type { Account, ApiKeySummary, CreatedApiKey } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useAccounts } from '@/features/numbers/api';
import { useApiKeys, useCreateApiKey, useRevokeApiKey, type CreateApiKeyInput } from './api';
import { fullPermissions, PERMISSION_REGISTRY, readOnlyPermissions, type PermissionPreset } from './permissions';

const EXPIRY_OPTIONS = [
  { value: 'never', label: 'Never expires', seconds: null },
  { value: '7', label: '7 days', seconds: 7 * 86400 },
  { value: '30', label: '30 days', seconds: 30 * 86400 },
  { value: '90', label: '90 days', seconds: 90 * 86400 },
  { value: '365', label: '1 year', seconds: 365 * 86400 },
];

export function ApiKeysPage() {
  const keys = useApiKeys();
  const accounts = useAccounts();
  const revoke = useRevokeApiKey();
  const [searchParams, setSearchParams] = useSearchParams();

  // A connection can deep-link here (…/api-keys?connection=<id>) to open the
  // create dialog already scoped to that number. Capture it once, then clear it.
  const [initialConnection] = useState(() => searchParams.get('connection') ?? undefined);
  useEffect(() => {
    if (searchParams.has('connection')) {
      const next = new URLSearchParams(searchParams);
      next.delete('connection');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accountsById = useMemo(() => {
    const map = new Map<string, Account>();
    accounts.data?.forEach((account) => map.set(account.id, account));
    return map;
  }, [accounts.data]);

  const createDialogProps = {
    accounts: accounts.data ?? [],
    defaultConnectionId: initialConnection,
    autoOpen: Boolean(initialConnection),
  };
  const createAction = keys.data && keys.data.length > 0 ? <CreateKeyDialog {...createDialogProps} /> : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="API keys"
        description="Give agents a scoped key. Connection keys are limited to one number; account keys cover every connection."
        actions={createAction}
      />

      {keys.isLoading && <ListSkeleton rows={3} />}
      {keys.isError && <ErrorState error={keys.error} onRetry={() => keys.refetch()} />}

      {keys.data && keys.data.length === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <KeyRound />
            </EmptyMedia>
            <EmptyTitle>No API keys</EmptyTitle>
            <EmptyDescription>Create a key to let an agent operate a connection through the gateway.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <CreateKeyDialog {...createDialogProps} />
          </EmptyContent>
        </Empty>
      )}

      {keys.data && keys.data.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-lg border">
          {keys.data.map((key) => (
            <ApiKeyRow key={key.id} apiKey={key} accountsById={accountsById} onRevoke={(id) => revoke.mutateAsync(id)} revoking={revoke.isPending} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ApiKeyRow({
  apiKey,
  accountsById,
  onRevoke,
  revoking,
}: {
  apiKey: ApiKeySummary;
  accountsById: Map<string, Account>;
  onRevoke: (id: string) => Promise<unknown>;
  revoking: boolean;
}) {
  const scopeLabel =
    apiKey.scope === 'connection'
      ? accountsById.get(apiKey.account_id ?? '')?.displayName ?? 'One connection'
      : 'All connections';
  const expired = isExpired(apiKey.expiresAt);

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-card px-4 py-3.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
        <KeyRound className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium">{apiKey.name || 'Unnamed key'}</p>
          <Badge variant={apiKey.scope === 'connection' ? 'secondary' : 'muted'}>{scopeLabel}</Badge>
          {apiKey.enabled === false && <Badge variant="muted">Disabled</Badge>}
          {expired && <Badge variant="warning">Expired</Badge>}
        </div>
        <p className="mt-0.5 font-mono text-xs text-muted-foreground">
          {apiKey.start ? `${apiKey.start}…` : 'wag_…'}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground/80">
          Created {formatRelativeTime(apiKey.createdAt)}
          {apiKey.expiresAt && ` · Expires ${formatDateTime(apiKey.expiresAt)}`}
          {apiKey.lastRequest && ` · Last used ${formatRelativeTime(apiKey.lastRequest)}`}
        </p>
      </div>
      <ConfirmDialog
        trigger={
          <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
            <Trash2 /> Revoke
          </Button>
        }
        title="Revoke this API key?"
        description="Any agent using this key will immediately receive 401 responses. This cannot be undone."
        confirmLabel="Revoke key"
        destructive
        loading={revoking}
        onConfirm={async () => {
          await onRevoke(apiKey.id);
        }}
      />
    </li>
  );
}

function OptionCard({ active, title, description, onClick }: { active: boolean; title: string; description: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col gap-0.5 rounded-lg border p-3 text-left transition-colors',
        'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
        active ? 'border-foreground bg-accent/50' : 'hover:bg-accent/40',
      )}
    >
      <span className="text-sm font-medium">{title}</span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </button>
  );
}

function CreateKeyDialog({
  accounts,
  defaultConnectionId,
  autoOpen = false,
}: {
  accounts: Account[];
  defaultConnectionId?: string;
  autoOpen?: boolean;
}) {
  const create = useCreateApiKey();
  const [open, setOpen] = useState(autoOpen);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'connection' | 'account'>('connection');
  const [accountId, setAccountId] = useState<string>(defaultConnectionId ?? '');
  const [expiry, setExpiry] = useState('never');
  const [preset, setPreset] = useState<PermissionPreset>('full');
  const [custom, setCustom] = useState<Record<string, string[]>>(readOnlyPermissions());
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);

  function reset() {
    setName('');
    setScope('connection');
    setAccountId(defaultConnectionId ?? accounts[0]?.id ?? '');
    setExpiry('never');
    setPreset('full');
    setCustom(readOnlyPermissions());
    setError(null);
  }

  function toggleCustom(resource: string, action: string) {
    setCustom((current) => {
      const actions = new Set(current[resource] ?? []);
      if (actions.has(action)) actions.delete(action);
      else actions.add(action);
      const next = { ...current };
      if (actions.size) next[resource] = Array.from(actions);
      else delete next[resource];
      return next;
    });
  }

  function submit() {
    setError(null);
    if (!name.trim()) return setError('Give this key a name.');
    if (scope === 'connection' && !accountId) return setError('Choose the connection this key can access.');

    const permissions =
      preset === 'full' ? fullPermissions() : preset === 'read' ? readOnlyPermissions() : custom;
    const seconds = EXPIRY_OPTIONS.find((option) => option.value === expiry)?.seconds ?? null;

    const input: CreateApiKeyInput = {
      name: name.trim(),
      scope,
      expires_in_seconds: seconds,
      permissions,
      ...(scope === 'connection' ? { account_id: accountId } : {}),
    };
    create.mutate(input, {
      // Close the form dialog first so only the one-time secret dialog is
      // mounted — two stacked modals trap focus and block copying the key.
      onSuccess: (key) => {
        setOpen(false);
        setCreated(key);
      },
      onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not create the key.'),
    });
  }

  const noAccounts = accounts.length === 0;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) reset();
        }}
      >
        <DialogTrigger asChild>
          <Button>
            <Plus /> Create key
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create an API key</DialogTitle>
            <DialogDescription>The key is shown once. Store it in a secret manager.</DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="key-name">Name</Label>
              <Input id="key-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Support agent" maxLength={32} />
            </div>

            <div className="space-y-2">
              <Label>Scope</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                <OptionCard
                  active={scope === 'connection'}
                  title="Connection"
                  description="One number. Recommended for agents."
                  onClick={() => setScope('connection')}
                />
                <OptionCard
                  active={scope === 'account'}
                  title="Account"
                  description="Every current and future connection."
                  onClick={() => setScope('account')}
                />
              </div>
            </div>

            {scope === 'connection' && (
              <div className="space-y-1.5">
                <Label>Connection</Label>
                {noAccounts ? (
                  <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground dark:text-warning">
                    Create a connection first to mint a connection-scoped key.
                  </p>
                ) : (
                  <Select value={accountId} onValueChange={setAccountId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a connection" />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.displayName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Expiry</Label>
              <Select value={expiry} onValueChange={setExpiry}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Permissions</Label>
              <Select value={preset} onValueChange={(value) => setPreset(value as PermissionPreset)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">Full access</SelectItem>
                  <SelectItem value="read">Read-only</SelectItem>
                  <SelectItem value="custom">Custom…</SelectItem>
                </SelectContent>
              </Select>

              {preset === 'custom' && (
                <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border p-2">
                  {Object.entries(PERMISSION_REGISTRY).map(([resource, actions]) => (
                    <div key={resource} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-1.5">
                      <span className="w-24 shrink-0 text-sm font-medium">{titleCase(resource)}</span>
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {actions.map((action) => (
                          <label key={action} className="flex cursor-pointer items-center gap-1.5 text-xs">
                            <Checkbox
                              checked={(custom[resource] ?? []).includes(action)}
                              onCheckedChange={() => toggleCustom(resource, action)}
                            />
                            {action}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} loading={create.isPending} disabled={scope === 'connection' && noAccounts}>
              Create key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {created && (
        <SecretDialog
          open
          title="API key created"
          description="Copy this key now and give it to your agent alongside the generic SKILL.md."
          secret={created.key}
          meta={
            <div className="flex flex-wrap gap-1.5 text-xs">
              <Badge variant="secondary">{created.scope === 'connection' ? 'Connection scope' : 'Account scope'}</Badge>
              {created.expires_at && <Badge variant="muted">Expires {formatDateTime(created.expires_at)}</Badge>}
            </div>
          }
          onAcknowledge={() => {
            setCreated(null);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
