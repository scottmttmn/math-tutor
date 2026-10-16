import { CapacitorHttp, registerPlugin } from '@capacitor/core';
import { ChatGPTError, createChatGPT, setRemoteFetch } from '@/lib/siwc';
import type { CallbackListener, ChatGPTClient, CredentialStore } from '@/lib/siwc';
import type { ChatGPTSignInPlugin, DeviceKeysPlugin } from '@/types';

// Sign in with ChatGPT in the Android app: OpenAI's SDK (src/lib/siwc) running in the WebView,
// with the tablet's own pieces in place of the computer's. The browser comes back to a listener
// on 127.0.0.1 (ChatGPTSignInPlugin.java), and the connection is kept encrypted by DeviceKeys,
// like the API keys and out of every backup.
const SignIn = registerPlugin<ChatGPTSignInPlugin>('ChatGPTSignIn');
const DeviceKeys = registerPlugin<DeviceKeysPlugin>('DeviceKeys');

// The same port as on the Mac: the callback is registered with ChatGPT on first sign-in.
const REDIRECT_PORT = 8791;
const AUTH_ORIGIN = 'https://auth.openai.com';

/**
 * Sign-in requests (discovery, keys, tokens, revocation) go through Android's own HTTP client,
 * since a web page can't count on auth.openai.com accepting it; requests to api.openai.com stay in
 * the WebView, which streams replies.
 */
const deviceFetch: typeof fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (new URL(url).origin !== AUTH_ORIGIN) return fetch(input, init);
  const signal = init.signal ?? undefined;
  signal?.throwIfAborted();
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, name) => { headers[name] = value; });
  const request = CapacitorHttp.request({
    url,
    method: init.method ?? 'GET',
    headers,
    ...(init.body !== undefined && init.body !== null ? { data: String(init.body) } : {}),
    responseType: 'text',
    disableRedirects: true,
    connectTimeout: 15_000,
    readTimeout: 30_000,
  });
  const aborted = new Promise<never>((_, reject) => {
    signal?.addEventListener('abort', () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError')), { once: true });
  });
  const response = await Promise.race([request, aborted]);
  const body = typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? null);
  return new Response(response.status === 204 || response.status === 304 ? null : body, { status: response.status, headers: response.headers });
};

interface SavedConnection {
  hostId: string;
  state?: Awaited<ReturnType<CredentialStore['read']>>;
}

/** The connection as one encrypted value; the lock only has to cover this page. */
function deviceStore(): CredentialStore {
  let queue: Promise<unknown> = Promise.resolve();
  const load = async (): Promise<SavedConnection> => {
    const { value } = await DeviceKeys.get({ name: 'chatgpt' });
    if (!value) return { hostId: crypto.randomUUID() };
    try {
      return JSON.parse(value) as SavedConnection;
    } catch {
      throw new ChatGPTError('storage_invalid', 'The saved ChatGPT connection could not be read. Sign in again.');
    }
  };
  const save = (saved: SavedConnection) => DeviceKeys.set({ name: 'chatgpt', value: JSON.stringify(saved) });
  return {
    withLock(operation, signal) {
      const run = queue.then(() => {
        signal?.throwIfAborted();
        return operation();
      });
      queue = run.catch(() => undefined);
      return run;
    },
    async read() { return (await load()).state; },
    async write(state) { await save({ ...(await load()), state }); },
    async getHostId() {
      const saved = await load();
      if (!saved.state) await save(saved);
      return saved.hostId;
    },
  };
}

const listenForCallback: CallbackListener = async (port, state, signal) => {
  const { redirectUri } = await SignIn.listen({ port, state }).catch(() => {
    throw new ChatGPTError('callback_port_unavailable', 'The sign-in port is unavailable. Close the app and try again.');
  });
  const close = () => { void SignIn.close().catch(() => undefined); };
  const result = new Promise<URLSearchParams>((resolve, reject) => {
    const abort = () => {
      close();
      reject(new ChatGPTError('cancelled', 'Sign-in was cancelled.'));
    };
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    SignIn.waitForCallback().then(({ query }) => {
      signal.removeEventListener('abort', abort);
      resolve(new URLSearchParams(query));
    }, () => {
      signal.removeEventListener('abort', abort);
      reject(new ChatGPTError('callback_failed', 'The sign-in listener stopped. Please try again.'));
    });
  });
  return { redirectUri, close, result };
};

let client: ChatGPTClient | undefined;

/** The tablet's one Sign in with ChatGPT client. */
export function getDeviceChatGPT(): ChatGPTClient {
  if (!client) {
    setRemoteFetch(deviceFetch);
    client = createChatGPT({
      appName: 'Math Tutor',
      appId: 'math-tutor',
      redirectPort: REDIRECT_PORT,
      store: deviceStore(),
      listenForCallback,
      openBrowser: async (url) => {
        await SignIn.openBrowser({ url }).catch(() => {
          throw new ChatGPTError('browser_unavailable', 'The browser could not be opened. Check that a browser is installed and try again.');
        });
      },
    });
  }
  return client;
}
