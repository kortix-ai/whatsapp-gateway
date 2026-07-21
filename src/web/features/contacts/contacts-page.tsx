import { Users } from 'lucide-react';
import { useState } from 'react';
import { CopyButton } from '@/components/copy-button';
import { SearchInput } from '@/components/search-input';
import { ErrorState, ListSkeleton } from '@/components/states';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { formatPhone, friendlyJid, initialsFrom } from '@/lib/format';
import { useDebouncedValue } from '@/lib/hooks';
import { useContacts } from '@/features/whatsapp/api';
import { useNumberContext } from '@/features/numbers/number-context';

export function ContactsPage() {
  const { account } = useNumberContext();
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search, 300);
  const { data: contacts, isLoading, isError, error, refetch } = useContacts(account.id, { q: q || undefined });

  return (
    <div className="space-y-4">
      <SearchInput value={search} onChange={setSearch} placeholder="Search contacts…" className="sm:max-w-xs" />

      {isLoading && <ListSkeleton rows={6} />}
      {isError && <ErrorState error={error} onRetry={() => refetch()} />}

      {contacts && contacts.length === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Users />
            </EmptyMedia>
            <EmptyTitle>No contacts</EmptyTitle>
            <EmptyDescription>Contacts sync from WhatsApp once this number is connected.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {contacts && contacts.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-lg border">
          {contacts.map((contact) => {
            const name = contact.name || contact.notify || friendlyJid(contact.jid);
            return (
              <li key={contact.jid} className="flex items-center gap-3 bg-card px-4 py-3">
                <Avatar className="size-9 border">
                  <AvatarFallback className="bg-muted text-xs font-medium">{initialsFrom(name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {contact.phoneNumber ? formatPhone(contact.phoneNumber) : friendlyJid(contact.jid)}
                  </p>
                </div>
                <CopyButton value={contact.jid} variant="ghost" />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
