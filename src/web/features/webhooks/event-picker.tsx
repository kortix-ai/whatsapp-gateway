import { Check, Globe, ListChecks } from 'lucide-react';
import { useMemo, useState } from 'react';
import { SearchInput } from '@/components/search-input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { eventCategory, humanizeEventType, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';

export type EventMode = 'all' | 'selected';

function OptionCard({
  active,
  icon,
  title,
  description,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
        'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
        active ? 'border-foreground bg-accent/50' : 'hover:bg-accent/40',
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md',
          active ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground',
        )}
      >
        {icon}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

export function EventTypePicker({
  eventTypes,
  mode,
  selected,
  onModeChange,
  onChange,
}: {
  eventTypes: string[];
  mode: EventMode;
  selected: string[];
  onModeChange: (mode: EventMode) => void;
  onChange: (selected: string[]) => void;
}) {
  const [search, setSearch] = useState('');

  const groups = useMemo(() => {
    const term = search.trim().toLowerCase();
    const map = new Map<string, string[]>();
    for (const type of eventTypes) {
      if (term && !type.toLowerCase().includes(term)) continue;
      const category = eventCategory(type);
      const list = map.get(category) ?? [];
      list.push(type);
      map.set(category, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [eventTypes, search]);

  const selectedSet = new Set(selected);

  function toggle(type: string) {
    const next = new Set(selectedSet);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    onChange(Array.from(next));
  }

  function toggleGroup(types: string[], allSelected: boolean) {
    const next = new Set(selectedSet);
    for (const type of types) {
      if (allSelected) next.delete(type);
      else next.add(type);
    }
    onChange(Array.from(next));
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <OptionCard
          active={mode === 'all'}
          icon={<Globe className="size-4" />}
          title="All events"
          description="Every current and future event type."
          onClick={() => onModeChange('all')}
        />
        <OptionCard
          active={mode === 'selected'}
          icon={<ListChecks className="size-4" />}
          title="Selected events"
          description="Only the specific events you pick."
          onClick={() => onModeChange('selected')}
        />
      </div>

      {mode === 'selected' && (
        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <SearchInput value={search} onChange={setSearch} placeholder="Filter events…" className="flex-1" />
            <Badge variant={selected.length ? 'success' : 'muted'}>{selected.length} selected</Badge>
          </div>
          <div className="max-h-72 space-y-4 overflow-y-auto pr-1">
            {groups.map(([category, types]) => {
              const allSelected = types.every((type) => selectedSet.has(type));
              return (
                <div key={category} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{titleCase(category)}</p>
                    <button
                      type="button"
                      onClick={() => toggleGroup(types, allSelected)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      {allSelected ? 'Clear' : 'Select all'}
                    </button>
                  </div>
                  <div className="grid gap-1 sm:grid-cols-2">
                    {types.map((type) => {
                      const checked = selectedSet.has(type);
                      return (
                        <label
                          key={type}
                          className={cn(
                            'flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-sm transition-colors',
                            checked ? 'border-foreground/30 bg-accent/50' : 'border-transparent hover:bg-accent/40',
                          )}
                        >
                          <Checkbox checked={checked} onCheckedChange={() => toggle(type)} />
                          <span className="min-w-0 flex-1 truncate" title={type}>
                            {humanizeEventType(type)}
                          </span>
                          {checked && <Check className="size-3.5 shrink-0 text-success" />}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {groups.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No events match your filter.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
