package com.scottmttmn.mathtutor;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.UnsupportedEncodingException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * Sign in with ChatGPT on the tablet (src/lib/chatgptDevice.ts): opens the sign-in page in the
 * browser, and listens on 127.0.0.1 for the browser coming back to /auth/callback, the way the
 * SDK's Node listener does on a computer. Only a GET from 127.0.0.1:port with the expected state
 * counts; anything else gets an error page and the listener keeps waiting.
 *
 * The callback reaches the page only once the app is back in front: the page then exchanges the
 * code with OpenAI, and on the BOOX Go 10.3 that request failed ("Could not reach ChatGPT") while
 * the browser was in front and the app in the background.
 */
@CapacitorPlugin(name = "ChatGPTSignIn")
public class ChatGPTSignInPlugin extends Plugin {

    private static final String CALLBACK_PATH = "/auth/callback";
    /** Opens the app from the callback page (the intent filter on MainActivity). */
    private static final String RETURN_URL = "com.scottmttmn.mathtutor://signed-in";

    private ServerSocket server;
    private int port;
    private String expectedState;
    private PluginCall waiting;
    private String received;
    /** Whether the app is in front, where its requests can reach OpenAI. */
    private boolean foreground = true;

    @PluginMethod
    public void listen(PluginCall call) {
        Integer requested = call.getInt("port");
        String state = call.getString("state");
        if (requested == null || state == null || state.isEmpty()) {
            call.reject("Missing port or state");
            return;
        }
        ServerSocket socket;
        synchronized (this) {
            stop("A new sign-in started");
            try {
                socket = new ServerSocket();
                socket.setReuseAddress(true);
                socket.bind(new InetSocketAddress(InetAddress.getByAddress(new byte[] { 127, 0, 0, 1 }), requested));
            } catch (IOException e) {
                call.reject("The sign-in port is unavailable", "PORT_UNAVAILABLE");
                return;
            }
            server = socket;
            port = socket.getLocalPort();
            expectedState = state;
            received = null;
        }
        Thread thread = new Thread(() -> serve(socket), "chatgpt-sign-in");
        thread.setDaemon(true);
        thread.start();
        JSObject result = new JSObject();
        result.put("redirectUri", "http://127.0.0.1:" + port + CALLBACK_PATH);
        call.resolve(result);
    }

    /** Resolves with the callback's query string once the browser has come back and the app is in front. */
    @PluginMethod
    public void waitForCallback(PluginCall call) {
        synchronized (this) {
            if (received == null && server == null) {
                call.reject("Not listening");
                return;
            }
            if (waiting != null) waiting.reject("Replaced");
            waiting = call;
            flush();
        }
    }

    @PluginMethod
    public void close(PluginCall call) {
        synchronized (this) {
            stop("Sign-in was cancelled");
        }
        call.resolve();
    }

    @PluginMethod
    public void openBrowser(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) {
            call.reject("Not a sign-in address");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("No browser is installed", "NO_BROWSER");
        }
    }

    @Override
    protected void handleOnPause() {
        synchronized (this) {
            foreground = false;
        }
    }

    @Override
    protected void handleOnResume() {
        synchronized (this) {
            foreground = true;
            flush();
        }
    }

    /** Hands a received callback to the page once it waits and the app is in front. Call with the lock held. */
    private void flush() {
        if (!foreground || waiting == null || received == null) return;
        resolveWith(waiting, received);
        waiting = null;
        received = null;
    }

    @Override
    protected void handleOnDestroy() {
        synchronized (this) {
            stop("The app closed");
        }
    }

    /** Closes the listener and fails a pending wait. Call with the lock held. */
    private void stop(String reason) {
        if (server != null) {
            try {
                server.close();
            } catch (IOException ignored) {}
            server = null;
        }
        if (waiting != null) {
            waiting.reject(reason, "CLOSED");
            waiting = null;
        }
        received = null;
    }

    private void serve(ServerSocket socket) {
        while (!socket.isClosed()) {
            try (Socket client = socket.accept()) {
                client.setSoTimeout(10_000);
                BufferedReader in = new BufferedReader(new InputStreamReader(client.getInputStream(), StandardCharsets.ISO_8859_1));
                String requestLine = in.readLine();
                String host = null;
                String line;
                while ((line = in.readLine()) != null && !line.isEmpty()) {
                    if (line.regionMatches(true, 0, "host:", 0, 5)) host = line.substring(5).trim();
                }
                OutputStream out = client.getOutputStream();
                String[] parts = requestLine == null ? new String[0] : requestLine.split(" ");
                String target = parts.length >= 2 ? parts[1] : "";
                int mark = target.indexOf('?');
                String path = mark < 0 ? target : target.substring(0, mark);
                String query = mark < 0 ? "" : target.substring(mark + 1);
                if (parts.length < 2 || !"GET".equals(parts[0]) || !("127.0.0.1:" + port).equals(host) || !CALLBACK_PATH.equals(path)) {
                    respond(out, 404, "text/plain", "Not found");
                    continue;
                }
                if (!stateMatches(query)) {
                    // Unrelated loopback requests must not end the sign-in.
                    respond(out, 400, "text/plain", "Invalid sign-in state. Return to Math Tutor and sign in again.");
                    continue;
                }
                respond(out, 200, "text/html; charset=utf-8", page());
                deliver(socket, query);
                return;
            } catch (IOException e) {
                if (socket.isClosed()) return;
            }
        }
    }

    private void deliver(ServerSocket socket, String query) {
        synchronized (this) {
            if (server != socket) return;
            received = query;
            flush();
            try {
                socket.close();
            } catch (IOException ignored) {}
            server = null;
        }
    }

    private boolean stateMatches(String query) {
        String found = null;
        int count = 0;
        for (String pair : query.split("&")) {
            int equals = pair.indexOf('=');
            String name = equals < 0 ? pair : pair.substring(0, equals);
            if (!"state".equals(decode(name))) continue;
            count++;
            found = equals < 0 ? "" : decode(pair.substring(equals + 1));
        }
        String expected;
        synchronized (this) {
            expected = expectedState;
        }
        return count == 1 && found != null && expected != null &&
            MessageDigest.isEqual(found.getBytes(StandardCharsets.UTF_8), expected.getBytes(StandardCharsets.UTF_8));
    }

    private static String decode(String value) {
        try {
            return URLDecoder.decode(value, "UTF-8");
        } catch (UnsupportedEncodingException | IllegalArgumentException e) {
            return "";
        }
    }

    private static void resolveWith(PluginCall call, String query) {
        JSObject result = new JSObject();
        result.put("query", query);
        call.resolve(result);
    }

    private static String page() {
        return "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\">"
            + "<title>Return to Math Tutor</title><style>body{font:18px system-ui;max-width:32rem;margin:18vh auto;padding:24px;color:#111}"
            + "a{display:inline-block;margin-top:16px;padding:12px 20px;border:2px solid #111;border-radius:8px;color:#111;text-decoration:none}</style>"
            + "<h1>Almost done</h1><p>Return to Math Tutor to finish connecting your ChatGPT plan.</p>"
            + "<a href=\"" + RETURN_URL + "\">Return to Math Tutor</a></html>";
    }

    private static void respond(OutputStream out, int status, String type, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        String reason = status == 200 ? "OK" : status == 400 ? "Bad Request" : "Not Found";
        String head = "HTTP/1.1 " + status + " " + reason + "\r\n"
            + "Content-Type: " + type + "\r\n"
            + "Content-Length: " + bytes.length + "\r\n"
            + "Cache-Control: no-store\r\nReferrer-Policy: no-referrer\r\n"
            + "Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'\r\n"
            + "Connection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.ISO_8859_1));
        out.write(bytes);
        out.flush();
    }
}
