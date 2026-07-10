import { vi } from 'vitest';

type Handler = (payload?: unknown) => void;

export interface MockSocket {
  connected: boolean;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  trigger: (event: string, payload?: unknown) => void;
}

export function createMockSocket(): MockSocket {
  const listeners = new Map<string, Set<Handler>>();

  const socket: MockSocket = {
    connected: false,
    connect: vi.fn(() => {
      socket.connected = true;
    }),
    disconnect: vi.fn(() => {
      socket.connected = false;
    }),
    on: vi.fn((event: string, handler: Handler) => {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(handler);
    }),
    off: vi.fn((event: string, handler: Handler) => {
      listeners.get(event)?.delete(handler);
    }),
    emit: vi.fn(),
    trigger: (event, payload) => {
      listeners.get(event)?.forEach((handler) => handler(payload));
    },
  };

  return socket;
}

let current: MockSocket | null = null;

export function setMockSocket(socket: MockSocket): void {
  current = socket;
}

export function getMockSocket(): MockSocket {
  if (!current) {
    throw new Error('Call setMockSocket() before using the socket.io-client mock');
  }
  return current;
}
