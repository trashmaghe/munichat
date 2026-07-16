import { z } from 'zod';
import {
  rmmAgentSummarySchema,
  rmmRemoteControlUrlsSchema,
  type RmmAgentSummary,
  type RmmRemoteControlUrls,
} from '@munichat/shared';
import { apiFetch } from '@/lib/api-client';

export async function fetchRmmAgents(): Promise<RmmAgentSummary[]> {
  const res = await apiFetch<unknown>('/rmm/agents');
  return z.array(rmmAgentSummarySchema).parse(res);
}

// Fetches a fresh, one-time MeshCentral session URL — never cache this
// beyond the immediate window.open() call.
export async function fetchRmmRemoteControlUrls(
  agentId: string,
): Promise<RmmRemoteControlUrls> {
  const res = await apiFetch<unknown>(
    `/rmm/agents/${agentId}/remote-control`,
  );
  return rmmRemoteControlUrlsSchema.parse(res);
}
