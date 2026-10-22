package com.scottmttmn.mathtutor;

import android.content.ContentResolver;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;
import java.io.IOException;
import java.io.OutputStream;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Files being written a piece at a time (SaveFilePlugin, BackupFolderPlugin): the page sends a
 * file in base64 chunks of under a megabyte, since one string of a whole backup (every PDF) froze
 * the app. A file given up on is closed and deleted, so no half-written file is left behind.
 */
final class OpenFiles {

    private static final class Open {
        final OutputStream out;
        final Uri uri;

        Open(OutputStream out, Uri uri) {
            this.out = out;
            this.uri = uri;
        }
    }

    private static final Map<String, Open> open = new ConcurrentHashMap<>();
    private static final AtomicInteger next = new AtomicInteger(1);

    private OpenFiles() {}

    /** Opens the document for writing from its start; "w" where the provider doesn't take "wt". */
    static OutputStream openReplacing(ContentResolver resolver, Uri uri) throws IOException {
        OutputStream out;
        try {
            out = resolver.openOutputStream(uri, "wt");
        } catch (IllegalArgumentException | IOException unsupported) {
            out = resolver.openOutputStream(uri, "w");
        }
        if (out == null) throw new IOException("No stream for " + uri);
        return out;
    }

    static String add(OutputStream out, Uri uri) {
        String id = String.valueOf(next.getAndIncrement());
        open.put(id, new Open(out, uri));
        return id;
    }

    static void write(String id, String base64) throws IOException {
        Open file = id == null ? null : open.get(id);
        if (file == null) throw new IOException("That file isn't open.");
        file.out.write(Base64.decode(base64, Base64.DEFAULT));
    }

    static void close(String id) throws IOException {
        Open file = id == null ? null : open.remove(id);
        if (file == null) throw new IOException("That file isn't open.");
        file.out.close();
    }

    static void abort(ContentResolver resolver, String id) {
        Open file = id == null ? null : open.remove(id);
        if (file == null) return;
        try {
            file.out.close();
        } catch (IOException ignored) {
            // Deleted next anyway.
        }
        try {
            DocumentsContract.deleteDocument(resolver, file.uri);
        } catch (Exception ignored) {
            // The provider may not delete; the next backup writes it again.
        }
    }
}
