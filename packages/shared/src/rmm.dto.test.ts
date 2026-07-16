import { describe, expect, it } from 'vitest';
import {
  rmmAgentSummarySchema,
  rmmAlertWebhookSchema,
  rmmRemoteControlUrlsSchema,
} from './rmm.dto';

describe('rmmAgentSummarySchema', () => {
  it('accepts a valid agent summary', () => {
    const result = rmmAgentSummarySchema.parse({
      agentId: 'a1b2',
      hostname: 'PC-PREFEITURA-12',
      siteName: 'Sede',
      clientName: 'Prefeitura de Nova Serrana',
      platform: 'windows',
      status: 'online',
    });
    expect(result.hostname).toBe('PC-PREFEITURA-12');
  });
});

describe('rmmAlertWebhookSchema', () => {
  const base = {
    alertId: 'alert-1',
    hostname: 'PC-PREFEITURA-12',
    client: 'Prefeitura de Nova Serrana',
    site: 'Sede',
    severity: 'error' as const,
    message: 'Agent has not checked in for 30 minutes',
    resolved: false,
  };

  it('accepts a valid unresolved alert payload', () => {
    const result = rmmAlertWebhookSchema.parse(base);
    expect(result.severity).toBe('error');
    expect(result.resolved).toBe(false);
  });

  it('accepts a valid resolved alert payload', () => {
    const result = rmmAlertWebhookSchema.parse({ ...base, resolved: true });
    expect(result.resolved).toBe(true);
  });

  it('rejects an invalid severity', () => {
    expect(() =>
      rmmAlertWebhookSchema.parse({ ...base, severity: 'critical' }),
    ).toThrow();
  });

  it('rejects an empty alertId', () => {
    expect(() =>
      rmmAlertWebhookSchema.parse({ ...base, alertId: '' }),
    ).toThrow();
  });

  it('rejects a missing resolved flag', () => {
    const withoutResolved: Record<string, unknown> = { ...base };
    delete withoutResolved.resolved;
    expect(() => rmmAlertWebhookSchema.parse(withoutResolved)).toThrow();
  });
});

describe('rmmRemoteControlUrlsSchema', () => {
  it('accepts a valid set of control URLs', () => {
    const result = rmmRemoteControlUrlsSchema.parse({
      desktopUrl: 'https://mesh.example.org/control?login=token',
      terminalUrl: 'https://mesh.example.org/terminal?login=token',
      fileUrl: 'https://mesh.example.org/files?login=token',
    });
    expect(result.desktopUrl).toContain('control');
  });

  it('rejects a payload missing a required URL', () => {
    expect(() =>
      rmmRemoteControlUrlsSchema.parse({
        desktopUrl: 'https://mesh.example.org/control?login=token',
        terminalUrl: 'https://mesh.example.org/terminal?login=token',
      }),
    ).toThrow();
  });
});
