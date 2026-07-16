import { ConfigService } from '@nestjs/config';
import { RmmService, RmmUnavailableError } from './rmm.service';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fakeConfig(): ConfigService {
  const values: Record<string, string> = {
    RMM_URL: 'https://api.rmm.example.org',
    RMM_API_KEY: 'test-api-key',
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('RmmService', () => {
  let service: RmmService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new RmmService(fakeConfig());
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('listAgents', () => {
    it('maps raw agent fields and sends the API key header', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse(200, [
          {
            agent_id: 'a1',
            hostname: 'PC-12',
            site_name: 'Sede',
            client_name: 'Prefeitura',
            plat: 'windows',
            status: 'online',
          },
        ]),
      );

      const result = await service.listAgents();

      expect(result).toEqual([
        {
          agentId: 'a1',
          hostname: 'PC-12',
          siteName: 'Sede',
          clientName: 'Prefeitura',
          platform: 'windows',
          status: 'online',
        },
      ]);
      const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.rmm.example.org/agents/?detail=false');
      expect((options.headers as Record<string, string>)['X-API-KEY']).toBe(
        'test-api-key',
      );
    });

    it('throws RmmUnavailableError on a non-ok response', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(500, {}));

      await expect(service.listAgents()).rejects.toBeInstanceOf(
        RmmUnavailableError,
      );
    });

    it('throws RmmUnavailableError when the request fails or times out', async () => {
      fetchSpy.mockRejectedValueOnce(
        new DOMException('The operation was aborted', 'TimeoutError'),
      );

      await expect(service.listAgents()).rejects.toBeInstanceOf(
        RmmUnavailableError,
      );
    });
  });

  describe('getAgent', () => {
    it('returns the mapped agent when found', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse(200, {
          agent_id: 'a1',
          hostname: 'PC-12',
          site_name: 'Sede',
          client_name: 'Prefeitura',
          plat: 'windows',
          status: 'online',
        }),
      );

      const result = await service.getAgent('a1');

      expect(result).toEqual({
        agentId: 'a1',
        hostname: 'PC-12',
        siteName: 'Sede',
        clientName: 'Prefeitura',
        platform: 'windows',
        status: 'online',
      });
    });

    it('returns null for a 404', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(404, {}));

      const result = await service.getAgent('missing');

      expect(result).toBeNull();
    });
  });
});
