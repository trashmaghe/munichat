import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RmmAgentSummary } from '@munichat/shared';

const REQUEST_TIMEOUT_MS = 10000;

export class RmmUnavailableError extends Error {
  constructor(message = 'Tactical RMM is unreachable') {
    super(message);
    this.name = 'RmmUnavailableError';
  }
}

interface RawAgent {
  agent_id: string;
  hostname: string;
  site_name: string;
  client_name: string;
  plat: string;
  status: string;
}

function toAgentSummary(raw: RawAgent): RmmAgentSummary {
  return {
    agentId: raw.agent_id,
    hostname: raw.hostname,
    siteName: raw.site_name,
    clientName: raw.client_name,
    platform: raw.plat,
    status: raw.status,
  };
}

@Injectable()
export class RmmService {
  constructor(private readonly configService: ConfigService) {}

  private get rmmUrl(): string {
    return this.configService.get<string>('RMM_URL')!;
  }

  private get headers(): Record<string, string> {
    return {
      'X-API-KEY': this.configService.get<string>('RMM_API_KEY')!,
      'Content-Type': 'application/json',
    };
  }

  async listAgents(): Promise<RmmAgentSummary[]> {
    const response = await this.request(() =>
      fetch(`${this.rmmUrl}/agents/?detail=false`, {
        headers: this.headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }),
    );

    if (!response.ok) {
      throw new RmmUnavailableError();
    }

    const body = (await response.json()) as RawAgent[];
    return body.map(toAgentSummary);
  }

  async getAgent(agentId: string): Promise<RmmAgentSummary | null> {
    const response = await this.request(() =>
      fetch(`${this.rmmUrl}/agents/${agentId}/`, {
        headers: this.headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }),
    );

    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new RmmUnavailableError();
    }

    const body = (await response.json()) as RawAgent;
    return toAgentSummary(body);
  }

  private async request(fn: () => Promise<Response>): Promise<Response> {
    try {
      return await fn();
    } catch {
      throw new RmmUnavailableError();
    }
  }
}
