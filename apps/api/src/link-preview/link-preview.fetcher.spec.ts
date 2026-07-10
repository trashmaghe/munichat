import { guardedFetchHtml } from './link-preview.fetcher';

const mockLookup = jest.fn<
  Promise<Array<{ address: string; family: number }>>,
  unknown[]
>();
jest.mock('node:dns/promises', () => ({
  lookup: (...args: unknown[]) => mockLookup(...args),
}));

function htmlResponse(html: string, contentType = 'text/html'): Response {
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': contentType,
      'content-length': String(html.length),
    },
  });
}

function redirectResponse(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

describe('guardedFetchHtml', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
    // Every hostname used in these fixtures resolves to a public address —
    // the guard's own IP-range logic is covered separately in
    // link-preview.ssrf-guard.spec.ts; here we're testing the fetch/redirect
    // orchestration, not DNS, so keep resolution deterministic and offline.
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    mockLookup.mockReset();
  });

  it('fetches and returns the HTML body for a public URL', async () => {
    fetchSpy.mockResolvedValue(htmlResponse('<html><title>Hi</title></html>'));

    const result = await guardedFetchHtml('https://example.com/page');

    expect(result).toEqual({ html: '<html><title>Hi</title></html>' });
  });

  it('fails when the initial host is a private IP literal (SSRF-blocked), without ever calling fetch', async () => {
    const result = await guardedFetchHtml(
      'http://169.254.169.254/latest/meta-data/',
    );

    expect(result).toEqual({ failed: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('follows a redirect to another public host', async () => {
    fetchSpy
      .mockResolvedValueOnce(redirectResponse('https://cdn.example.com/page'))
      .mockResolvedValueOnce(
        htmlResponse('<html><title>Redirected</title></html>'),
      );

    const result = await guardedFetchHtml('https://example.com/short-link');

    expect(result).toEqual({ html: '<html><title>Redirected</title></html>' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('rejects when a public URL redirects to a private IP literal (the actual SSRF bypass vector)', async () => {
    fetchSpy.mockResolvedValueOnce(
      redirectResponse('http://169.254.169.254/latest/meta-data/'),
    );

    const result = await guardedFetchHtml('https://example.com/looks-safe');

    expect(result).toEqual({ failed: true });
    // Only the first (public) hop should ever have been fetched — the redirect
    // target must be re-validated and blocked before a second request is made.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects when a public URL redirects to a hostname that resolves privately', async () => {
    mockLookup
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]) // initial hop: public
      .mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }]); // redirect target: private
    fetchSpy.mockResolvedValueOnce(
      redirectResponse('https://internal.example.com/admin'),
    );

    const result = await guardedFetchHtml('https://example.com/looks-safe');

    expect(result).toEqual({ failed: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-text/html content type', async () => {
    fetchSpy.mockResolvedValue(htmlResponse('{}', 'application/json'));

    const result = await guardedFetchHtml('https://example.com/api');

    expect(result).toEqual({ failed: true });
  });

  it('rejects a response over the size cap via Content-Length', async () => {
    const huge = 'a'.repeat(3 * 1024 * 1024);
    fetchSpy.mockResolvedValue(htmlResponse(huge));

    const result = await guardedFetchHtml('https://example.com/huge');

    expect(result).toEqual({ failed: true });
  });

  it('gives up after exceeding the redirect cap', async () => {
    fetchSpy
      .mockResolvedValueOnce(redirectResponse('https://example.com/1'))
      .mockResolvedValueOnce(redirectResponse('https://example.com/2'))
      .mockResolvedValueOnce(redirectResponse('https://example.com/3'))
      .mockResolvedValueOnce(redirectResponse('https://example.com/4'));

    const result = await guardedFetchHtml('https://example.com/0');

    expect(result).toEqual({ failed: true });
  });
});
