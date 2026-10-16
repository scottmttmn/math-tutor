import type { TutorRequest } from '@/types';

/** The Android build (BUILD_TARGET=android, see next.config.ts) calls the providers itself. */
export const TUTOR_DIRECT = process.env.NEXT_PUBLIC_TUTOR_DIRECT === '1';

/** One tutor request, answered with the SSE stream of /api/tutor, from the server or, in the Android app, from the tablet. */
export function requestTutor(body: TutorRequest, signal: AbortSignal): Promise<Response> {
  if (TUTOR_DIRECT) return import('@/lib/tutorDirect').then(({ directTutorResponse }) => directTutorResponse(body));
  return fetch('/api/tutor', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
