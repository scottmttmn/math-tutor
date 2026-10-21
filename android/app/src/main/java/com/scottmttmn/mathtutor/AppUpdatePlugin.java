package com.scottmttmn.mathtutor;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Installs a newer build of the app over this one (src/lib/appUpdate.ts): downloads the APK CI
 * published and opens Android's installer on it, which asks the student to confirm. The first time,
 * Android needs the app allowed to install apps; install() then opens that setting instead and
 * resolves { permission: false }. Only builds signed with the same key install over this one.
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    // Only CI's published build is fetched.
    private static final String ALLOWED = "https://github.com/scottmttmn/math-tutor/releases/download/";

    @PluginMethod
    public void install(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith(ALLOWED)) {
            call.reject("Not the app's build link.");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent allow = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            allow.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(allow);
            JSObject answer = new JSObject();
            answer.put("permission", false);
            call.resolve(answer);
            return;
        }
        new Thread(() -> {
            try {
                File folder = new File(getContext().getCacheDir(), "update");
                if (!folder.exists() && !folder.mkdirs()) throw new java.io.IOException("No folder for the download");
                File apk = new File(folder, "math-tutor.apk");
                download(url, apk);
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                Intent open = new Intent(Intent.ACTION_VIEW);
                open.setDataAndType(uri, "application/vnd.android.package-archive");
                open.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(open);
                JSObject answer = new JSObject();
                answer.put("permission", true);
                call.resolve(answer);
            } catch (Exception error) {
                call.reject("Couldn't download the update.", error);
            }
        }).start();
    }

    // GitHub answers the release link with a redirect to its file storage (https to https, which
    // HttpURLConnection follows).
    private static void download(String url, File to) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setInstanceFollowRedirects(true);
        connection.setConnectTimeout(20000);
        connection.setReadTimeout(60000);
        try {
            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) throw new java.io.IOException("HTTP " + status);
            try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(to)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
            }
        } finally {
            connection.disconnect();
        }
    }
}
