package com.scottmttmn.mathtutor;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.util.Log;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.io.FileInputStream;
import java.util.List;
import androidx.annotation.RequiresApi;
import org.json.JSONObject;

/**
 * What went wrong while the page couldn't say so itself (src/lib/errorLog.ts reads it through
 * CrashLogPlugin): an uncaught Java exception, the WebView's page process dying, and how Android
 * says the app's last runs ended (a native crash, the app not responding, killed for memory while
 * in front). Entries are JSON lines in the app's private files, taken by the page on its next start.
 */
final class CrashLog {

    private static final String FILE = "crash-log.jsonl";
    /** A log that big starts over, so a crash loop can't fill the tablet. */
    private static final long MAX_FILE = 512 * 1024;
    /** A stack trace or an ANR's thread dump is cut to this many characters. */
    static final int MAX_DETAIL = 16 * 1024;
    private static final String PREFS = "crash_log";
    private static final String EXITS_SEEN = "exitsSeen";

    private CrashLog() {}

    /** Records uncaught exceptions on any thread, then lets Android end the app as it would have. */
    static void install(Context context) {
        Context app = context.getApplicationContext();
        Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            try {
                add(app, "crash", String.valueOf(error), "Thread: " + thread.getName() + "\n" + Log.getStackTraceString(error));
            } catch (Throwable ignored) {
                // Never let the log stand in the way of the crash being handled.
            }
            if (previous != null) previous.uncaughtException(thread, error);
        });
    }

    static void add(Context context, String kind, String message, String detail) {
        add(context, System.currentTimeMillis(), kind, message, detail, true);
    }

    /** `withBuild`: this build's number goes with it (not for an exit, which may be an older build's). */
    private static synchronized void add(Context context, long at, String kind, String message, String detail, boolean withBuild) {
        try {
            File file = new File(context.getFilesDir(), FILE);
            boolean append = file.length() < MAX_FILE;
            JSONObject entry = new JSONObject();
            entry.put("at", at);
            entry.put("kind", kind);
            entry.put("message", message == null ? "" : message);
            if (detail != null && !detail.isEmpty()) entry.put("detail", cut(detail));
            long build = withBuild ? build(context) : 0;
            if (build > 0) entry.put("build", String.valueOf(build));
            try (FileOutputStream out = new FileOutputStream(file, append)) {
                out.write((entry.toString() + "\n").getBytes(StandardCharsets.UTF_8));
                out.getFD().sync();
            }
        } catch (Exception error) {
            Log.w("CrashLog", "Couldn't record " + kind, error);
        }
    }

    /** Every entry recorded since the last clear, as JSON lines (the file's first `size` bytes). */
    static synchronized String read(Context context) throws Exception {
        File file = new File(context.getFilesDir(), FILE);
        if (!file.exists()) return "";
        try (InputStream in = new FileInputStream(file)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) > 0) out.write(buffer, 0, read);
            return out.toString("UTF-8");
        }
    }

    /**
     * Drops the first `size` bytes, what the page read and has now kept, leaving anything added
     * since. Called only once the page has stored them, so a failed store keeps them for next time.
     */
    static synchronized void clear(Context context, long size) throws Exception {
        File file = new File(context.getFilesDir(), FILE);
        if (!file.exists() || size <= 0) return;
        if (size >= file.length()) {
            if (!file.delete()) throw new java.io.IOException("Couldn't empty the crash log");
            return;
        }
        byte[] rest;
        try (FileInputStream in = new FileInputStream(file)) {
            if (in.skip(size) != size) throw new java.io.IOException("Couldn't read the crash log");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) > 0) out.write(buffer, 0, read);
            rest = out.toByteArray();
        }
        try (FileOutputStream out = new FileOutputStream(file, false)) {
            out.write(rest);
        }
    }

    /**
     * Adds how the app's earlier runs ended, where that wasn't ordinary (Android 11 and later):
     * each exit once, remembered by its time. A Java crash is left out, the handler above has it.
     */
    static void recordExits(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long seen = prefs.getLong(EXITS_SEEN, 0);
        ActivityManager manager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        if (manager == null) return;
        List<ApplicationExitInfo> exits = manager.getHistoricalProcessExitReasons(context.getPackageName(), 0, 16);
        long newest = seen;
        // Oldest first, so the log reads in order.
        for (int i = exits.size() - 1; i >= 0; i--) {
            ApplicationExitInfo exit = exits.get(i);
            if (exit.getTimestamp() <= seen) continue;
            newest = Math.max(newest, exit.getTimestamp());
            if (seen == 0) continue; // the first start with the log: earlier exits aren't news
            String kind = exitKind(exit);
            if (kind == null) continue;
            String description = exit.getDescription();
            String message = exitMessage(exit) + (description == null || description.isEmpty() ? "" : " (" + description + ")");
            String detail = "Process: " + exit.getProcessName()
                + "\nReason " + exit.getReason() + ", status " + exit.getStatus() + ", importance " + exit.getImportance()
                + "\nMemory: " + exit.getPss() / 1024 + " MB PSS, " + exit.getRss() / 1024 + " MB RSS";
            if (exit.getReason() == ApplicationExitInfo.REASON_ANR) detail += "\n\n" + trace(exit);
            add(context, exit.getTimestamp(), kind, message, detail, false);
        }
        if (newest == 0) newest = System.currentTimeMillis();
        prefs.edit().putLong(EXITS_SEEN, newest).apply();
    }

    @RequiresApi(api = Build.VERSION_CODES.R)
    private static String exitKind(ApplicationExitInfo exit) {
        boolean inFront = exit.getImportance() <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE;
        switch (exit.getReason()) {
            case ApplicationExitInfo.REASON_CRASH_NATIVE: return "native-crash";
            case ApplicationExitInfo.REASON_ANR: return "not-responding";
            case ApplicationExitInfo.REASON_INITIALIZATION_FAILURE: return "exit";
            case ApplicationExitInfo.REASON_LOW_MEMORY:
            case ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE:
            case ApplicationExitInfo.REASON_SIGNALED:
            case ApplicationExitInfo.REASON_OTHER:
            case ApplicationExitInfo.REASON_DEPENDENCY_DIED:
            case ApplicationExitInfo.REASON_UNKNOWN:
                return inFront ? "exit" : null;
            default: return null; // a Java crash, the student or the app closing it, an update…
        }
    }

    @RequiresApi(api = Build.VERSION_CODES.R)
    private static String exitMessage(ApplicationExitInfo exit) {
        switch (exit.getReason()) {
            case ApplicationExitInfo.REASON_CRASH_NATIVE: return "The app crashed in native code";
            case ApplicationExitInfo.REASON_ANR: return "The app stopped responding and Android closed it";
            case ApplicationExitInfo.REASON_LOW_MEMORY: return "Android closed the app to free memory";
            case ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE: return "Android closed the app for using too much";
            case ApplicationExitInfo.REASON_SIGNALED: return "The app was stopped by a signal";
            case ApplicationExitInfo.REASON_INITIALIZATION_FAILURE: return "The app failed to start";
            case ApplicationExitInfo.REASON_DEPENDENCY_DIED: return "Something the app depends on stopped";
            default: return "The app ended unexpectedly";
        }
    }

    @RequiresApi(api = Build.VERSION_CODES.R)
    private static String trace(ApplicationExitInfo exit) {
        try (InputStream in = exit.getTraceInputStream()) {
            if (in == null) return "";
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) > 0 && out.size() < MAX_DETAIL) out.write(buffer, 0, read);
            return out.toString("UTF-8");
        } catch (Exception error) {
            return "";
        }
    }

    private static String cut(String text) {
        return text.length() <= MAX_DETAIL ? text : text.substring(0, MAX_DETAIL) + "\n…";
    }

    @SuppressWarnings("deprecation")
    private static long build(Context context) {
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
        } catch (Exception error) {
            return 0;
        }
    }
}
