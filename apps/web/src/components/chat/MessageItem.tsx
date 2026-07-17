import { useState } from 'react';
import { format } from 'date-fns';
import { Download, ExternalLink, Pencil, Reply, Smile, Trash2 } from 'lucide-react';
import type { Message } from '@munichat/shared';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { UserAvatar } from '@/components/chat/UserAvatar';
import { Reactions } from '@/components/chat/Reactions';
import { PdfAttachmentCard } from '@/components/chat/PdfAttachmentCard';
import { VideoAttachment } from '@/components/chat/VideoAttachment';
import { AudioAttachment } from '@/components/chat/AudioAttachment';
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

const TICKET_STATUS_STYLES: Record<string, string> = {
  New: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  Processing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  Pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  Approval: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  Solved: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  Closed: 'bg-muted text-muted-foreground',
};

function ticketStatusClass(status: string): string {
  return TICKET_STATUS_STYLES[status] ?? 'bg-muted text-muted-foreground';
}

export function MessageItem({
  message,
  isOwn,
  isGrouped = false,
  reactions,
  onReply,
  onEdit,
  onDelete,
}: {
  message: Message;
  isOwn: boolean;
  isGrouped?: boolean;
  reactions?: { emoji: string; count: number }[];
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
      data-grouped={isGrouped}
      className={cn('group flex gap-2 px-4', isGrouped ? 'py-0.5' : 'py-1.5', isOwn && 'flex-row-reverse')}
    >
      <div className="flex w-8 shrink-0 justify-center pt-0.5">
        {isGrouped ? (
          <span className="hidden text-[10px] text-muted-foreground group-hover:invisible sm:block">
            {format(new Date(message.createdAt), 'HH:mm')}
          </span>
        ) : (
          <UserAvatar user={message.author} />
        )}
      </div>

      <div className={cn('flex min-w-0 flex-1 flex-col gap-0.5', isOwn && 'items-end')}>
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
          {!isGrouped && (
            <>
              <span className="text-sm font-medium">{message.author.displayName}</span>
              <span className="text-xs text-muted-foreground">{format(new Date(message.createdAt), 'HH:mm')}</span>
              {message.editedAt && <span className="text-xs text-muted-foreground">(edited)</span>}
            </>
          )}

          <span className="hidden gap-0.5 group-hover:flex">
            <Button variant="ghost" size="icon-xs" onClick={() => onReply(message)} aria-label="Reply">
              <Reply />
            </Button>
            <Button variant="ghost" size="icon-xs" aria-label="React" title="React">
              <Smile />
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
              ) : attachment.mimeType === 'application/pdf' ? (
                <PdfAttachmentCard
                  key={attachment.id}
                  url={attachmentUrl(attachment.id)}
                  fileName={attachment.fileName}
                />
              ) : attachment.mimeType.startsWith('video/') ? (
                <VideoAttachment
                  key={attachment.id}
                  url={attachmentUrl(attachment.id)}
                  fileName={attachment.fileName}
                />
              ) : attachment.mimeType.startsWith('audio/') ? (
                <AudioAttachment
                  key={attachment.id}
                  url={attachmentUrl(attachment.id)}
                  fileName={attachment.fileName}
                  sizeBytes={attachment.sizeBytes}
                />
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
              {message.linkPreview.title && (
                <span className="text-sm font-medium">{message.linkPreview.title}</span>
              )}
              {message.linkPreview.description && (
                <span className="text-xs text-muted-foreground">{message.linkPreview.description}</span>
              )}
            </div>
          </a>
        )}

        {message.type === 'TICKET' && message.ticketRef && (
          <Card size="sm" className="max-w-sm">
            <CardHeader>
              <CardTitle>Ticket #{message.ticketRef.glpiTicketId}</CardTitle>
              <CardAction>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-xs font-medium',
                    ticketStatusClass(message.ticketRef.status),
                  )}
                >
                  {message.ticketRef.status}
                </span>
              </CardAction>
            </CardHeader>
            <CardContent>
              <a
                href={message.ticketRef.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-sm text-primary hover:underline"
              >
                View in GLPI
                <ExternalLink className="size-3.5" />
              </a>
            </CardContent>
          </Card>
        )}

        <Reactions reactions={reactions} />
      </div>

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
