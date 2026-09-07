export interface SendMailPayload {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailSendContext {
  entityType?: string;
  entityId?: string;
  userId?: string;
}

export interface EmailSendResult {
  sent: boolean;
  skipped?: boolean;
  reason?: string;
}
