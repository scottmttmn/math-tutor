export const GEMINI_MODELS = [
  'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash',
  'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite',
];

export function isQuotaError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 429;
}

function nextPacificMidnight(now: number): number {
  const date = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles' });
  const today = date.format(now);
  // Pacific midnight is an integral UTC hour, including across daylight saving changes.
  let reset = Math.ceil((now + 1) / 3_600_000) * 3_600_000;
  while (date.format(reset) === today) reset += 3_600_000;
  return reset;
}

export function createGeminiFallback(now = Date.now) {
  const blockedUntil = new Map<string, number>();
  return {
    candidates(preferred: string) {
      const index = GEMINI_MODELS.indexOf(preferred);
      const models = index < 0 ? [preferred] : GEMINI_MODELS.slice(index);
      return models.filter((model) => (blockedUntil.get(model) ?? 0) <= now());
    },
    exhausted(model: string, error: unknown) {
      let message = error instanceof Error ? error.message : String(error);
      if (typeof error === 'object' && error !== null && 'error' in error) {
        try { message += JSON.stringify(error.error); } catch { /* Use the provider message. */ }
      }
      const daily = /perday|per.day|daily|\bRPD\b/i.test(message);
      blockedUntil.set(model, daily ? nextPacificMidnight(now()) : now() + 60_000);
    },
  };
}
