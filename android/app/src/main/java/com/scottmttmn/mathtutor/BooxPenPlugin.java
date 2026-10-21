package com.scottmttmn.mathtutor;

import android.graphics.Rect;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.util.Log;
import android.webkit.WebView;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.onyx.android.sdk.api.device.epd.EpdController;
import com.onyx.android.sdk.api.device.epd.UpdateMode;
import com.onyx.android.sdk.data.note.TouchPoint;
import com.onyx.android.sdk.pen.RawInputCallback;
import com.onyx.android.sdk.pen.TouchHelper;
import com.onyx.android.sdk.pen.data.TouchPointList;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.lsposed.hiddenapibypass.HiddenApiBypass;

/**
 * Onyx's pen SDK (BOOX tablets) over the app's WebView: inside a region of the page the stylus
 * is drawn by the e-ink controller itself, far faster than the browser can, and each finished
 * stroke is sent to the page as points (src/lib/booxPen.ts), which turns it into real ink.
 *
 * Does nothing on any other device: status() says onyx: false and every other call is refused.
 * While raw drawing is on the controller doesn't show the page's own updates in the region, so
 * the page calls refresh() once it has drawn a stroke, and pause() while something covers it.
 *
 * Coordinates to and from the page are CSS pixels relative to the WebView.
 * Validated on the BOOX Go 10.3: restarting raw input after each stroke causes visible lag.
 */
@CapacitorPlugin(name = "BooxPen")
public class BooxPenPlugin extends Plugin {

    private static final boolean ONYX = "onyx".equalsIgnoreCase(Build.MANUFACTURER);

    private TouchHelper touchHelper;
    /** Whether the page wants raw drawing on (start/resume) as opposed to paused or stopped. */
    private boolean wanted = false;
    /** Raw callbacks can precede their queued main-thread work. Don't enter fast mode in that gap. */
    private volatile boolean rawWriting = false;
    private float maxPressure = 0;
    private final FastRefreshController fastRefresh = new FastRefreshController(this::enterFastRefresh, this::leaveFastRefresh);
    private static final long REFRESH_IDLE_MS = 500;
    private final Handler refreshHandler = new Handler(Looper.getMainLooper());
    private final PenRefreshScheduler refreshes = new PenRefreshScheduler(
        task -> refreshHandler.postDelayed(task, REFRESH_IDLE_MS),
        refreshHandler::removeCallbacks,
        () -> {
            if (touchHelper == null || !wanted || fastRefresh.isActive()) return;
            // Let page ink through without restarting the input reader (which force-releases the pen).
            touchHelper.setRawDrawingRenderEnabled(false);
            touchHelper.setRawDrawingRenderEnabled(true);
        }
    );

    @Override
    public void load() {
        // The SDK reaches Android's hidden e-ink APIs, which apps are barred from since Android 11.
        if (ONYX && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) HiddenApiBypass.addHiddenApiExemptions("");
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("onyx", ONYX);
        result.put("active", touchHelper != null && wanted);
        result.put("fast", fastRefresh.isActive());
        call.resolve(result);
    }

    /** Editing tools and finger/wheel gestures use the panel's transient animation mode. */
    @PluginMethod
    public void interaction(PluginCall call) {
        if (!onyx(call)) return;
        boolean active = call.getBoolean("active", false);
        getBridge().executeOnMainThread(() -> {
            if (active) fastRefresh.begin();
            else fastRefresh.end();
            JSObject result = new JSObject();
            result.put("active", fastRefresh.isActive());
            call.resolve(result);
        });
    }

    private boolean enterFastRefresh() {
        if (rawWriting) return false;
        refreshes.cancel();
        boolean accepted = false;
        try {
            if (touchHelper != null && wanted) touchHelper.setRawDrawingRenderEnabled(false);
            accepted = EpdController.applyTransientUpdate(UpdateMode.ANIMATION);
            return accepted;
        } catch (Throwable unavailable) {
            return false;
        } finally {
            if (!accepted && touchHelper != null && wanted) touchHelper.setRawDrawingRenderEnabled(true);
        }
    }

    private void leaveFastRefresh() {
        WebView view = getBridge().getWebView();
        try {
            EpdController.clearTransientUpdate(view, false);
        } catch (Throwable unavailable) {
            Log.w("BooxPen", "Couldn't restore the panel refresh mode", unavailable);
        } finally {
            if (touchHelper != null && wanted) touchHelper.setRawDrawingRenderEnabled(true);
        }
    }

    /** { region, exclude?, width }: region and exclude are { x, y, w, h }; width is the pen's in CSS px. */
    @PluginMethod
    public void start(PluginCall call) {
        if (!onyx(call)) return;
        Rect region = rect(call.getObject("region"));
        if (region == null) {
            call.reject("A region is needed.");
            return;
        }
        List<Rect> exclude = rects(call.getArray("exclude"));
        float width = call.getFloat("width", 2.5f) * density();
        getBridge().executeOnMainThread(() -> {
            try {
                WebView view = getBridge().getWebView();
                fastRefresh.reset();
                rawWriting = false;
                refreshes.cancel();
                if (touchHelper == null) {
                    touchHelper = TouchHelper.create(view, callback);
                    maxPressure = EpdController.getMaxTouchPressure();
                } else {
                    touchHelper.setRawDrawingEnabled(false);
                }
                touchHelper.setStrokeWidth(width).setLimitRect(region, exclude).openRawDrawing();
                touchHelper.setStrokeStyle(TouchHelper.STROKE_STYLE_PENCIL);
                touchHelper.setRawDrawingEnabled(true);
                wanted = true;
                call.resolve();
            } catch (Throwable error) {
                call.reject("The BOOX pen couldn't start.", error instanceof Exception ? (Exception) error : null);
            }
        });
    }

    /** { region, exclude? }: the board moved or something now sits over part of it. */
    @PluginMethod
    public void setRegion(PluginCall call) {
        if (!started(call)) return;
        Rect region = rect(call.getObject("region"));
        if (region == null) {
            call.reject("A region is needed.");
            return;
        }
        List<Rect> exclude = rects(call.getArray("exclude"));
        getBridge().executeOnMainThread(() -> {
            fastRefresh.end();
            refreshes.cancel();
            touchHelper.setRawDrawingEnabled(false);
            touchHelper.setLimitRect(region, exclude);
            if (wanted) touchHelper.setRawDrawingEnabled(true);
            call.resolve();
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        if (!started(call)) return;
        getBridge().executeOnMainThread(() -> {
            refreshes.cancel();
            wanted = false;
            rawWriting = false;
            fastRefresh.reset();
            touchHelper.setRawDrawingEnabled(false);
            call.resolve();
        });
    }

    @PluginMethod
    public void resume(PluginCall call) {
        if (!started(call)) return;
        getBridge().executeOnMainThread(() -> {
            fastRefresh.reset();
            wanted = true;
            touchHelper.setRawDrawingEnabled(true);
            call.resolve();
        });
    }

    /** Requests a page refresh after writing pauses; never stops a stroke to show page ink. */
    @PluginMethod
    public void refresh(PluginCall call) {
        if (!started(call)) return;
        getBridge().executeOnMainThread(() -> {
            if (wanted && !fastRefresh.isActive()) refreshes.request();
            call.resolve();
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getBridge().executeOnMainThread(() -> {
            close();
            call.resolve();
        });
    }

    @Override
    protected void handleOnPause() {
        fastRefresh.reset();
        rawWriting = false;
        refreshes.cancel();
        if (touchHelper != null) touchHelper.setRawDrawingEnabled(false);
    }

    @Override
    protected void handleOnResume() {
        if (touchHelper != null && wanted) touchHelper.setRawDrawingEnabled(true);
    }

    @Override
    protected void handleOnDestroy() {
        close();
    }

    private void close() {
        refreshes.cancel();
        wanted = false;
        rawWriting = false;
        fastRefresh.reset();
        if (touchHelper == null) return;
        touchHelper.setRawDrawingEnabled(false);
        touchHelper.closeRawDrawing();
        touchHelper = null;
        EpdController.appResetCTPDisableRegion(getContext());
    }

    private final RawInputCallback callback = new RawInputCallback() {
        @Override
        public void onBeginRawDrawing(boolean b, TouchPoint point) {
            rawWriting = true;
            refreshes.beginStroke();
            getBridge().executeOnMainThread(fastRefresh::beginStroke);
            ignoreFingers(true);
        }

        @Override
        public void onEndRawDrawing(boolean b, TouchPoint point) {
            rawWriting = false;
            refreshes.endStroke();
            getBridge().executeOnMainThread(fastRefresh::endStroke);
            ignoreFingers(false);
        }

        @Override
        public void onRawDrawingTouchPointMoveReceived(TouchPoint point) {}

        @Override
        public void onRawDrawingTouchPointListReceived(TouchPointList list) {
            send("stroke", list);
        }

        @Override
        public void onBeginRawErasing(boolean b, TouchPoint point) {
            rawWriting = true;
            refreshes.beginStroke();
            getBridge().executeOnMainThread(fastRefresh::beginStroke);
            ignoreFingers(true);
        }

        @Override
        public void onEndRawErasing(boolean b, TouchPoint point) {
            rawWriting = false;
            refreshes.endStroke();
            getBridge().executeOnMainThread(fastRefresh::endStroke);
            ignoreFingers(false);
        }

        @Override
        public void onRawErasingTouchPointMoveReceived(TouchPoint point) {}

        @Override
        public void onRawErasingTouchPointListReceived(TouchPointList list) {
            send("erase", list);
        }
    };

    /** A resting palm does nothing while the pen writes (as in Onyx's WebView demo). */
    private void ignoreFingers(boolean ignore) {
        if (!ignore) {
            EpdController.appResetCTPDisableRegion(getContext());
            return;
        }
        DisplayMetrics metrics = getContext().getResources().getDisplayMetrics();
        EpdController.setAppCTPDisableRegion(getContext(), new Rect[] { new Rect(0, 0, metrics.widthPixels, metrics.heightPixels) });
    }

    /** { points: [x, y, pressure, ms, …] }: CSS px, pressure 0–1, ms since the stroke began. */
    private void send(String event, TouchPointList list) {
        List<TouchPoint> points = list == null ? null : list.getPoints();
        if (points == null || points.isEmpty()) return;
        float scale = density();
        long start = points.get(0).timestamp;
        JSONArray flat = new JSONArray();
        try {
            for (TouchPoint point : points) {
                flat.put(point.x / scale);
                flat.put(point.y / scale);
                flat.put(maxPressure > 0 ? Math.min(1, point.pressure / maxPressure) : 0.5);
                flat.put(point.timestamp - start);
            }
        } catch (JSONException error) {
            return;
        }
        JSObject data = new JSObject();
        data.put("points", flat);
        notifyListeners(event, data);
    }

    private float density() {
        return getContext().getResources().getDisplayMetrics().density;
    }

    private boolean onyx(PluginCall call) {
        if (ONYX) return true;
        call.reject("The BOOX pen only works on BOOX tablets.");
        return false;
    }

    private boolean started(PluginCall call) {
        if (!onyx(call)) return false;
        if (touchHelper != null) return true;
        call.reject("The BOOX pen isn't started.");
        return false;
    }

    private Rect rect(JSONObject box) {
        if (box == null) return null;
        float scale = density();
        double x = box.optDouble("x", 0), y = box.optDouble("y", 0), w = box.optDouble("w", 0), h = box.optDouble("h", 0);
        if (!(w > 0 && h > 0)) return null;
        return new Rect((int) Math.floor(x * scale), (int) Math.floor(y * scale), (int) Math.ceil((x + w) * scale), (int) Math.ceil((y + h) * scale));
    }

    private List<Rect> rects(JSArray boxes) {
        List<Rect> result = new ArrayList<>();
        if (boxes == null) return result;
        for (int i = 0; i < boxes.length(); i++) {
            Rect rect = rect(boxes.optJSONObject(i));
            if (rect != null) result.add(rect);
        }
        return result;
    }
}
