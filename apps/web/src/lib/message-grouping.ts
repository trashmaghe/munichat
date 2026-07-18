import type { Message } from '@elyzian/shared';

const GROUP_WINDOW_MS = 5 * 60 * 1000;

/**
 * A message groups with the previous one when it's from the same author,
 * arrives within GROUP_WINDOW_MS of it, and neither is a SYSTEM message.
 */
export function computeMessageGrouping(messages: Message[]): boolean[] {
  return messages.map((message, index) => {
    if (index === 0) return false;
    const prev = messages[index - 1]!;
    if (message.type === 'SYSTEM' || prev.type === 'SYSTEM') return false;
    if (message.authorId !== prev.authorId) return false;
    const gapMs = new Date(message.createdAt).getTime() - new Date(prev.createdAt).getTime();
    return gapMs >= 0 && gapMs < GROUP_WINDOW_MS;
  });
}
