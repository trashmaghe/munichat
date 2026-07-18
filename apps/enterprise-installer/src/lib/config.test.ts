import { describe, expect, it } from 'vitest';
import {
  buildEnvFile,
  defaultConfig,
  derivedUrls,
  randomPassword,
  randomSecret,
  validate,
  type EnterpriseConfig,
} from './config';

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return out;
}

describe('buildEnvFile', () => {
  it('emits every key the Docker stack and API read, with derived URLs', () => {
    const env = parseEnv(buildEnvFile(defaultConfig()));

    // Derived connection strings point at the compose service names, not localhost.
    expect(env.DATABASE_URL).toMatch(/^postgresql:\/\/elyzian:.+@postgres:5432\/elyzian\?schema=public$/);
    expect(env.REDIS_URL).toBe('redis://redis:6379');
    expect(env.MINIO_ENDPOINT).toBe('minio');

    // A representative key from each required group is present.
    for (const key of [
      'POSTGRES_PASSWORD',
      'MINIO_ROOT_PASSWORD',
      'LDAP_BIND_DN',
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
      'PORT',
      'WEB_ORIGIN',
      'RMM_AUTO_TICKET_SEVERITY',
      'VITE_API_URL',
      'APP_DOMAIN',
      'ELYZIAN_REGISTRY',
      'ELYZIAN_IMAGE_TAG',
    ]) {
      expect(env[key], key).toBeTruthy();
    }
  });

  it('uses HTTPS/WSS origins when the edge is enabled', () => {
    const c: EnterpriseConfig = { ...defaultConfig(), useEdge: true, appDomain: 'chat.gov.br', apiDomain: 'api.gov.br' };
    const env = parseEnv(buildEnvFile(c));
    expect(env.WEB_ORIGIN).toBe('https://chat.gov.br');
    expect(env.VITE_API_URL).toBe('https://api.gov.br');
    expect(env.VITE_WS_URL).toBe('wss://api.gov.br');
  });

  it('falls back to plain HTTP/WS on the API port when the edge is off', () => {
    const c: EnterpriseConfig = { ...defaultConfig(), useEdge: false, appDomain: 'srv01', apiPort: '3000' };
    const urls = derivedUrls(c);
    expect(urls.webOrigin).toBe('http://srv01');
    expect(urls.viteApiUrl).toBe('http://srv01:3000');
    expect(urls.viteWsUrl).toBe('ws://srv01:3000');
  });
});

describe('secrets', () => {
  it('generates distinct, non-trivial secrets', () => {
    expect(randomSecret()).not.toBe(randomSecret());
    expect(randomSecret().length).toBeGreaterThanOrEqual(40);
    expect(randomPassword()).toMatch(/^[A-Za-z0-9]+$/);
    // defaultConfig must not reuse one secret for both JWT slots.
    const c = defaultConfig();
    expect(c.jwtAccessSecret).not.toBe(c.jwtRefreshSecret);
  });
});

describe('validate', () => {
  it('passes a filled-in config', () => {
    const c: EnterpriseConfig = { ...defaultConfig(), ldapBindPassword: 'svc-secret' };
    expect(validate(c)).toEqual({});
  });

  it('flags missing required fields and a bad ACME email', () => {
    const c: EnterpriseConfig = {
      ...defaultConfig(),
      ldapBindPassword: '',
      useEdge: true,
      acmeEmail: 'not-an-email',
    };
    const errors = validate(c);
    expect(errors.ldapBindPassword).toBeTruthy();
    expect(errors.acmeEmail).toBeTruthy();
  });

  it('rejects identical JWT secrets', () => {
    const c: EnterpriseConfig = { ...defaultConfig(), jwtRefreshSecret: 'same', jwtAccessSecret: 'same', ldapBindPassword: 'x' };
    expect(validate(c).jwtRefreshSecret).toBeTruthy();
  });
});
