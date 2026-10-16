// Modified for Math Tutor from OpenAI's Sign in with ChatGPT DevKit
// (github.com/openai/sign-in-with-chatgpt-devkit @ f723814, packages/local/src/oauth.ts).
// Changes: the Node loopback listener and browser opener, moved out of oauth.ts so the
// rest of the SDK also runs in a browser; the listener hands back the callback's
// parameters, which oauth.ts checks (callbackResult). Node only.
// Licensed under the Sign-in with ChatGPT DevKit Noncommercial License v1.0; see ./LICENSE.

import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type RequestListener } from "node:http";
import { spawn } from "node:child_process";
import { ChatGPTError } from "./errors";
import { CALLBACK_PATH } from "./oauth";
import type { CallbackListener } from "./types";

export async function openBrowser(url: string): Promise<void> {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "rundll32" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore", shell: false });
    child.once("error", () => reject(new ChatGPTError("browser_unavailable", "The browser could not be opened. Check your default browser and try again.")));
    child.once("exit", (code) => code === 0 ? resolve() : reject(new ChatGPTError("browser_unavailable", "The browser could not be opened. Check your default browser and try again.")));
  });
}

export const listenForCallback: CallbackListener = async (port, state, signal) => {
  let complete!: (value: URLSearchParams) => void;
  let fail!: (error: Error) => void;
  let settled = false;
  const result = new Promise<URLSearchParams>((resolve, reject) => { complete = resolve; fail = reject; });
  let selectedPort = port;
  const finish = (value: URLSearchParams | ChatGPTError) => {
    if (settled) return;
    settled = true;
    if (value instanceof ChatGPTError) fail(value);
    else complete(value);
  };
  const script = 'history.replaceState(null, "", "/auth/complete");';
  const scriptHash = createHash("sha256").update(script).digest("base64");
  const handler: RequestListener = (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy", `default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'`);
    let url: URL;
    try { url = new URL(request.url ?? "/", `http://127.0.0.1:${selectedPort}`); }
    catch { response.writeHead(400).end("Invalid request"); return; }
    if (request.method !== "GET" || request.headers.host !== `127.0.0.1:${selectedPort}` || url.origin !== `http://127.0.0.1:${selectedPort}` || url.pathname !== CALLBACK_PATH || settled) {
      response.writeHead(404).end("Not found");
      return;
    }
    const returnedState = Buffer.from(url.searchParams.get("state") ?? "");
    const expectedState = Buffer.from(state);
    if (url.searchParams.getAll("state").length !== 1 || returnedState.length !== expectedState.length || !timingSafeEqual(returnedState, expectedState)) {
      // Unrelated loopback requests must not consume the pending browser transaction.
      response.writeHead(400).end("Invalid sign-in state. Return to the browser tab that started sign-in.");
      return;
    }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Return to your app</title><style>body{font:17px system-ui;max-width:32rem;margin:18vh auto;padding:24px;color:#202123}h1{font-size:26px}</style><h1>Return to your app</h1><p>The app will finish checking your ChatGPT connection. You can close this tab.</p><script>${script}</script></html>`);
    finish(url.searchParams);
  };
  const server = createServer(handler);
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  const close = () => {
    signal.removeEventListener("abort", abort);
    server.close();
    server.closeAllConnections();
  };
  const abort = () => {
    finish(new ChatGPTError("cancelled", "Sign-in was cancelled."));
    close();
  };
  try {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen({ port: selectedPort, host: "127.0.0.1" }, () => {
          server.removeListener("error", reject);
          server.on("error", () => finish(new ChatGPTError("callback_failed", "The local sign-in listener stopped. Please try again.")));
          const address = server.address();
          if (address && typeof address !== "string") selectedPort = address.port;
          resolve();
        });
      });
    } catch {
      throw new ChatGPTError("callback_port_unavailable", "The sign-in port is unavailable. Close another copy of the app or choose a different redirect port.");
    }
    signal.addEventListener("abort", abort, { once: true });
    signal.throwIfAborted();
    return { result, close, redirectUri: `http://127.0.0.1:${selectedPort}${CALLBACK_PATH}` };
  } catch (error) {
    close();
    throw error;
  }
};
