import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Message } from '@munichat/shared';
import { MessageItem } from '@/components/chat/MessageItem';

const author = { id: 'user-1', username: 'jsilva', displayName: 'Joao Silva', avatarUrl: null };

function buildMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    channelId: 'channel-1',
    authorId: 'user-1',
    content: 'hello there',
    type: 'TEXT',
    replyToId: null,
    editedAt: null,
    deletedAt: null,
    createdAt: '2026-07-10T00:00:00.000Z',
    author,
    attachments: [],
    linkPreview: null,
    replyTo: null,
    ...overrides,
  };
}

describe('MessageItem', () => {
  it('renders content and the (edited) label when editedAt is set', () => {
    render(
      <MessageItem
        message={buildMessage({ editedAt: '2026-07-10T00:01:00.000Z' })}
        isOwn={false}
        onReply={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(screen.getByText('hello there')).toBeInTheDocument();
    expect(screen.getByText('(edited)')).toBeInTheDocument();
  });

  it('renders a tombstone and hides content/actions when deletedAt is set', () => {
    render(
      <MessageItem
        message={buildMessage({ content: '', deletedAt: '2026-07-10T00:01:00.000Z' })}
        isOwn={true}
        onReply={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(screen.getByText('Message was deleted')).toBeInTheDocument();
    expect(screen.queryByLabelText('Edit')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Delete')).not.toBeInTheDocument();
  });

  it('only shows Edit/Delete actions when the message is the current user\'s own', () => {
    const { rerender } = render(
      <MessageItem
        message={buildMessage()}
        isOwn={false}
        onReply={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByLabelText('Reply')).toBeInTheDocument();
    expect(screen.queryByLabelText('Edit')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Delete')).not.toBeInTheDocument();

    rerender(
      <MessageItem
        message={buildMessage()}
        isOwn={true}
        onReply={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByLabelText('Edit')).toBeInTheDocument();
    expect(screen.getByLabelText('Delete')).toBeInTheDocument();
  });

  it('calls onReply immediately but requires confirmation before calling onDelete', async () => {
    const onReply = vi.fn();
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(
      <MessageItem
        message={buildMessage()}
        isOwn={true}
        onReply={onReply}
        onEdit={() => {}}
        onDelete={onDelete}
      />,
    );

    await user.click(screen.getByLabelText('Reply'));
    expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }));

    await user.click(screen.getByLabelText('Delete'));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText('Delete message?')).toBeInTheDocument();

    const confirmButton = document.querySelector('[data-slot="alert-dialog-action"]');
    expect(confirmButton).not.toBeNull();
    await user.click(confirmButton as HTMLElement);
    expect(onDelete).toHaveBeenCalledWith('m1');
  });
});
