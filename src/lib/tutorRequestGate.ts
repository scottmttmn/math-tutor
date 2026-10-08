import { RATE_LIMIT_MS } from '@/lib/constants';

// Shared by all callers of this server process, which use the same API credentials.
// Multiple server instances will require a shared store for the same guarantee.
export function createTutorRequestGate(now: () => number = Date.now) {
  let active = false;
  let nextAllowedAt = 0;

  return {
    acquire() {
      const remaining = Math.max(0, nextAllowedAt - now());
      if (active || remaining > 0) {
        return {
          accepted: false as const,
          retryAfterSeconds: Math.max(1, Math.ceil(remaining / 1000)),
          message: active ? 'The tutor is already answering. Please wait for it to finish.'
            : 'Please wait a moment before asking the tutor again.',
        };
      }
      active = true;
      nextAllowedAt = now() + RATE_LIMIT_MS;
      let released = false;
      return {
        accepted: true as const,
        release() {
          if (released) return;
          released = true;
          active = false;
        },
      };
    },
  };
}
