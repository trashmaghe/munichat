import { format } from 'date-fns';
import type { Message } from '@munichat/shared';
import { cn } from '@/lib/utils';

export function MessageItem({ message, isOwn }: { message: Message; isOwn: boolean }) {
  return (
    <div data-slot="message-item" className={cn('flex flex-col gap-0.5 px-4 py-1', isOwn && 'items-end')}>
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-medium">{message.author.displayName}</span>
        <span className="text-xs text-muted-foreground">{format(new Date(message.createdAt), 'HH:mm')}</span>
      </div>
      <p className="max-w-prose text-sm whitespace-pre-wrap">{message.content}</p>
    </div>
  );
}
