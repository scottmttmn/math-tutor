import type { CapacitorConfig } from '@capacitor/cli';

// The Android app: the static export in out/ (npm run build:android), served from inside the app.
const config: CapacitorConfig = {
  appId: 'com.scottmttmn.mathtutor',
  appName: 'Math Tutor',
  webDir: 'out',
  server: {
    // http://localhost is still a secure context (IndexedDB, pointerrawupdate), and tldraw treats any
    // http origin as development, so it runs without a license key, as it does on the Mac.
    androidScheme: 'http',
  },
};

export default config;
