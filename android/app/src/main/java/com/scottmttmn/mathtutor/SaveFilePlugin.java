package com.scottmttmn.mathtutor;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;

/**
 * Saves a file the app made (a backup, a board as PNG or PDF, a .tex write-up) through Android's
 * own Save dialog, since the WebView can't save a blob: download. open() shows the dialog and
 * resolves { id } for the chosen file, or {} when it was cancelled; the page then sends the file
 * with write() in pieces and close(), or abort() to delete it. Called from downloadBlob in
 * src/lib/backup.ts.
 */
@CapacitorPlugin(name = "SaveFile")
public class SaveFilePlugin extends Plugin {

    @PluginMethod
    public void open(PluginCall call) {
        String name = call.getString("name");
        if (name == null) {
            call.reject("A file name is needed.");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mimeType", "application/octet-stream"));
        intent.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(call, intent, "picked");
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent picked = result.getData();
        Uri uri = picked == null ? null : picked.getData();
        JSObject answer = new JSObject();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            call.resolve(answer);
            return;
        }
        try {
            OutputStream out = OpenFiles.openReplacing(getContext().getContentResolver(), uri);
            answer.put("id", OpenFiles.add(out, uri));
            call.resolve(answer);
        } catch (Exception error) {
            call.reject("Couldn't save the file.", error);
        }
    }

    @PluginMethod
    public void write(PluginCall call) {
        try {
            OpenFiles.write(call.getString("id"), call.getString("data", ""));
            call.resolve();
        } catch (Exception error) {
            call.reject("Couldn't save the file.", error);
        }
    }

    @PluginMethod
    public void close(PluginCall call) {
        try {
            OpenFiles.close(call.getString("id"));
            call.resolve();
        } catch (Exception error) {
            call.reject("Couldn't save the file.", error);
        }
    }

    @PluginMethod
    public void abort(PluginCall call) {
        OpenFiles.abort(getContext().getContentResolver(), call.getString("id"));
        call.resolve();
    }
}
