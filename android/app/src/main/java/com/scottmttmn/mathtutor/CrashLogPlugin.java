package com.scottmttmn.mathtutor;

import android.os.Build;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.WebViewListener;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The page's side of CrashLog: read() hands over what was recorded natively, and clear() drops
 * it once src/lib/errorLog.ts has stored it with the page's own errors. On load it adds how the last runs
 * ended and starts noting the WebView's page process dying, which otherwise closes the app with
 * nothing to say why.
 */
@CapacitorPlugin(name = "CrashLog")
public class CrashLogPlugin extends Plugin {

    private Thread exits;

    @Override
    public void load() {
        exits = new Thread(() -> CrashLog.recordExits(getContext()));
        exits.start();
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                boolean crashed = Build.VERSION.SDK_INT < Build.VERSION_CODES.O || detail.didCrash();
                String message = crashed
                    ? "The page's process crashed"
                    : "Android stopped the page's process, most likely to free memory";
                String about = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    ? "Renderer priority at exit: " + detail.rendererPriorityAtExit()
                    : null;
                CrashLog.add(getContext(), "page-process", message, about);
                // Unchanged: the app still closes (a dead page can't be shown), and the log says why.
                return false;
            }
        });
    }

    /** The entries so far, once the earlier runs' exits are in (read() runs off the main thread). */
    @PluginMethod
    public void read(PluginCall call) {
        try {
            if (exits != null) exits.join(5000);
            String lines = CrashLog.read(getContext());
            JSObject answer = new JSObject();
            answer.put("lines", lines);
            answer.put("size", lines.getBytes(java.nio.charset.StandardCharsets.UTF_8).length);
            call.resolve(answer);
        } catch (Exception error) {
            call.reject("Couldn't read the crash log.", error);
        }
    }

    /**
     * What is open and the page's memory (src/lib/errorLog.ts sends it every 20 s), kept with the
     * app's own memory so an exit Android gives no reason for can say where the app was.
     */
    @PluginMethod
    public void note(PluginCall call) {
        try {
            if (exits != null) exits.join(5000); // the last run's note goes with its exit first
            Integer heap = call.getData().has("heapMB") ? call.getData().optInt("heapMB") : null;
            CrashLog.note(getContext(), call.getString("page", ""), call.getString("about", ""), heap);
            call.resolve();
        } catch (Exception error) {
            call.reject("Couldn't note the app's state.", error);
        }
    }

    /** Drops the first `size` bytes, what the page has stored. */
    @PluginMethod
    public void clear(PluginCall call) {
        try {
            // Not call.getLong: a small number arrives as an Integer, which getLong answers with its
            // default, so the log was never cleared and every start stored its exits again.
            CrashLog.clear(getContext(), call.getData().optLong("size", 0L));
            call.resolve();
        } catch (Exception error) {
            call.reject("Couldn't empty the crash log.", error);
        }
    }
}
