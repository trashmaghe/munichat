import {
  isPrivateOrReservedIp,
  resolveAndValidateHost,
  validateUrl,
  SsrfBlockedError,
} from './link-preview.ssrf-guard';

const mockLookup = jest.fn<
  Promise<Array<{ address: string; family: number }>>,
  unknown[]
>();
jest.mock('node:dns/promises', () => ({
  lookup: (...args: unknown[]) => mockLookup(...args),
}));

beforeEach(() => {
  mockLookup.mockReset();
});

describe('isPrivateOrReservedIp', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['10.1.2.3', 'private 10/8'],
    ['172.16.0.5', 'private 172.16/12'],
    ['172.31.255.255', 'private 172.16/12 upper bound'],
    ['192.168.1.1', 'private 192.168/16'],
    ['169.254.169.254', 'link-local / cloud metadata endpoint'],
    ['0.0.0.0', 'reserved'],
    ['224.0.0.1', 'multicast'],
    ['::1', 'IPv6 loopback'],
    ['fe80::1', 'IPv6 link-local'],
    ['fc00::1', 'IPv6 unique local'],
  ])('rejects %s (%s)', (ip) => {
    expect(isPrivateOrReservedIp(ip)).toBe(true);
  });

  it.each([
    ['8.8.8.8', 'public'],
    ['1.1.1.1', 'public'],
    ['172.32.0.1', 'just outside the 172.16/12 private range'],
  ])('accepts %s (%s)', (ip) => {
    expect(isPrivateOrReservedIp(ip)).toBe(false);
  });

  it('treats an unparseable value as unsafe', () => {
    expect(isPrivateOrReservedIp('not-an-ip')).toBe(true);
  });
});

describe('resolveAndValidateHost', () => {
  it('rejects the literal cloud metadata IP with no DNS lookup needed', async () => {
    await expect(resolveAndValidateHost('169.254.169.254')).rejects.toThrow(
      SsrfBlockedError,
    );
  });

  it('rejects "localhost" by name', async () => {
    await expect(resolveAndValidateHost('localhost')).rejects.toThrow(
      SsrfBlockedError,
    );
  });

  it('rejects a hostname that resolves to a private address', async () => {
    mockLookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);

    await expect(
      resolveAndValidateHost('internal.example.com'),
    ).rejects.toThrow(SsrfBlockedError);
  });

  it('rejects when any of several resolved addresses is private', async () => {
    mockLookup.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '192.168.1.1', family: 4 },
    ]);

    await expect(resolveAndValidateHost('mixed.example.com')).rejects.toThrow(
      SsrfBlockedError,
    );
  });

  it('accepts a hostname that resolves only to public addresses', async () => {
    mockLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);

    await expect(
      resolveAndValidateHost('public.example.com'),
    ).resolves.toBeUndefined();
  });

  it('bypasses the guard when allowPrivateHosts is explicitly true (e2e-only escape hatch)', async () => {
    await expect(
      resolveAndValidateHost('127.0.0.1', { allowPrivateHosts: true }),
    ).resolves.toBeUndefined();
  });
});

describe('validateUrl', () => {
  it('rejects a non-http(s) protocol', async () => {
    await expect(validateUrl(new URL('file:///etc/passwd'))).rejects.toThrow(
      SsrfBlockedError,
    );
  });

  it('rejects a redirect-style URL pointing at a private IP even with a public-looking hostname resolution bypassed via option', async () => {
    await expect(
      validateUrl(new URL('http://169.254.169.254/latest/meta-data/')),
    ).rejects.toThrow(SsrfBlockedError);
  });
});
