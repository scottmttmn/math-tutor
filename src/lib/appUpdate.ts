import { registerPlugin } from '@capacitor/core';
import type { AppUpdatePlugin } from '@/types';
import { APP_BUILD, TABLET_BUILD_URL, TABLET_RELEASE_API } from '@/lib/constants';

// The Android app updating itself: CI publishes each build at one link (TABLET_BUILD_URL) with
// "Build: <run number>" in the release notes; a higher number than this build's is offered.
const AppUpdate = registerPlugin<AppUpdatePlugin>('AppUpdate');

/** The build number in the release notes, or null. */
export function releaseBuild(notes: string | null | undefined): number | null {
  const match = /^Build: (\d+)\s*$/m.exec(notes ?? '');
  return match ? Number(match[1]) : null;
}

/** This build's number, or null for a local build (which is never offered updates). */
export function currentBuild(build: string = APP_BUILD): number | null {
  return /^\d+$/.test(build) ? Number(build) : null;
}

let latest: Promise<number | null> | null = null;

/** The newest published build's number, asked once per app start (null if it can't be read). */
export function latestBuild(): Promise<number | null> {
  latest ??= fetch(TABLET_RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } })
    .then((response) => (response.ok ? response.json() : null))
    .then((release: { body?: string } | null) => releaseBuild(release?.body))
    .catch(() => null);
  return latest;
}

/** Downloads the newest build and opens Android's installer (or, the first time, its permission setting). */
export const installLatest = () => AppUpdate.install({ url: TABLET_BUILD_URL });
