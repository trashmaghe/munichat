import { useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Paperclip, X } from 'lucide-react';
import {
  ALLOWED_UPLOAD_MIME_TYPES,
  MAX_UPLOAD_SIZE_BYTES,
  type Message,
} from '@munichat/shared';
import { sendMessage, editMessage } from '@/lib/socket';
import { appendMessageToCache } from '@/lib/message-cache';
import { presignUpload, uploadToPresignedUrl } from '@/lib/files-api';
import { useTypingEmitter } from '@/hooks/useTypingEmitter';
import { Button } from '@/components/ui/button';

export function MessageComposer({
  channelId,
  replyTarget,
  editTarget,
  onCancelReply,
  onCancelEdit,
}: {
  channelId: string;
  replyTarget: Message | null;
  editTarget: Message | null;
  onCancelReply: () => void;
  onCancelEdit: () => void;
}) {
  const [content, setContent] = useState(editTarget?.content ?? '');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { notifyTyping, stopTyping } = useTypingEmitter(channelId);

  async function handleSend() {
    const trimmed = content.trim();
    if ((!trimmed && !pendingFile) || isSending) {
      return;
    }
    setIsSending(true);
    setError(null);
    stopTyping();
    try {
      if (editTarget) {
        await editMessage(editTarget.id, trimmed);
        onCancelEdit();
      } else {
        let attachments;
        if (pendingFile) {
          const presigned = await presignUpload(channelId, pendingFile);
          await uploadToPresignedUrl(presigned.uploadUrl, pendingFile);
          attachments = [
            {
              objectKey: presigned.objectKey,
              fileName: pendingFile.name,
              mimeType: pendingFile.type,
              sizeBytes: pendingFile.size,
            },
          ];
        }
        const message = await sendMessage(channelId, trimmed, {
          replyToId: replyTarget?.id,
          attachments,
        });
        appendMessageToCache(queryClient, message);
        if (replyTarget) {
          onCancelReply();
        }
      }
      setContent('');
      setPendingFile(null);
    } catch {
      setError('Failed to send message. Please try again.');
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  }

  function handleChange(value: string) {
    setContent(value);
    if (value) {
      notifyTyping();
    } else {
      stopTyping();
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    if (!(ALLOWED_UPLOAD_MIME_TYPES as readonly string[]).includes(file.type)) {
      setError('That file type is not supported.');
      return;
    }
    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      setError('That file is too large (25MB max).');
      return;
    }
    setError(null);
    setPendingFile(file);
  }

  return (
    <div data-slot="message-composer" className="flex flex-col gap-2 border-t p-3">
      {error && <p className="text-xs text-destructive">{error}</p>}

      {editTarget && (
        <div className="flex items-center justify-between rounded-md bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
          <span>Editing message</span>
          <Button variant="ghost" size="icon-xs" onClick={onCancelEdit} aria-label="Cancel edit">
            <X />
          </Button>
        </div>
      )}

      {!editTarget && replyTarget && (
        <div className="flex items-center justify-between rounded-md border-l-2 border-border bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
          <span>
            Replying to <span className="font-medium">{replyTarget.author.displayName}</span>
          </span>
          <Button variant="ghost" size="icon-xs" onClick={onCancelReply} aria-label="Cancel reply">
            <X />
          </Button>
        </div>
      )}

      {pendingFile && (
        <div className="flex items-center justify-between rounded-md border border-border bg-card px-2 py-1 text-xs">
          <span>{pendingFile.name}</span>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setPendingFile(null)}
            aria-label="Remove attachment"
          >
            <X />
          </Button>
        </div>
      )}

      <div className="flex items-end gap-2">
        {!editTarget && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_UPLOAD_MIME_TYPES.join(',')}
              onChange={handleFileChange}
              className="hidden"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach file"
            >
              <Paperclip />
            </Button>
          </>
        )}
        <textarea
          value={content}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message…"
          rows={1}
          className="flex-1 resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <Button
          onClick={() => void handleSend()}
          disabled={(!content.trim() && !pendingFile) || isSending}
        >
          Send
        </Button>
      </div>
    </div>
  );
}
