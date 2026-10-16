'use client';

import { useCallback, useEffect, useState } from 'react';
import { chatgptRequest } from '@/lib/chatgptConnection';
import type { ChatGPTStatus } from '@/types';

const DISCONNECTED: ChatGPTStatus = { status: 'disconnected', sharing: false };

/** Sign in with ChatGPT state for the Settings modal. Only fetches while `enabled`. */
export function useChatGPTConnection(enabled: boolean) {
  const [status, setStatus] = useState<ChatGPTStatus>(DISCONNECTED);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setIsLoading(true);
    chatgptRequest()
      .then((next) => { if (!cancelled) setStatus(next); })
      .catch((err: unknown) => { if (!cancelled) setStatus({ ...DISCONNECTED, error: String(err) }); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [enabled]);

  const signIn = useCallback(async () => {
    setStatus((prev) => ({ ...prev, status: 'connecting', error: undefined }));
    try {
      setStatus(await chatgptRequest('signIn'));
    } catch (err) {
      setStatus({ ...DISCONNECTED, error: String(err) });
    }
  }, []);

  const cancelSignIn = useCallback(() => {
    void chatgptRequest('cancel').catch(() => undefined);
  }, []);

  const disconnect = useCallback(async () => {
    try {
      setStatus(await chatgptRequest('disconnect'));
    } catch (err) {
      setStatus((prev) => ({ ...prev, error: String(err) }));
    }
  }, []);

  return { status, isLoading, signIn, cancelSignIn, disconnect };
}
