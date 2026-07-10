import { useState, type KeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { sendMessage } from '@/lib/socket';
import { appendMessageToCache } from '@/lib/message-cache';
import { useTypingEmitter } from '@/hooks/useTypingEmitter';
import { Button } from '@/components/ui/button';

export function MessageComposer({ channelId }: { channelId: string }) {
  const [content, setContent] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { notifyTyping, stopTyping } = useTypingEmitter(channelId);

  async function handleSend() {
    const trimmed = content.trim();
    if (!trimmed || isSending) {
      return;
    }
    setIsSending(true);
    setError(null);
    stopTyping();
    try {
      const message = await sendMessage(channelId, trimmed);
      appendMessageToCache(queryClient, message);
      setContent('');
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

  return (
    <div data-slot="message-composer" className="flex flex-col gap-2 border-t p-3">
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-end gap-2">
        <textarea
          value={content}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message…"
          rows={1}
          className="flex-1 resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <Button onClick={() => void handleSend()} disabled={!content.trim() || isSending}>
          Send
        </Button>
      </div>
    </div>
  );
}
