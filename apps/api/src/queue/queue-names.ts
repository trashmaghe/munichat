export const QUEUE_NAMES = {
  LINK_PREVIEW: 'link-preview',
} as const;

export interface LinkPreviewJobData {
  messageId: string;
  channelId: string;
  url: string;
}
