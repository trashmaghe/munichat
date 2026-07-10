export const ChannelType = {
  DEPARTMENT: 'DEPARTMENT',
  GENERAL: 'GENERAL',
  GROUP: 'GROUP',
  DM: 'DM',
} as const;
export type ChannelType = (typeof ChannelType)[keyof typeof ChannelType];

export const MemberRole = {
  MEMBER: 'MEMBER',
  ADMIN: 'ADMIN',
} as const;
export type MemberRole = (typeof MemberRole)[keyof typeof MemberRole];

export const MessageType = {
  TEXT: 'TEXT',
  FILE: 'FILE',
  SYSTEM: 'SYSTEM',
  TICKET: 'TICKET',
} as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export const LinkPreviewStatus = {
  READY: 'READY',
  FAILED: 'FAILED',
} as const;
export type LinkPreviewStatus =
  (typeof LinkPreviewStatus)[keyof typeof LinkPreviewStatus];
