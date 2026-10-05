'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ChatGPTStatus } from '@/types';

const DISCONNECTED: ChatGPTStatus = { status: 'disconnected', sharing: false };

async function post(action: 'signIn' | 'cancel' | 'disconnect'): Promise<ChatGPTStatus> {
  const res = await fetch('/api/chatgpt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  return res.json();
}

/** Sign in with ChatGPT state for the Settings modal. Only fetches while `enabled`. */
export function useChatGPTConnection(enabled: boolean) {
  const [status, setStatus] = useState<ChatGPTStatus>(DISCONNECTED);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setIsLoading(true);
    fetch('/api/chatgpt')
      .then((res) => res.json() as Promise<ChatGPTStatus>)
      .then((next) => { if (!cancelled) setStatus(next); })
      .catch((err: unknown) => { if (!cancelled) setStatus({ ...DISCONNECTED, error: String(err) }); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [enabled]);

  const signIn = useCallback(async () => {
    setStatus((prev) => ({ ...prev, status: 'connecting', error: undefined }));
    try {
      setStatus(await post('signIn'));
    } catch (err) {
      setStatus({ ...DISCONNECTED, error: String(err) });
    }
  }, []);

  const cancelSignIn = useCallback(() => {
    void post('cancel').catch(() => undefined);
  }, []);

  const disconnect = useCallback(async () => {
    try {
      setStatus(await post('disconnect'));
    } catch (err) {
      setStatus((prev) => ({ ...prev, error: String(err) }));
    }
  }, []);

  return { status, isLoading, signIn, cancelSignIn, disconnect };
}
