import { isIP } from 'node:net';
import * as dnsPromises from 'node:dns/promises';

export class SsrfBlockedError extends Error {
  constructor(target: string) {
    super(`Refusing to fetch a private/reserved address: ${target}`);
    this.name = 'SsrfBlockedError';
  }
}

const IPV4_PRIVATE_RANGES: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (covers the cloud metadata endpoint)
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved
];

function ipv4ToInt(ip: string): number {
  return (
    ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0
  );
}

function isPrivateIPv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  return IPV4_PRIVATE_RANGES.some(([base, prefix]) => {
    const baseValue = ipv4ToInt(base);
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (value & mask) === (baseValue & mask);
  });
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1') return true; // loopback
  if (normalized === '::') return true;
  if (normalized.startsWith('fe80:')) return true; // link-local
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique local (fc00::/7)
  if (normalized.startsWith('::ffff:')) {
    // IPv4-mapped IPv6 address, e.g. ::ffff:169.254.169.254
    const mapped = normalized.split(':').pop()!;
    if (isIP(mapped) === 4) return isPrivateIPv4(mapped);
  }
  return false;
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return true; // not a recognizable IP literal at all — treat as unsafe
}

export interface SsrfGuardOptions {
  allowPrivateHosts?: boolean;
}

export async function resolveAndValidateHost(
  hostname: string,
  options: SsrfGuardOptions = {},
): Promise<void> {
  if (
    options.allowPrivateHosts ??
    process.env.LINK_PREVIEW_ALLOW_PRIVATE_HOSTS === 'true'
  ) {
    return;
  }

  if (hostname.toLowerCase() === 'localhost') {
    throw new SsrfBlockedError(hostname);
  }

  const version = isIP(hostname);
  if (version !== 0) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new SsrfBlockedError(hostname);
    }
    return;
  }

  const records = await dnsPromises.lookup(hostname, { all: true });
  if (records.length === 0) {
    throw new SsrfBlockedError(hostname);
  }
  for (const record of records) {
    if (isPrivateOrReservedIp(record.address)) {
      throw new SsrfBlockedError(`${hostname} -> ${record.address}`);
    }
  }
}

export async function validateUrl(
  url: URL,
  options: SsrfGuardOptions = {},
): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfBlockedError(url.toString());
  }
  await resolveAndValidateHost(url.hostname, options);
}
