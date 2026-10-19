import test from 'node:test';
import assert from 'node:assert/strict';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import load from './load-typescript.mjs';

// The Sign in with ChatGPT SDK with its platform pieces swapped for fakes, the way the Android
// app runs it: an in-memory store, a listener that hands back the callback, and a fetch that
// stands in for auth.openai.com and api.openai.com.
const ISSUER = 'https://auth.openai.com';

async function fakeOpenAI() {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const calls = [];
  let nonce;
  let refreshCount = 0;
  const idToken = (extra = {}) => new SignJWT({ email: 'learner@example.com', ...extra })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(ISSUER).setAudience('client-123')
    .setSubject('user-1').setIssuedAt().setExpirationTime('1h').sign(privateKey);
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetch = async (url, init = {}) => {
    const body = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {}, body });
    switch (String(url)) {
      case `${ISSUER}/.well-known/openid-configuration`:
        return json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/oauth/token`, revocation_endpoint: `${ISSUER}/oauth/revoke`, jwks_uri: `${ISSUER}/jwks` });
      case `${ISSUER}/jwks`:
        return json({ keys: [jwk] });
      case `${ISSUER}/oauth/token`:
        if (body.grant_type === 'authorization_code') {
          return json({ access_token: 'access-1', refresh_token: 'refresh-1', token_type: 'Bearer', expires_in: 3600,
            scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct', id_token: await idToken({ nonce }) });
        }
        refreshCount += 1;
        return json({ access_token: `access-${refreshCount + 1}`, refresh_token: `refresh-${refreshCount + 1}`, token_type: 'Bearer', expires_in: 3600, id_token: await idToken() });
      case `${ISSUER}/oauth/revoke`:
        return new Response(null, { status: 200 });
      case 'https://api.openai.com/v1/models':
        return json({ models: [{ slug: 'gpt-sol', display_name: 'Sol', visibility: 'list' }] });
      case 'https://api.openai.com/v1/responses':
        return new Response([
          'data: {"type":"response.output_text.delta","delta":"Try "}\n\n',
          'data: {"type":"response.output_text.delta","delta":"factoring."}\n\n',
          'data: {"type":"response.completed","response":{"usage":{"input_tokens":12,"output_tokens":13,"output_tokens_details":{"reasoning_tokens":10}}}}\n\n',
        ].join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });
      default:
        return json({ error: 'not_found' }, 404);
    }
  };
  return { fetch, calls, setNonce: (value) => { nonce = value; } };
}

function memoryStore() {
  let saved;
  let queue = Promise.resolve();
  return {
    withLock(operation) { const run = queue.then(operation); queue = run.catch(() => undefined); return run; },
    async read() { return saved && structuredClone(saved); },
    async write(state) { saved = structuredClone(state); },
    async getHostId() { return 'host-1'; },
    peek: () => saved,
  };
}

test('signs in through the loopback callback, lists models, streams a reply, refreshes and signs out', async () => {
  const sdk = load('src/lib/siwc/index.ts');
  const openai = await fakeOpenAI();
  sdk.setRemoteFetch(openai.fetch);
  const store = memoryStore();
  let deliver;
  const chatgpt = sdk.createChatGPT({
    appName: 'Math Tutor', appId: 'math-tutor', redirectPort: 8791, store,
    // The browser comes back to the loopback with the code, the state and the new client id.
    listenForCallback: async (port, state) => ({
      redirectUri: `http://127.0.0.1:${port}/auth/callback`,
      close() {},
      result: new Promise((resolve) => { deliver = () => resolve(new URLSearchParams({ code: 'code-1', state, client_id: 'client-123' })); }),
    }),
    openBrowser: (url) => {
      openai.authorization = new URL(url);
      openai.setNonce(openai.authorization.searchParams.get('nonce'));
      deliver();
    },
  });

  const session = await chatgpt.signIn({ reconsent: true });
  assert.equal(session.status, 'connected');
  assert.equal(session.sharing, true);
  assert.equal(session.identity.email, 'learner@example.com');
  const authorization = openai.authorization.searchParams;
  assert.equal(authorization.get('redirect_uri'), 'http://127.0.0.1:8791/auth/callback');
  assert.equal(authorization.get('code_challenge_method'), 'S256');
  assert.match(authorization.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
  assert.match(authorization.get('state'), /^[A-Za-z0-9_-]{43}$/);
  const exchange = openai.calls.find((call) => call.body?.grant_type === 'authorization_code');
  // The verifier hashes to the challenge sent to the browser (PKCE S256).
  const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(exchange.body.code_verifier))).toString('base64url');
  assert.equal(digest, authorization.get('code_challenge'));
  assert.equal(exchange.body.client_id, 'client-123');

  assert.deepEqual(await chatgpt.listModels(), [{ slug: 'gpt-sol', displayName: 'Sol' }]);
  let text = '';
  const reply = await chatgpt.streamResponse({ model: 'gpt-sol', input: 'Help', onDelta: (delta) => { text += delta; } });
  assert.equal(text, 'Try factoring.');
  assert.deepEqual(reply.usage, { inputTokens: 12, outputTokens: 13, reasoningTokens: 10 });
  assert.equal(openai.calls.at(-1).headers.authorization, 'Bearer access-1');

  // An access token about to expire is refreshed before the request.
  const saved = store.peek();
  saved.profiles[0].credentials.expiresAt = Date.now() + 30_000;
  await chatgpt.listModels();
  assert.equal(openai.calls.at(-1).headers.authorization, 'Bearer access-2');

  await chatgpt.disconnect();
  assert.equal((await chatgpt.getSession()).status, 'disconnected');
  assert.equal(openai.calls.at(-1).body.token, 'refresh-2');
  assert.equal(store.peek().profiles[0].credentials, undefined);
});

test('the Node loopback ignores other requests and hands back the matching callback', async () => {
  const { listenForCallback } = load('src/lib/siwc/loopback.ts');
  const abort = new AbortController();
  const listener = await listenForCallback(0, 'expected-state', abort.signal);
  try {
    const port = new URL(listener.redirectUri).port;
    assert.match(listener.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
    assert.equal((await fetch(`http://127.0.0.1:${port}/other`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/auth/callback?state=wrong&code=x`)).status, 400);
    const page = await fetch(`http://127.0.0.1:${port}/auth/callback?state=expected-state&code=code-1&client_id=client-123`);
    assert.equal(page.status, 200);
    const params = await listener.result;
    assert.equal(params.get('code'), 'code-1');
  } finally {
    listener.close();
  }
});

test('callback parameters: errors and missing registrations are refused', () => {
  const { callbackResult } = load('src/lib/siwc/oauth.ts');
  assert.deepEqual(callbackResult(new URLSearchParams({ code: 'c', client_id: 'client-1' }), undefined), { code: 'c', clientId: 'client-1' });
  assert.deepEqual(callbackResult(new URLSearchParams({ code: 'c' }), 'saved-1'), { code: 'c', clientId: 'saved-1' });
  assert.throws(() => callbackResult(new URLSearchParams({ error: 'access_denied' }), undefined), /Sign-in was not completed/);
  assert.throws(() => callbackResult(new URLSearchParams({ code: 'c' }), undefined), /did not complete app registration/);
  assert.throws(() => callbackResult(new URLSearchParams({ code: 'c', client_id: 'other' }), 'saved-1'), /did not complete app registration/);
});
