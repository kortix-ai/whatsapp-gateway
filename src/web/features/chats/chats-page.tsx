import { MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SearchInput } from '@/components/search-input';
import { ErrorState, ListSkeleton } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatRelativeTime, friendlyJid } from '@/lib/format';
import { useDebouncedValue } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { useChats } from '@/features/whatsapp/api';
import { useNumberContext } from '@/features/numbers/number-context';

export function ChatsPage() {
  const { account } = useNumberContext();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [unread, setUnread] = useState(false);
  const [archived, setArchived] = useState('all');
  const q = useDebouncedValue(search, 300);

  const { data: chats, isLoading, isError, error, refetch } = useChats(account.id, {
    q: q || undefined,
    unread: unread || undefined,
    archived: archived === 'all' ? undefined : archived,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={setSearch} placeholder="Search chats by name or JID…" className="sm:max-w-xs" />
        <div className="flex items-center gap-2">
          <Button
            variant={unread ? 'default' : 'outline'}
            size="sm"
            onClick={() => setUnread((value) => !value)}
          >
            Unread only
          </Button>
          <Select value={archived} onValueChange={setArchived}>
            <SelectTrigger size="sm" className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All chats</SelectItem>
              <SelectItem value="false">Active</SelectItem>
              <SelectItem value="true">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading && <ListSkeleton rows={6} />}
      {isError && <ErrorState error={error} onRetry={() => refetch()} />}

      {chats && chats.length === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessageCircle />
            </EmptyMedia>
            <EmptyTitle>No chats</EmptyTitle>
            <EmptyDescription>
              {account.status === 'connected'
                ? 'Chats appear as WhatsApp synchronizes history and new conversations arrive.'
                : 'Connect this number to synchronize chats.'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {chats && chats.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-lg border">
          {chats.map((chat) => (
            <li key={chat.jid}>
              <button
                type="button"
                onClick={() => navigate(`../messages?chat=${encodeURIComponent(chat.jid)}`, { relative: 'path' })}
                className={cn(
                  'flex w-full items-center gap-3 bg-card px-4 py-3 text-left transition-colors hover:bg-accent/50',
                  'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:ring-inset',
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{chat.name || friendlyJid(chat.jid)}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{chat.jid}</p>
                </div>
                {chat.archived && <Badge variant="muted">Archived</Badge>}
                {chat.unreadCount > 0 && <Badge variant="success">{chat.unreadCount} unread</Badge>}
                <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground sm:block">
                  {formatRelativeTime(chat.updatedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
