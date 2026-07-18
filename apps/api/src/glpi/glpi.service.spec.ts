import { ConfigService } from '@nestjs/config';
import { GlpiService, GlpiUnavailableError } from './glpi.service';
import { mapGlpiStatus } from './glpi.status';
import { resetGlpiSessionForTests } from './glpi.session';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fakeConfig(): ConfigService {
  const values: Record<string, string> = {
    GLPI_URL: 'https://glpi.example.com',
    GLPI_APP_TOKEN: 'app-token',
    GLPI_USER_TOKEN: 'user-token',
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('GlpiService', () => {
  let service: GlpiService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    resetGlpiSessionForTests();
    service = new GlpiService(fakeConfig());
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('createTicket', () => {
    it('initializes a session and creates a ticket', async () => {
      fetchSpy
        .mockResolvedValueOnce(jsonResponse(200, { session_token: 'sess-1' }))
        .mockResolvedValueOnce(jsonResponse(201, { id: 42 }));

      const result = await service.createTicket({
        title: 'Printer jammed',
        content: 'printer on 3rd floor is jammed',
        requesterLabel: 'Reported via Elyzian by Joao Silva (jsilva)',
      });

      expect(result).toEqual({ glpiTicketId: 42, status: 'New' });
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      const [initUrl, initOptions] = fetchSpy.mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(initUrl).toContain('/apirest.php/initSession');
      expect(
        (initOptions.headers as Record<string, string>).Authorization,
      ).toBe('user_token user-token');

      const [createUrl, createOptions] = fetchSpy.mock.calls[1] as [
        string,
        RequestInit,
      ];
      expect(createUrl).toBe('https://glpi.example.com/apirest.php/Ticket/');
      expect(createOptions.method).toBe('POST');
      const sentBody = JSON.parse(createOptions.body as string) as {
        input: { name: string; content: string };
      };
      expect(sentBody.input.name).toBe('Printer jammed');
      expect(sentBody.input.content).toContain(
        'Reported via Elyzian by Joao Silva (jsilva)',
      );
    });

    it('reinitializes the session and retries once after a 401 ERROR_SESSION_TOKEN_INVALID', async () => {
      fetchSpy
        .mockResolvedValueOnce(jsonResponse(200, { session_token: 'sess-1' }))
        .mockResolvedValueOnce(
          jsonResponse(401, ['ERROR_SESSION_TOKEN_INVALID', 'expired']),
        )
        .mockResolvedValueOnce(jsonResponse(200, { session_token: 'sess-2' }))
        .mockResolvedValueOnce(jsonResponse(201, { id: 99 }));

      const result = await service.createTicket({
        title: 'Title',
        content: 'Content',
        requesterLabel: 'Reported via Elyzian by Joao Silva (jsilva)',
      });

      expect(result).toEqual({ glpiTicketId: 99, status: 'New' });
      expect(fetchSpy).toHaveBeenCalledTimes(4);
    });

    it('throws GlpiUnavailableError when the request fails or times out', async () => {
      fetchSpy.mockRejectedValueOnce(
        new DOMException('The operation was aborted', 'TimeoutError'),
      );

      await expect(
        service.createTicket({
          title: 'Title',
          content: 'Content',
          requesterLabel: 'Reported via Elyzian by Joao Silva (jsilva)',
        }),
      ).rejects.toBeInstanceOf(GlpiUnavailableError);
    });
  });

  describe('getTicket', () => {
    it('returns the mapped status for an existing ticket', async () => {
      fetchSpy
        .mockResolvedValueOnce(jsonResponse(200, { session_token: 'sess-1' }))
        .mockResolvedValueOnce(jsonResponse(200, { status: 6 }));

      const result = await service.getTicket(42);

      expect(result).toEqual({ status: 'Closed' });
    });

    it('returns null for a 404', async () => {
      fetchSpy
        .mockResolvedValueOnce(jsonResponse(200, { session_token: 'sess-1' }))
        .mockResolvedValueOnce(jsonResponse(404, {}));

      const result = await service.getTicket(999);

      expect(result).toBeNull();
    });
  });

  describe('mapGlpiStatus', () => {
    it.each([
      [1, 'New'],
      [2, 'Processing'],
      [3, 'Processing'],
      [4, 'Pending'],
      [5, 'Solved'],
      [6, 'Closed'],
      [10, 'Approval'],
    ])('maps GLPI status code %i to %s', (code, label) => {
      expect(mapGlpiStatus(code)).toBe(label);
    });

    it('falls back to a generic label for an unrecognized status code', () => {
      expect(mapGlpiStatus(999)).toBe('Status 999');
    });
  });
});
