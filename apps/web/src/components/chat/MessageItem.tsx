import { useState } from 'react';
import { format } from 'date-fns';
import { Download, Pencil, Reply, Trash2 } from 'lucide-react';
import type { Message } from '@munichat/shared';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

function attachmentUrl(attachmentId: string): string {
  return `${import.meta.env.VITE_API_URL}/files/${attachmentId}`;
}

export function MessageItem({
  message,
  isOwn,
  onReply,
  onEdit,
  onDelete,
}: {
  message: Message;
  isOwn: boolean;
  onReply: (message: Message) => void;
  onEdit: (message: Message) => void;
  onDelete: (messageId: string) => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (message.deletedAt) {
    return (
      <div data-slot="message-item" className={cn('flex flex-col gap-0.5 px-4 py-1', isOwn && 'items-end')}>
        <p className="text-sm text-muted-foreground italic">Message was deleted</p>
      </div>
    );
  }

  return (
    <div
      data-slot="message-item"
      className={cn('group flex flex-col gap-0.5 px-4 py-1', isOwn && 'items-end')}
    >
      {message.replyTo && (
        <div className="max-w-prose rounded-md border-l-2 border-border bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
          {message.replyTo.deleted ? (
            <span className="italic">Original message was deleted</span>
          ) : (
            <>
              <span className="font-medium">{message.replyTo.authorDisplayName}</span>
              {': '}
              {message.replyTo.contentPreview ?? (message.replyTo.hasAttachment ? 'Sent an attachment' : '')}
            </>
          )}
        </div>
      )}

      <div className="flex items-baseline gap-2">
        <span className="text-sm font-medium">{message.author.displayName}</span>
        <span className="text-xs text-muted-foreground">{format(new Date(message.createdAt), 'HH:mm')}</span>
        {message.editedAt && <span className="text-xs text-muted-foreground">(edited)</span>}

        <span className="hidden gap-0.5 group-hover:flex">
          <Button variant="ghost" size="icon-xs" onClick={() => onReply(message)} aria-label="Reply">
            <Reply />
          </Button>
          {isOwn && (
            <>
              <Button variant="ghost" size="icon-xs" onClick={() => onEdit(message)} aria-label="Edit">
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setConfirmingDelete(true)}
                aria-label="Delete"
              >
                <Trash2 />
              </Button>
            </>
          )}
        </span>
      </div>

      {message.content && <p className="max-w-prose text-sm whitespace-pre-wrap">{message.content}</p>}

      {message.attachments.length > 0 && (
        <div className="flex flex-col gap-1">
          {message.attachments.map((attachment) =>
            attachment.mimeType.startsWith('image/') ? (
              <a key={attachment.id} href={attachmentUrl(attachment.id)} target="_blank" rel="noreferrer">
                <img
                  src={attachmentUrl(attachment.id)}
                  alt={attachment.fileName}
                  className="max-h-64 max-w-64 rounded-lg border border-border object-cover"
                />
              </a>
            ) : (
              <a
                key={attachment.id}
                href={attachmentUrl(attachment.id)}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm hover:bg-muted"
              >
                <Download className="size-4 text-muted-foreground" />
                <span>{attachment.fileName}</span>
              </a>
            ),
          )}
        </div>
      )}

      {message.linkPreview?.status === 'READY' && (
        <a
          href={message.linkPreview.url}
          target="_blank"
          rel="noreferrer"
          className="flex max-w-sm flex-col overflow-hidden rounded-lg border border-border bg-card hover:bg-muted"
        >
          {message.linkPreview.imageUrl && (
            <img src={message.linkPreview.imageUrl} alt="" className="max-h-40 w-full object-cover" />
          )}
          <div className="flex flex-col gap-0.5 px-3 py-2">
            {message.linkPreview.title && <span className="text-sm font-medium">{message.linkPreview.title}</span>}
            {message.linkPreview.description && (
              <span className="text-xs text-muted-foreground">{message.linkPreview.description}</span>
            )}
          </div>
        </a>
      )}

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete message?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onDelete(message.id);
                setConfirmingDelete(false);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
