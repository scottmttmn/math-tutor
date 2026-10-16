import { registerPlugin } from '@capacitor/core';
import type { DeviceKeyName, DeviceKeysPlugin, ModelConfig } from '@/types';
import { isGeminiEndpoint } from '@/lib/modelConfig';

// The Android app's API keys, pasted into Settings → Tutor. The native side keeps them encrypted
// (Android Keystore) in storage that Android's backups skip; they never go in the app's own backups.
const DeviceKeys = registerPlugin<DeviceKeysPlugin>('DeviceKeys');

/** The key a provider uses, as on the server: Anthropic, Gemini, or one for every other OpenAI-compatible server. */
export function deviceKeyName(config: ModelConfig): DeviceKeyName | null {
  if (config.provider === 'anthropic') return 'anthropic';
  if (config.provider !== 'openai-compatible') return null;
  return isGeminiEndpoint(config.baseUrl) ? 'gemini' : 'openai';
}

export const DEVICE_KEY_LABELS: Record<DeviceKeyName, string> = {
  anthropic: 'Anthropic API key',
  gemini: 'Gemini API key',
  openai: 'API key (OpenAI, Groq or your server)',
};

export async function getDeviceKey(name: DeviceKeyName): Promise<string | undefined> {
  return (await DeviceKeys.get({ name })).value || undefined;
}

export const setDeviceKey = (name: DeviceKeyName, value: string) => DeviceKeys.set({ name, value });
export const removeDeviceKey = (name: DeviceKeyName) => DeviceKeys.remove({ name });
