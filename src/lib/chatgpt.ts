import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AsyncEntry } from '@napi-rs/keyring';
import { createChatGPT } from '@/lib/siwc';
import type { ChatGPTClient, CredentialEncryption } from '@/lib/siwc';

const APP_NAME = 'Math Tutor';
const APP_ID = 'math-tutor';
const KEYRING_SERVICE = 'math-tutor';
const KEYRING_ACCOUNT = 'chatgpt-credential-key';
// The sign-in callback URL is registered with ChatGPT on first sign-in, so the
// port must stay the same across restarts.
const REDIRECT_PORT = Number(process.env.CHATGPT_REDIRECT_PORT ?? 8791);

/**
 * Encrypts saved ChatGPT tokens with AES-256-GCM. The key is random per machine
 * and lives in the OS credential store (macOS Keychain, Windows Credential
 * Manager, Linux Secret Service), so tokens on disk are useless without it.
 */
function createKeyringEncryption(): CredentialEncryption {
  const entry = new AsyncEntry(KEYRING_SERVICE, KEYRING_ACCOUNT);
  let keyPromise: Promise<Buffer> | undefined;

  const getKey = () => {
    keyPromise ??= (async () => {
      const saved = await entry.getPassword();
      if (saved) return Buffer.from(saved, 'base64');
      const key = randomBytes(32);
      await entry.setPassword(key.toString('base64'));
      return key;
    })().catch((error: unknown) => {
      keyPromise = undefined;
      throw error;
    });
    return keyPromise;
  };

  return {
    id: 'math-tutor-keyring-aes-gcm-v1',
    async isAvailable() {
      try {
        await getKey();
        return true;
      } catch {
        return false;
      }
    },
    async encrypt(plaintext) {
      const key = await getKey();
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return new Uint8Array(Buffer.concat([iv, cipher.getAuthTag(), body]));
    },
    async decrypt(ciphertext) {
      const key = await getKey();
      const data = Buffer.from(ciphertext);
      const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      decipher.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}

// Next's dev server re-evaluates modules on reload; keep one client per process
// so a sign-in in progress isn't orphaned.
const globalForChatGPT = globalThis as unknown as { mathTutorChatGPT?: ChatGPTClient };

export function getChatGPT(): ChatGPTClient {
  globalForChatGPT.mathTutorChatGPT ??= createChatGPT({
    appName: APP_NAME,
    appId: APP_ID,
    redirectPort: REDIRECT_PORT,
    credentialEncryption: createKeyringEncryption(),
  });
  return globalForChatGPT.mathTutorChatGPT;
}
