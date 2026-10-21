'use client';

import { useCallback, useEffect, useState } from 'react';
import { currentBuild, installLatest, latestBuild } from '@/lib/appUpdate';
import { TUTOR_DIRECT } from '@/lib/tutorRequest';

export type AppUpdateState = 'idle' | 'downloading' | 'allow' | 'opened' | 'failed';

/**
 * In the Android app built by CI: whether a newer build is published, and installing it.
 * 'allow' means Android's "install unknown apps" setting was opened; Update works once it's on.
 */
export function useAppUpdate() {
  const build = TUTOR_DIRECT ? currentBuild() : null;
  const [newer, setNewer] = useState<number | null>(null);
  const [state, setState] = useState<AppUpdateState>('idle');

  useEffect(() => {
    if (build === null) return;
    let live = true;
    void latestBuild().then((latest) => { if (live && latest !== null && latest > build) setNewer(latest); });
    return () => { live = false; };
  }, [build]);

  const install = useCallback(() => {
    setState('downloading');
    installLatest().then(
      ({ permission }) => setState(permission ? 'opened' : 'allow'),
      () => setState('failed'),
    );
  }, []);

  return { build, newer, state, install };
}
