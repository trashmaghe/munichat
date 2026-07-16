import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Search } from 'lucide-react';
import { useMessageSearch } from '@/hooks/useMessageSearch';
import { Input } from '@/components/ui/input';

const DEBOUNCE_MS = 300;

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function highlightTerm(text: string, term: string): ReactNode {
  const trimmed = term.trim();
  if (!trimmed) return text;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'ig'));
  return parts.map((part, index) =>
    part.toLowerCase() === trimmed.toLowerCase() ? (
      <mark key={index} className="rounded-sm bg-yellow-200 px-0.5 dark:bg-yellow-900/60">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

export function MessageSearch() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);
  const { data, isFetching } = useMessageSearch(debouncedQuery);
  const containerRef = useRef<HTMLDivElement>(null);

  const results = data ? data.pages.flatMap((page) => page.messages) : [];
  const showResults = open && debouncedQuery.trim().length > 0;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div data-slot="message-search" ref={containerRef} className="relative px-2 py-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search messages…"
          className="h-8 pl-7 text-sm"
          aria-label="Search messages"
        />
      </div>

      {showResults && (
        <div className="absolute inset-x-2 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg">
          {isFetching && results.length === 0 && (
            <p className="p-3 text-xs text-muted-foreground">Searching…</p>
          )}
          {!isFetching && results.length === 0 && (
            <p className="p-3 text-xs text-muted-foreground">No messages found.</p>
          )}
          {results.map((message) => (
            <Link
              key={message.id}
              to={`/channels/${message.channelId}`}
              onClick={() => setOpen(false)}
              className="block border-b border-border px-3 py-2 text-sm last:border-b-0 hover:bg-muted"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-medium">{message.author.displayName}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {format(new Date(message.createdAt), 'dd/MM HH:mm')}
                </span>
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {highlightTerm(message.content, debouncedQuery)}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
