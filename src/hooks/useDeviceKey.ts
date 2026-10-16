'use client';

import { useCallback, useEffect, useState } from 'react';
import { getDeviceKey, removeDeviceKey, setDeviceKey } from '@/lib/deviceKeys';
import type { DeviceKeyName } from '@/types';

/** Whether the Android app has a key saved for `name` (never the key itself), and saving or removing it. */
export function useDeviceKey(name: DeviceKeyName | null) {
  // What was read, for which key: a different provider reads as unknown until its own read lands.
  const [read, setRead] = useState<{ name: DeviceKeyName; saved: boolean; error?: string } | null>(null);
  const current = read && read.name === name ? read : null;

  useEffect(() => {
    if (!name) return;
    let cancelled = false;
    getDeviceKey(name)
      .then((value) => { if (!cancelled) setRead({ name, saved: Boolean(value) }); })
      .catch(() => { if (!cancelled) setRead({ name, saved: false, error: 'Could not read the saved key.' }); });
    return () => { cancelled = true; };
  }, [name]);

  const save = useCallback(async (value: string) => {
    if (!name) return;
    await setDeviceKey(name, value);
    setRead({ name, saved: true });
  }, [name]);

  const remove = useCallback(async () => {
    if (!name) return;
    try {
      await removeDeviceKey(name);
      setRead({ name, saved: false });
    } catch {
      setRead({ name, saved: true, error: 'Could not remove the key.' });
    }
  }, [name]);

  return { saved: current?.saved ?? null, error: current?.error ?? null, save, remove };
}
