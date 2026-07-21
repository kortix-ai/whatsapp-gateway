import { useQuery } from '@tanstack/react-query';
import { Play, Terminal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CopyButton } from '@/components/copy-button';
import { JsonBlock } from '@/components/json-block';
import { SearchInput } from '@/components/search-input';
import { ErrorState, ListSkeleton } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError } from '@/lib/api';
import { notifyCommand } from '@/lib/commands';
import { titleCase } from '@/lib/format';
import type { BaileysAction, CommandEnvelope, Paginated } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useNumberContext } from '@/features/numbers/number-context';

export function ActionsPage() {
  const { account } = useNumberContext();
  const connected = account.status === 'connected';
  const actionsQuery = useQuery({
    queryKey: ['baileys-actions'],
    queryFn: () => api<Paginated<BaileysAction>>('/v1/baileys-actions').then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  const [search, setSearch] = useState('');
  const [resource, setResource] = useState('all');
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const resources = useMemo(() => {
    const set = new Set<string>();
    actionsQuery.data?.forEach((action) => set.add(action.permission.resource));
    return Array.from(set).sort();
  }, [actionsQuery.data]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (actionsQuery.data ?? []).filter((action) => {
      if (resource !== 'all' && action.permission.resource !== resource) return false;
      if (!term) return true;
      return (
        action.name.toLowerCase().includes(term) ||
        action.method.toLowerCase().includes(term) ||
        action.description.toLowerCase().includes(term)
      );
    });
  }, [actionsQuery.data, search, resource]);

  const selected = useMemo(
    () => actionsQuery.data?.find((action) => action.name === selectedName) ?? null,
    [actionsQuery.data, selectedName],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {actionsQuery.data ? `${actionsQuery.data.length} managed Baileys operations` : 'Loading catalog…'}
        </p>
      </div>

      {actionsQuery.isLoading && <ListSkeleton rows={6} />}
      {actionsQuery.isError && <ErrorState error={actionsQuery.error} onRetry={() => actionsQuery.refetch()} />}

      {actionsQuery.data && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_1fr]">
          <div className="space-y-3">
            <div className="flex gap-2">
              <SearchInput value={search} onChange={setSearch} placeholder="Search actions…" className="flex-1" />
              <Select value={resource} onValueChange={setResource}>
                <SelectTrigger className="w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {resources.map((entry) => (
                    <SelectItem key={entry} value={entry}>
                      {titleCase(entry)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ul className="max-h-[28rem] divide-y overflow-y-auto rounded-lg border lg:max-h-[32rem]">
              {filtered.map((action) => (
                <li key={action.name}>
                  <button
                    type="button"
                    onClick={() => setSelectedName(action.name)}
                    className={cn(
                      'flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left transition-colors',
                      'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:ring-inset',
                      selectedName === action.name ? 'bg-accent' : 'hover:bg-accent/50',
                    )}
                  >
                    <span className="font-mono text-sm font-medium">{action.name}</span>
                    <span className="line-clamp-1 text-xs text-muted-foreground">{action.description}</span>
                  </button>
                </li>
              ))}
              {filtered.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No matching actions.</li>}
            </ul>
          </div>

          {selected ? (
            <ActionRunner key={selected.name} accountId={account.id} action={selected} connected={connected} />
          ) : (
            <Card className="hidden lg:flex lg:items-center lg:justify-center">
              <CardContent className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
                <Terminal className="size-8 opacity-60" />
                <p className="text-sm">Select an action to inspect and run it.</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function ActionRunner({ accountId, action, connected }: { accountId: string; action: BaileysAction; connected: boolean }) {
  const [args, setArgs] = useState('[]');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CommandEnvelope | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  async function run() {
    setJsonError(null);
    setRunError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(args || '[]');
    } catch {
      setJsonError('Arguments must be valid JSON.');
      return;
    }
    if (!Array.isArray(parsed)) {
      setJsonError('Arguments must be a JSON array, e.g. ["123@s.whatsapp.net"].');
      return;
    }
    setRunning(true);
    try {
      const envelope = await api<CommandEnvelope>(`/v1/accounts/${accountId}/actions/${encodeURIComponent(action.name)}`, {
        method: 'POST',
        body: { args: parsed },
      });
      setResult(envelope);
      notifyCommand(envelope, { success: `${action.name} completed`, pending: `${action.name} queued` });
    } catch (error) {
      setRunError(error instanceof ApiError ? error.message : 'The action failed.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="font-mono text-base">{action.name}</CardTitle>
          <Badge variant="muted">
            {action.permission.resource}:{action.permission.action}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{action.description}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-px overflow-hidden rounded-md border bg-border text-sm">
          <div className="grid grid-cols-[6rem_1fr] gap-2 bg-card px-3 py-2">
            <span className="text-muted-foreground">Method</span>
            <code className="font-mono text-xs">{action.method}</code>
          </div>
          <div className="grid grid-cols-[6rem_1fr] gap-2 bg-card px-3 py-2">
            <span className="text-muted-foreground">Arguments</span>
            <code className="font-mono text-xs break-words">{action.args || '—'}</code>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="action-args">JSON arguments</Label>
          <Textarea
            id="action-args"
            value={args}
            onChange={(event) => setArgs(event.target.value)}
            spellCheck={false}
            rows={5}
            className="font-mono text-xs"
          />
          {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={run} loading={running} disabled={!connected} title={connected ? undefined : 'Connect this number first'}>
            <Play /> Execute
          </Button>
          {!connected && <span className="text-xs text-muted-foreground">Connect this number to run actions.</span>}
        </div>

        {runError && <p className="text-sm text-destructive">{runError}</p>}

        {result && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Command envelope</Label>
              <CopyButton value={JSON.stringify(result, null, 2)} variant="ghost" />
            </div>
            <JsonBlock value={result} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
