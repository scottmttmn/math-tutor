// Modified for Math Tutor from OpenAI's Sign in with ChatGPT DevKit
// (github.com/openai/sign-in-with-chatgpt-devkit @ f723814, packages/local/src).
// Changes: relative imports drop the .js suffix so Next's bundler resolves them;
// runs in a browser as well as Node (the Android app signs in from its WebView):
// random values and the PKCE hash use Web Crypto instead of node:crypto, the
// loopback listener and the browser opener moved to ./loopback (Node) and come in
// through ChatGPTConfig, and checking the callback's parameters is callbackResult.
// Licensed under the Sign-in with ChatGPT DevKit Noncommercial License v1.0; see ./LICENSE.

import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import { apiError, ChatGPTError, fetchRemote, isObject, jsonResponse } from "./errors";
import type { ChatGPTConfig, PendingRefresh, StoredConnection, StoredCredentials } from "./types";

const ISSUER = "https://auth.openai.com";
const RESOURCE = "https://api.openai.com/v1";
const SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
export const CALLBACK_PATH = "/auth/callback";
const base64url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const randomValue = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
const sha256 = async (text: string) => base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint?: string;
  jwks_uri: string;
}

let discoveryPromise: Promise<Discovery> | undefined;
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

async function discovery(): Promise<Discovery> {
  discoveryPromise ??= (async () => {
    const response = await fetchRemote(`${ISSUER}/.well-known/openid-configuration`);
    const data = await jsonResponse(response);
    if (!response.ok || !isObject(data) || data.issuer !== ISSUER) {
      throw new ChatGPTError("discovery_failed", "ChatGPT sign-in configuration could not be verified.", true);
    }
    for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri", "revocation_endpoint"]) {
      const value = data[key];
      if (key === "revocation_endpoint" && value === undefined) continue;
      if (typeof value !== "string" || new URL(value).origin !== ISSUER) {
        throw new ChatGPTError("discovery_failed", "ChatGPT sign-in configuration could not be verified.", true);
      }
    }
    return data as unknown as Discovery;
  })().catch((error: unknown) => {
    discoveryPromise = undefined;
    throw error;
  });
  return discoveryPromise;
}

export const identityVerificationUnavailable = () => new ChatGPTError("identity_verification_unavailable", "ChatGPT identity verification is temporarily unavailable. Your connection has been preserved. Try again shortly.", true);

async function verifyIdentity(idToken: string, clientId: string, nonce?: string, receivedAt?: number) {
  const config = await discovery().catch(() => { throw identityVerificationUnavailable(); });
  let keys = keySets.get(config.jwks_uri);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(config.jwks_uri), {
      timeoutDuration: 15_000,
      // Classify failures at the retrieval boundary, before JOSE verifies the
      // token. An unavailable key service does not establish an invalid identity.
      [customFetch]: async (url, options) => {
        try {
          const response = await fetchRemote(url, options, 15_000);
          if (response.status !== 200) throw identityVerificationUnavailable();
          const body = await jsonResponse(response);
          if (!isObject(body) || !Array.isArray(body.keys)) throw identityVerificationUnavailable();
          return Response.json(body);
        } catch { throw identityVerificationUnavailable(); }
      },
    });
    keySets.set(config.jwks_uri, keys);
  }
  try {
    const resolver = keys;
    const { payload } = await jwtVerify(idToken, async (header, token) => {
      try { return await resolver(header, token); }
      catch {
        // Missing/temporarily malformed keys are a provider availability issue.
        // Invalidate the resolver so a transient empty set is not held through
        // its normal cooldown. Signature and claims failures happen afterward.
        if (keySets.get(config.jwks_uri) === resolver) keySets.delete(config.jwks_uri);
        throw identityVerificationUnavailable();
      }
    }, {
      issuer: config.issuer,
      audience: clientId,
      algorithms: ["RS256"],
      clockTolerance: 5,
      requiredClaims: ["iss", "aud", "exp", "iat", "sub"],
      // The encrypted checkpoint records when this response was received. An
      // outage may outlast its ID token, without invalidating its refresh token.
      ...(receivedAt === undefined ? {} : { currentDate: new Date(receivedAt) }),
    });
    if (typeof payload.sub !== "string" || !payload.sub ||
        (nonce !== undefined && payload.nonce !== nonce) ||
        (payload.azp !== undefined && payload.azp !== clientId) ||
        (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)) {
      throw new Error("invalid identity");
    }
    return {
      subject: payload.sub,
      identity: {
        ...(typeof payload.name === "string" ? { name: payload.name } : {}),
        ...(typeof payload.email === "string" ? { email: payload.email } : {}),
      },
    };
  } catch (error) {
    if (error instanceof ChatGPTError && error.code === "identity_verification_unavailable") throw error;
    throw new ChatGPTError("invalid_id_token", "The ChatGPT identity could not be verified. Please sign in again.");
  }
}

async function tokenRequest(body: URLSearchParams, signal: AbortSignal): Promise<Record<string, unknown>> {
  const config = await discovery();
  signal.throwIfAborted();
  const response = await fetchRemote(config.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
    signal,
  });
  const data = await jsonResponse(response);
  if (!response.ok) throw apiError(data, response.status, response.headers.get("x-request-id"));
  if (!isObject(data)) throw new ChatGPTError("invalid_token_response", "ChatGPT returned an invalid token response. Please sign in again.");
  return data;
}

function tokenFields(data: Record<string, unknown>, requireRefresh = false) {
  if (typeof data.scope !== "string") {
    throw new ChatGPTError("invalid_token_response", "ChatGPT did not confirm the granted permissions. Please sign in again.");
  }
  const scopes = data.scope.split(/\s+/).filter(Boolean);
  let credentials: StoredCredentials | undefined;
  if (typeof data.access_token === "string" && data.access_token) {
    if (typeof data.token_type !== "string" || data.token_type.toLowerCase() !== "bearer" ||
        typeof data.expires_in !== "number" || !Number.isFinite(Date.now() + data.expires_in * 1000) || data.expires_in <= 0 ||
        ((requireRefresh || scopes.includes("offline_access")) && (typeof data.refresh_token !== "string" || !data.refresh_token))) {
      throw new ChatGPTError("invalid_token_response", "ChatGPT returned incomplete credentials. Please sign in again.");
    }
    credentials = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      ...(typeof data.refresh_token === "string" && data.refresh_token ? { refreshToken: data.refresh_token } : {}),
      ...(typeof data.earliest_refresh_at === "string" || typeof data.earliest_refresh_at === "number" ? { earliestRefreshAt: data.earliest_refresh_at } : {}),
    };
  } else if (requireRefresh || scopes.includes("offline_access") || scopes.includes("chatgpt.tokens.use.direct")) {
    throw new ChatGPTError("invalid_token_response", "ChatGPT did not return the requested credentials. Please sign in again.");
  }
  return { scopes, ...(credentials ? { credentials } : {}) };
}

interface CallbackResult { code: string; clientId: string }

/** The authorization result in a callback that carried the expected state (the listener checks that). */
export function callbackResult(params: URLSearchParams, savedClientId: string | undefined): CallbackResult {
  if (params.has("error")) throw apiError({ error: params.get("error") });
  const code = params.get("code");
  const returnedClientId = params.get("client_id");
  const clientId = returnedClientId ?? savedClientId;
  if (!code || params.getAll("code").length !== 1 || params.getAll("client_id").length > 1 ||
      !clientId || !/^[a-zA-Z0-9_-]{1,200}$/.test(clientId) || clientId === "dynamic_agent_client" ||
      (savedClientId !== undefined && returnedClientId !== null && savedClientId !== returnedClientId)) {
    throw new ChatGPTError("registration_incomplete", "ChatGPT did not complete app registration. Please try signing in again.");
  }
  return { code, clientId };
}

interface AuthorizationOptions {
  reconsent?: boolean;
  /** Save the issued registration separately before the one-time code exchange. */
  onRegistration?: (clientId: string) => Promise<void>;
}

export async function authorize(
  config: ChatGPTConfig,
  previous: StoredConnection | undefined,
  hostId: string,
  signal: AbortSignal,
  options: AuthorizationOptions = {},
): Promise<StoredConnection> {
  const state = randomValue();
  const nonce = randomValue();
  const verifier = randomValue();
  const provider = await discovery();
  signal.throwIfAborted();
  const listener = await config.listenForCallback(config.redirectPort, state, signal);
  // The callback can arrive while the browser-opening promise is still pending.
  void listener.result.catch(() => undefined);
  try {
    const authorization = new URL(provider.authorization_endpoint);
    authorization.search = new URLSearchParams({
      client_id: previous?.clientId ?? "dynamic_agent_client",
      response_type: "code",
      redirect_uri: listener.redirectUri,
      scope: SCOPES,
      resource: RESOURCE,
      state,
      nonce,
      code_challenge_method: "S256",
      code_challenge: await sha256(verifier),
    }).toString();
    if (config.sendHostId) authorization.searchParams.set("ext_agent_host_id", hostId);
    if (!previous?.clientId) authorization.searchParams.set("agent_name_hint", config.appName);
    // Keep saved tokens out of browser URLs, which default openers expose in
    // process arguments. The verified subject check below binds saved profiles.
    if (previous?.identity?.email) authorization.searchParams.set("login_hint", previous.identity.email);
    if (options.reconsent) authorization.searchParams.set("prompt", "consent");
    await config.openBrowser(authorization.toString());
    const callback = callbackResult(await listener.result, previous?.clientId);
    // A one-time code can fail or expire after registration succeeds. Retain the
    // issued client ID so a fresh authorization does not register another app.
    await options.onRegistration?.(callback.clientId);
    const data = await tokenRequest(new URLSearchParams({
      grant_type: "authorization_code",
      client_id: callback.clientId,
      code: callback.code,
      code_verifier: verifier,
      redirect_uri: listener.redirectUri,
      resource: RESOURCE,
    }), signal);
    if (typeof data.id_token !== "string") throw new ChatGPTError("invalid_id_token", "ChatGPT did not return a verifiable identity. Please try signing in again.");
    const identity = await verifyIdentity(data.id_token, callback.clientId, nonce);
    if (previous?.subject && identity.subject !== previous.subject) {
      throw new ChatGPTError("account_mismatch", "This sign-in returned a different ChatGPT account. Choose the original account or add a separate profile.");
    }
    signal.throwIfAborted();
    return {
      version: 1,
      clientId: callback.clientId,
      status: "connected",
      savedAt: new Date().toISOString(),
      profileIdToken: data.id_token,
      ...identity,
      ...tokenFields(data),
    };
  } finally {
    listener.close();
  }
}

export async function refreshConnection(
  previous: StoredConnection,
  signal: AbortSignal,
  persistRotation: (rotation: PendingRefresh) => Promise<void>,
): Promise<StoredConnection> {
  let rotation = previous.pendingRefresh;
  let fields: ReturnType<typeof tokenFields>;
  if (rotation) {
    // A prior refresh already consumed its grant. Resume identity verification
    // from the encrypted checkpoint, including after an app restart.
    fields = { scopes: rotation.scopes, credentials: rotation.credentials };
  } else {
    if (!previous.credentials?.refreshToken) throw new ChatGPTError("invalid_grant", "Your ChatGPT connection has expired. Sign in again.");
    const data = await tokenRequest(new URLSearchParams({
      grant_type: "refresh_token",
      client_id: previous.clientId,
      refresh_token: previous.credentials.refreshToken,
      resource: RESOURCE,
    }), signal);
    // OAuth may omit scope on refresh when the previously granted scopes are unchanged.
    fields = tokenFields({ ...data, scope: data.scope ?? previous.scopes.join(" ") }, true);
    if (data.id_token !== undefined && (typeof data.id_token !== "string" || !data.id_token)) {
      throw new ChatGPTError("invalid_id_token", "ChatGPT returned an invalid refreshed identity. Please sign in again.");
    }
    if (typeof data.id_token === "string" && fields.credentials) {
      rotation = { credentials: fields.credentials, scopes: fields.scopes, idToken: data.id_token, receivedAt: Date.now() };
      // Persist before key retrieval can fail or the process can be interrupted.
      // This checkpoint is not authorization to use the received credentials.
      await persistRotation(rotation);
    }
  }
  let verifiedIdentity;
  if (rotation) {
    verifiedIdentity = await verifyIdentity(rotation.idToken, previous.clientId, undefined, rotation.receivedAt);
    if (verifiedIdentity.subject !== previous.subject) throw new ChatGPTError("account_mismatch", "The refreshed ChatGPT identity does not match this profile. Sign in to the original account again.");
  }
  const { pendingRefresh: _pendingRefresh, ...verified } = previous;
  return {
    ...verified,
    ...fields,
    ...(verifiedIdentity && rotation ? { ...verifiedIdentity, profileIdToken: rotation.idToken } : {}),
    status: "connected",
    savedAt: new Date().toISOString(),
  };
}

export async function revokeConnection(connection: StoredConnection): Promise<void> {
  if (!connection.credentials && !connection.pendingRefresh) return;
  const revocationFailed = () => new ChatGPTError("revocation_failed", "Local credentials were removed, but remote disconnection could not be confirmed. Disconnect the app in ChatGPT Settings.", true);
  const token = connection.pendingRefresh?.credentials.refreshToken ?? connection.credentials?.refreshToken;
  if (!token) throw revocationFailed();
  const provider = await discovery().catch(() => { throw revocationFailed(); });
  if (!provider.revocation_endpoint) throw revocationFailed();
  // Revoking the refresh token removes the renewable session. Do not also send
  // the access token after successful revocation of the same session.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let retryable = false;
    try {
      const response = await fetchRemote(provider.revocation_endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token, token_type_hint: "refresh_token", client_id: connection.clientId }),
      }, 10_000);
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 200) return;
      retryable = response.status >= 500;
    } catch (error) {
      retryable = error instanceof ChatGPTError && error.code === "network_error";
    }
    if (!retryable || attempt === 1) break;
    await delay(300);
  }
  throw revocationFailed();
}
