package com.scottmttmn.mathtutor;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The backup folder in the Android app (src/lib/backupFolder.ts): a folder the student picks with
 * Android's folder picker, kept across starts, which the folder backup writes into as it does into
 * a browser's folder. A folder is its picked tree's URI plus the names of the folders inside it
 * (path); folders on a path are made as needed. Files are written in pieces like SaveFilePlugin's
 * and read in pieces for a restore. A call that finds the folder no longer allowed rejects with
 * the code NOT_ALLOWED, and the backup pauses until the folder is picked again.
 */
@CapacitorPlugin(name = "BackupFolder")
public class BackupFolderPlugin extends Plugin {

    private static final int ACCESS = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
    // Every file as plain bytes, so the provider keeps the name as given (no extension added).
    private static final String BYTES = "application/octet-stream";
    private static final int MAX_READ = 4 * 1024 * 1024;

    // Folders already found or made, by tree URI and path, so each write doesn't walk the path again.
    private final Map<String, String> folders = new HashMap<>();

    private static final class Child {
        final String id;
        final String name;
        final boolean directory;
        final long size;

        Child(String id, String name, boolean directory, long size) {
            this.id = id;
            this.name = name;
            this.directory = directory;
            this.size = size;
        }
    }

    private interface Work {
        void run() throws Exception;
    }

    private ContentResolver resolver() {
        return getContext().getContentResolver();
    }

    @PluginMethod
    public void pick(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(ACCESS | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(call, intent, "picked");
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent picked = result.getData();
        Uri tree = picked == null ? null : picked.getData();
        JSObject answer = new JSObject();
        if (result.getResultCode() != Activity.RESULT_OK || tree == null) {
            call.resolve(answer);
            return;
        }
        try {
            // Kept across starts only when asked: a restore reads the folder once.
            if (call.getBoolean("keep", true)) resolver().takePersistableUriPermission(tree, ACCESS);
            answer.put("tree", tree.toString());
            answer.put("name", rootName(tree));
            call.resolve(answer);
        } catch (Exception error) {
            call.reject("Couldn't use that folder.", error);
        }
    }

    /** Whether the app may still write to the tree (Android keeps the permission until it is released). */
    @PluginMethod
    public void check(PluginCall call) {
        String tree = call.getString("tree");
        boolean granted = false;
        for (UriPermission permission : resolver().getPersistedUriPermissions()) {
            if (permission.getUri().toString().equals(tree) && permission.isReadPermission() && permission.isWritePermission()) granted = true;
        }
        if (granted) {
            try {
                rootName(Uri.parse(tree));
            } catch (Exception gone) {
                granted = false;
            }
        }
        JSObject answer = new JSObject();
        answer.put("granted", granted);
        call.resolve(answer);
    }

    @PluginMethod
    public void release(PluginCall call) {
        try {
            resolver().releasePersistableUriPermission(Uri.parse(call.getString("tree")), ACCESS);
        } catch (Exception ignored) {
            // Not held any more.
        }
        folders.clear();
        call.resolve();
    }

    /** The files and folders in a folder: { entries: [{ name, directory, size }] }, made first when create is set. */
    @PluginMethod
    public void list(PluginCall call) {
        guarded(call, () -> {
            Uri tree = Uri.parse(call.getString("tree"));
            String folder = folder(tree, call.getArray("path"), call.getBoolean("create", false));
            JSArray entries = new JSArray();
            if (folder != null) {
                for (Child child : children(tree, folder)) {
                    JSObject entry = new JSObject();
                    entry.put("name", child.name);
                    entry.put("directory", child.directory);
                    entry.put("size", child.size);
                    entries.put(entry);
                }
            }
            JSObject answer = new JSObject();
            answer.put("entries", entries);
            call.resolve(answer);
        });
    }

    /** Opens a file in a folder for writing, replacing what it held: { id } for write() and close(). */
    @PluginMethod
    public void openWrite(PluginCall call) {
        guarded(call, () -> {
            Uri tree = Uri.parse(call.getString("tree"));
            String name = call.getString("name");
            String folder = folder(tree, call.getArray("path"), true);
            Child existing = find(tree, folder, name);
            if (existing != null && existing.directory) throw new IOException(name + " is a folder.");
            Uri file = existing != null ? DocumentsContract.buildDocumentUriUsingTree(tree, existing.id)
                : DocumentsContract.createDocument(resolver(), DocumentsContract.buildDocumentUriUsingTree(tree, folder), BYTES, name);
            if (file == null) throw new IOException("Couldn't make " + name + ".");
            OutputStream out = OpenFiles.openReplacing(resolver(), file);
            JSObject answer = new JSObject();
            answer.put("id", OpenFiles.add(out, file));
            call.resolve(answer);
        });
    }

    @PluginMethod
    public void write(PluginCall call) {
        guarded(call, () -> {
            OpenFiles.write(call.getString("id"), call.getString("data", ""));
            call.resolve();
        });
    }

    @PluginMethod
    public void close(PluginCall call) {
        guarded(call, () -> {
            OpenFiles.close(call.getString("id"));
            call.resolve();
        });
    }

    @PluginMethod
    public void abort(PluginCall call) {
        OpenFiles.abort(resolver(), call.getString("id"));
        call.resolve();
    }

    /** Part of a file, from offset, at most length bytes: { data } in base64 (empty past its end). */
    @PluginMethod
    public void read(PluginCall call) {
        guarded(call, () -> {
            Uri tree = Uri.parse(call.getString("tree"));
            String name = call.getString("name");
            String folder = folder(tree, call.getArray("path"), false);
            Child file = folder == null ? null : find(tree, folder, name);
            if (file == null || file.directory) throw new IOException(name + " isn't in the folder.");
            // A small offset arrives as an Integer, which getLong ignores.
            long offset = call.getData().optLong("offset", 0L);
            int length = Math.min(MAX_READ, call.getInt("length", MAX_READ));
            byte[] buffer = new byte[length];
            int filled = 0;
            try (ParcelFileDescriptor descriptor = resolver().openFileDescriptor(DocumentsContract.buildDocumentUriUsingTree(tree, file.id), "r")) {
                if (descriptor == null) throw new IOException("No stream for " + name + ".");
                try (FileInputStream in = new FileInputStream(descriptor.getFileDescriptor())) {
                    in.getChannel().position(offset);
                    int read;
                    while (filled < length && (read = in.read(buffer, filled, length - filled)) > 0) filled += read;
                }
            }
            JSObject answer = new JSObject();
            answer.put("data", Base64.encodeToString(buffer, 0, filled, Base64.NO_WRAP));
            call.resolve(answer);
        });
    }

    /** Deletes a file or a folder (with what is in it); nothing happens when it isn't there. */
    @PluginMethod
    public void remove(PluginCall call) {
        guarded(call, () -> {
            Uri tree = Uri.parse(call.getString("tree"));
            String folder = folder(tree, call.getArray("path"), false);
            Child child = folder == null ? null : find(tree, folder, call.getString("name"));
            if (child != null) {
                DocumentsContract.deleteDocument(resolver(), DocumentsContract.buildDocumentUriUsingTree(tree, child.id));
                if (child.directory) folders.clear();
            }
            call.resolve();
        });
    }

    // A folder moved or deleted outside the app leaves stale ids, so any failure forgets them.
    private void guarded(PluginCall call, Work work) {
        try {
            work.run();
        } catch (SecurityException denied) {
            folders.clear();
            call.reject("The app may no longer use that folder.", "NOT_ALLOWED", denied);
        } catch (Exception error) {
            folders.clear();
            call.reject(error.getMessage() == null ? "Couldn't use the backup folder." : error.getMessage(), error);
        }
    }

    private String rootName(Uri tree) throws IOException {
        Uri root = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        try (Cursor cursor = resolver().query(root, new String[] { Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
            if (cursor == null || !cursor.moveToFirst()) throw new IOException("The folder is gone.");
            return cursor.getString(0);
        }
    }

    /** The document id of the folder at path inside the tree, made when create is set; null when missing. */
    private String folder(Uri tree, JSArray path, boolean create) throws Exception {
        String id = DocumentsContract.getTreeDocumentId(tree);
        StringBuilder key = new StringBuilder(tree.toString());
        List<String> names = path == null ? new ArrayList<>() : path.toList();
        for (String name : names) {
            key.append('/').append(name);
            String known = folders.get(key.toString());
            if (known != null) {
                id = known;
                continue;
            }
            Child child = find(tree, id, name);
            if (child != null && !child.directory) throw new IOException(name + " is a file.");
            if (child != null) id = child.id;
            else if (!create) return null;
            else {
                Uri made = DocumentsContract.createDocument(resolver(), DocumentsContract.buildDocumentUriUsingTree(tree, id), Document.MIME_TYPE_DIR, name);
                if (made == null) throw new IOException("Couldn't make the folder " + name + ".");
                id = DocumentsContract.getDocumentId(made);
            }
            folders.put(key.toString(), id);
        }
        return id;
    }

    private Child find(Uri tree, String folder, String name) throws IOException {
        for (Child child : children(tree, folder)) if (child.name.equals(name)) return child;
        return null;
    }

    private List<Child> children(Uri tree, String folder) throws IOException {
        Uri uri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, folder);
        String[] columns = { Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE, Document.COLUMN_SIZE };
        List<Child> children = new ArrayList<>();
        try (Cursor cursor = resolver().query(uri, columns, null, null, null)) {
            if (cursor == null) throw new IOException("Couldn't read the folder.");
            while (cursor.moveToNext()) {
                children.add(new Child(cursor.getString(0), cursor.getString(1), Document.MIME_TYPE_DIR.equals(cursor.getString(2)), cursor.isNull(3) ? 0 : cursor.getLong(3)));
            }
        }
        return children;
    }
}
