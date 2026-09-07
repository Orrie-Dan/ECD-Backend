export function formatDeliveryError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

export function formatSmtpError(err: unknown): { message: string; response?: string } {
  const message = formatDeliveryError(err);
  const response =
    err && typeof err === 'object' && 'response' in err
      ? String((err as { response?: string }).response)
      : undefined;
  return { message, response };
}
