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
 * The page's side of CrashLog: take() hands over what was recorded natively since the last call
 * (src/lib/errorLog.ts keeps it with the page's own errors). On load it adds how the last runs
 * ended and starts noting the WebView's page process dying, which otherwise closes the app with
 * nothing to say why.
 */
@CapacitorPlugin(name = "CrashLog")
public class CrashLogPlugin extends Plugin {

    @Override
    public void load() {
        new Thread(() -> CrashLog.recordExits(getContext())).start();
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

    @PluginMethod
    public void take(PluginCall call) {
        try {
            JSObject answer = new JSObject();
            answer.put("lines", CrashLog.take(getContext()));
            call.resolve(answer);
        } catch (Exception error) {
            call.reject("Couldn't read the crash log.", error);
        }
    }
}
