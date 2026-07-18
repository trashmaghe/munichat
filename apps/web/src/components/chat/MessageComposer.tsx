import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Mic, Paperclip, X } from 'lucide-react';
import {
  ALLOWED_UPLOAD_MIME_TYPES,
  MAX_UPLOAD_SIZE_BYTES,
  type Message,
} from '@elyzian/shared';
import { sendMessage, editMessage } from '@/lib/socket';
import { appendMessageToCache } from '@/lib/message-cache';
import { presignUpload, uploadToPresignedUrl } from '@/lib/files-api';
import { useTypingEmitter } from '@/hooks/useTypingEmitter';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { Button } from '@/components/ui/button';
import { RecordingBar } from '@/components/chat/RecordingBar';

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
  const recorder = useAudioRecorder();
  const sentClipRef = useRef<File | null>(null);

  async function sendAttachment(file: File, text: string) {
    setIsSending(true);
    setError(null);
    try {
      const presigned = await presignUpload(channelId, file);
      await uploadToPresignedUrl(presigned.uploadUrl, file);
      const message = await sendMessage(channelId, text, {
        replyToId: replyTarget?.id,
        attachments: [
          {
            objectKey: presigned.objectKey,
            fileName: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
          },
        ],
      });
      appendMessageToCache(queryClient, message);
      if (replyTarget) {
        onCancelReply();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao enviar o áudio.');
    } finally {
      setIsSending(false);
    }
  }

  // Once a recording is finalized, upload + send it as a voice message through
  // the same presign→send path as any attachment.
  useEffect(() => {
    if (
      recorder.status === 'recorded' &&
      recorder.file &&
      sentClipRef.current !== recorder.file
    ) {
      sentClipRef.current = recorder.file;
      const clip = recorder.file;
      recorder.reset();
      void sendAttachment(clip, '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.status, recorder.file]);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message. Please try again.');
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
      {(error ?? recorder.error) && (
        <p className="text-xs text-destructive">{error ?? recorder.error}</p>
      )}

      {editTarget && (
        <div className="flex items-center justify-between rounded-md bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
          <span>Editing message</span>
          <Button variant="ghost" size="icon-xs" onClick={onCancelEdit} aria-label="Cancel edit">
            <X />
          </Button>
        </div>
      )}

      {!editTarget && replyTarget && (
        <div className="flex items-center justify-between rounded-md border-l-2 border-gold/60 bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
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

      {recorder.status === 'recording' ? (
        <RecordingBar
          elapsedMs={recorder.elapsedMs}
          getLevel={recorder.getLevel}
          onCancel={recorder.cancel}
          onSend={recorder.stop}
          disabled={isSending}
        />
      ) : (
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
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void recorder.start()}
                disabled={recorder.status === 'requesting' || isSending}
                aria-label="Record audio"
              >
                <Mic />
              </Button>
            </>
          )}
          <textarea
            value={content}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message… (try /ticket <description> to open a GLPI ticket)"
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
      )}
    </div>
  );
}
