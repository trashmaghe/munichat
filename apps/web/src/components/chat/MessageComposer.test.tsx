import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SocketEvent } from '@elyzian/shared';
import { createMockSocket, getMockSocket, setMockSocket } from '@/test/socket-mock';

vi.mock('socket.io-client', () => ({
  io: () => getMockSocket(),
}));

class FakeMediaRecorder {
  static isTypeSupported = vi.fn(() => true);
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  mimeType: string;
  constructor(_stream: MediaStream, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? 'audio/webm';
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['x'], { type: 'audio/webm' }) });
    this.onstop?.();
  }
}

async function loadComposer() {
  vi.resetModules();
  setMockSocket(createMockSocket());
  const { MessageComposer } = await import('@/components/chat/MessageComposer');
  return MessageComposer;
}

function renderComposer(MessageComposer: Awaited<ReturnType<typeof loadComposer>>) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MessageComposer
        channelId="channel-1"
        replyTarget={null}
        editTarget={null}
        onCancelReply={() => {}}
        onCancelEdit={() => {}}
      />
    </QueryClientProvider>,
  );
}

describe('MessageComposer', () => {
  it('emits typing:start while typing and sends on Enter without Shift', async () => {
    const MessageComposer = await loadComposer();
    renderComposer(MessageComposer);

    const socket = getMockSocket();
    socket.emit.mockImplementation(
      (event: string, payload: { content: string }, ack?: (response: unknown) => void) => {
        if (event === SocketEvent.MESSAGE_SEND && ack) {
          ack({
            message: {
              id: 'm1',
              channelId: 'channel-1',
              authorId: 'user-1',
              content: payload.content,
              type: 'TEXT',
              replyToId: null,
              editedAt: null,
              deletedAt: null,
              createdAt: '2026-07-10T00:00:00.000Z',
              author: { id: 'user-1', username: 'jsilva', displayName: 'Joao Silva', avatarUrl: null },
            },
          });
        }
      },
    );

    const textarea = screen.getByPlaceholderText(/message/i);
    const user = userEvent.setup();
    await user.type(textarea, 'hello');

    expect(socket.emit).toHaveBeenCalledWith(SocketEvent.TYPING_START, { channelId: 'channel-1' });

    await user.keyboard('{Enter}');

    expect(socket.emit).toHaveBeenCalledWith(
      SocketEvent.MESSAGE_SEND,
      { channelId: 'channel-1', content: 'hello' },
      expect.any(Function),
    );
    await waitFor(() => expect(textarea).toHaveValue(''));
  });

  it('inserts a newline instead of sending on Shift+Enter', async () => {
    const MessageComposer = await loadComposer();
    renderComposer(MessageComposer);

    const textarea = screen.getByPlaceholderText(/message/i);
    const user = userEvent.setup();
    await user.type(textarea, 'line one{Shift>}{Enter}{/Shift}line two');

    expect(textarea).toHaveValue('line one\nline two');
    expect(getMockSocket().emit).not.toHaveBeenCalledWith(
      SocketEvent.MESSAGE_SEND,
      expect.anything(),
      expect.anything(),
    );
  });

  describe('audio recording', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('swaps the input row for the recording bar after tapping the mic', async () => {
      Object.defineProperty(navigator, 'mediaDevices', {
        value: {
          getUserMedia: vi
            .fn()
            .mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
        },
        configurable: true,
      });
      vi.stubGlobal('MediaRecorder', FakeMediaRecorder);

      const MessageComposer = await loadComposer();
      renderComposer(MessageComposer);
      const user = userEvent.setup();

      await user.click(screen.getByLabelText('Record audio'));

      await waitFor(() =>
        expect(screen.getByLabelText('Enviar áudio')).toBeInTheDocument(),
      );
      expect(screen.getByLabelText('Cancelar gravação')).toBeInTheDocument();
    });
  });
});
