'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { getBackupStatus, getServerBackupStatus, startAutoBackup, subscribeBackup } from '@/lib/autoBackup';

/** The automatic backup's state, shared by every page; starts the backup on first use. */
export function useBackupStatus() {
  useEffect(() => { startAutoBackup(); }, []);
  return useSyncExternalStore(subscribeBackup, getBackupStatus, getServerBackupStatus);
}
