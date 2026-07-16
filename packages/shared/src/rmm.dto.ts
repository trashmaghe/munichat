import { z } from 'zod';

export const rmmAgentSummarySchema = z.object({
  agentId: z.string(),
  hostname: z.string(),
  siteName: z.string(),
  clientName: z.string(),
  platform: z.string(),
  status: z.string(),
});

export type RmmAgentSummary = z.infer<typeof rmmAgentSummarySchema>;

export const rmmAlertSeveritySchema = z.enum(['info', 'warning', 'error']);

export type RmmAlertSeverity = z.infer<typeof rmmAlertSeveritySchema>;

// Tactical RMM's own webhook body is a JSON template authored in the Alert
// Template UI (it substitutes {{ }} variables into whatever shape you write),
// so this schema is the contract MuniChat expects that template to produce —
// not something Tactical RMM defines for us.
export const rmmAlertWebhookSchema = z.object({
  alertId: z.string().min(1),
  hostname: z.string().min(1),
  client: z.string().min(1),
  site: z.string().min(1),
  severity: rmmAlertSeveritySchema,
  message: z.string().min(1),
  resolved: z.boolean(),
});

export type RmmAlertWebhookPayload = z.infer<typeof rmmAlertWebhookSchema>;

// The desktop URL carries a live, one-time MeshCentral login token — treat it
// like a bearer credential (never logged, never persisted, never broadcast).
export const rmmRemoteControlUrlsSchema = z.object({
  desktopUrl: z.string(),
  terminalUrl: z.string(),
  fileUrl: z.string(),
});

export type RmmRemoteControlUrls = z.infer<typeof rmmRemoteControlUrlsSchema>;
