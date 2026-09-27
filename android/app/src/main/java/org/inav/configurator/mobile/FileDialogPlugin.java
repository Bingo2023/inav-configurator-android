package org.inav.configurator.mobile;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

import android.util.Base64;
import android.util.Log;

/**
 * Datei-Dialoge über das Android Storage Access Framework (SAF).
 * - showSaveDialog: System-"Dokument erstellen"-Dialog (Ordner + Name frei wählbar,
 *   Android merkt sich den zuletzt benutzten Ordner automatisch — auch Cloud-Ziele).
 * - showOpenDialog: System-Dateiauswahl.
 * - writeFile/readFile: Text über die vom Dialog gelieferte content://-URI.
 *   Mit encoding="base64" auch Binärdaten (z.B. ZIP aus dem Map Generator).
 * - openWrite/writeChunk/closeWrite: große Binärdateien stückweise schreiben,
 *   damit nicht die ganze Datei auf einmal durch die JS-Brücke muss.
 * - pickDirectory + tree*: Ordnerzugriff (ACTION_OPEN_DOCUMENT_TREE) mit dauerhafter
 *   Berechtigung. Relative Pfade ("a/b/c.TER") werden unterhalb des Ordners
 *   aufgelöst, fehlende Unterordner angelegt. Verzeichnisinhalte werden einmal
 *   gelistet und gecacht — sonst wäre jeder Zugriff bei Tausenden Kartenkacheln
 *   eine komplette Ordnerauflistung.
 * Gegenstück im JS: shim/electron-api.js (showSaveDialog/showOpenDialog/writeFile/readFile).
 */
@CapacitorPlugin(name = "FileDialog")
public class FileDialogPlugin extends Plugin {

    private final Map<Integer, OutputStream> openStreams = new HashMap<>();
    private int nextStreamId = 1;

    // Ordner-Cache: "<tree>|<parentDocId>|<name>" → docId; listedDirs: bereits gelistete Ordner
    private final Map<String, String> childCache = new HashMap<>();
    private final Set<String> listedDirs = new HashSet<>();
    private static final String TAG = "InavFileDialog";
    private static final String FILE_MIME = "application/octet-stream"; // Dateiname bleibt exakt (.TER, FREESPAC.E)

    @PluginMethod
    public void showSaveDialog(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mimeType", "text/plain"));
        intent.putExtra(Intent.EXTRA_TITLE, call.getString("defaultName", "inav-cli.txt"));
        startActivityForResult(call, intent, "saveDialogResult");
    }

    @ActivityCallback
    private void saveDialogResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            ret.put("canceled", true);
        } else {
            ret.put("canceled", false);
            ret.put("uri", data.getData().toString());
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void showOpenDialog(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        // .cli/.txt haben keine verlässlichen MIME-Types → alles zulassen
        intent.setType("*/*");
        startActivityForResult(call, intent, "openDialogResult");
    }

    @ActivityCallback
    private void openDialogResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            ret.put("canceled", true);
            ret.put("uris", new JSArray());
        } else {
            ret.put("canceled", false);
            JSArray uris = new JSArray();
            uris.put(data.getData().toString());
            ret.put("uris", uris);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void writeFile(PluginCall call) {
        String uriStr = call.getString("uri");
        String content = call.getString("data", "");
        if (uriStr == null) {
            call.reject("Missing uri");
            return;
        }
        try (OutputStream os = getContext().getContentResolver()
                .openOutputStream(Uri.parse(uriStr), "wt")) {
            if (os == null) throw new Exception("Could not open output stream");
            if ("base64".equals(call.getString("encoding"))) {
                os.write(Base64.decode(content, Base64.DEFAULT));
            } else {
                os.write(content.getBytes(StandardCharsets.UTF_8));
            }
            os.flush();
            call.resolve();
        } catch (Exception e) {
            call.reject("Write failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void readFile(PluginCall call) {
        String uriStr = call.getString("uri");
        if (uriStr == null) {
            call.reject("Missing uri");
            return;
        }
        try (InputStream is = getContext().getContentResolver().openInputStream(Uri.parse(uriStr))) {
            if (is == null) throw new Exception("Could not open input stream");
            if ("base64".equals(call.getString("encoding"))) {
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] bbuf = new byte[65536];
                int r;
                while ((r = is.read(bbuf)) > 0) bos.write(bbuf, 0, r);
                JSObject bret = new JSObject();
                bret.put("data", Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP));
                call.resolve(bret);
                return;
            }
            StringBuilder sb = new StringBuilder();
            BufferedReader reader = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8));
            char[] buf = new char[8192];
            int n;
            while ((n = reader.read(buf)) > 0) sb.append(buf, 0, n);
            JSObject ret = new JSObject();
            ret.put("data", sb.toString());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Read failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void openWrite(PluginCall call) {
        String uriStr = call.getString("uri");
        if (uriStr == null) {
            call.reject("Missing uri");
            return;
        }
        try {
            OutputStream os = getContext().getContentResolver().openOutputStream(Uri.parse(uriStr), "wt");
            if (os == null) throw new Exception("Could not open output stream");
            int id;
            synchronized (openStreams) {
                id = nextStreamId++;
                openStreams.put(id, os);
            }
            JSObject ret = new JSObject();
            ret.put("id", id);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Open failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void writeChunk(PluginCall call) {
        Integer id = call.getInt("id");
        OutputStream os;
        synchronized (openStreams) {
            os = id == null ? null : openStreams.get(id);
        }
        if (os == null) {
            call.reject("Unknown stream");
            return;
        }
        try {
            os.write(Base64.decode(call.getString("data", ""), Base64.DEFAULT));
            call.resolve();
        } catch (Exception e) {
            closeQuietly(id);
            call.reject("Write failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void closeWrite(PluginCall call) {
        Integer id = call.getInt("id");
        OutputStream os;
        synchronized (openStreams) {
            os = id == null ? null : openStreams.remove(id);
        }
        if (os == null) {
            call.reject("Unknown stream");
            return;
        }
        try {
            os.flush();
            os.close();
            call.resolve();
        } catch (Exception e) {
            call.reject("Close failed: " + e.getMessage());
        }
    }

    private void closeQuietly(Integer id) {
        OutputStream os;
        synchronized (openStreams) {
            os = openStreams.remove(id);
        }
        if (os != null) {
            try { os.close(); } catch (Exception ignored) { }
        }
    }

    /* ======================= Ordnerzugriff (SAF-Tree) ======================= */

    @PluginMethod
    public void pickDirectory(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "pickDirectoryResult");
    }

    @ActivityCallback
    private void pickDirectoryResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            ret.put("canceled", true);
            call.resolve(ret);
            return;
        }
        Uri tree = data.getData();
        // Nur die Rechte dauerhaft machen, die Android tatsächlich vergeben hat
        int granted = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        if (granted == 0) granted = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
        boolean persisted = false;
        try {
            getContext().getContentResolver().takePersistableUriPermission(tree, granted);
            persisted = true;
        } catch (Exception e) {
            // Weiter mit der Sitzungs-Berechtigung (gilt bis zum App-Neustart)
            Log.w(TAG, "takePersistableUriPermission fehlgeschlagen für " + tree + " (flags=" + data.getFlags() + ")", e);
        }
        Log.i(TAG, "pickDirectory: " + tree + " flags=" + data.getFlags() + " persisted=" + persisted);
        clearTreeCache(tree.toString());
        ret.put("canceled", false);
        ret.put("uri", tree.toString());
        ret.put("persisted", persisted);
        call.resolve(ret);
    }

    /** Existenz/Größe eines Pfades unterhalb des Ordners (path leer = Ordner selbst). */
    @PluginMethod
    public void treeStat(PluginCall call) {
        String treeStr = call.getString("tree");
        if (treeStr == null) { call.reject("Missing tree"); return; }
        JSObject ret = new JSObject();
        try {
            Uri tree = Uri.parse(treeStr);
            // Fehlende Dauer-Berechtigung nur protokollieren — die Sitzungs-Berechtigung
            // aus der Ordnerwahl reicht; ob der Zugriff klappt, entscheidet die Abfrage.
            if (!hasPersistedPermission(tree)) Log.w(TAG, "treeStat: keine dauerhafte Berechtigung für " + tree);
            Uri doc = resolve(tree, call.getString("path", ""), false);
            if (doc == null) {
                ret.put("exists", false);
                call.resolve(ret);
                return;
            }
            ContentResolver cr = getContext().getContentResolver();
            try (Cursor c = cr.query(doc, new String[] { Document.COLUMN_SIZE, Document.COLUMN_MIME_TYPE }, null, null, null)) {
                if (c == null || !c.moveToFirst()) {
                    Log.w(TAG, "treeStat: Abfrage leer für " + doc);
                    clearTreeCache(treeStr); // veraltet (extern gelöscht?)
                    ret.put("exists", false);
                } else {
                    ret.put("exists", true);
                    ret.put("size", c.isNull(0) ? 0 : c.getLong(0));
                    ret.put("isDir", Document.MIME_TYPE_DIR.equals(c.getString(1)));
                    ret.put("uri", doc.toString());
                }
            }
            call.resolve(ret);
        } catch (Exception e) {
            Log.w(TAG, "treeStat fehlgeschlagen für " + treeStr + " / " + call.getString("path", ""), e);
            ret.put("exists", false);
            ret.put("error", String.valueOf(e.getMessage()));
            call.resolve(ret);
        }
    }

    /** Datei (inkl. fehlender Unterordner) anlegen und ihre URI liefern — für stückweises Schreiben. */
    @PluginMethod
    public void treeResolve(PluginCall call) {
        String treeStr = call.getString("tree");
        String path = call.getString("path");
        if (treeStr == null || path == null) { call.reject("Missing tree/path"); return; }
        try {
            Uri doc = resolve(Uri.parse(treeStr), path, true);
            JSObject ret = new JSObject();
            ret.put("uri", doc.toString());
            call.resolve(ret);
        } catch (Exception e) {
            clearTreeCache(treeStr);
            call.reject("Anlegen fehlgeschlagen: " + e.getMessage());
        }
    }

    /** Datei unterhalb des Ordners in einem Rutsch schreiben (Text oder base64). */
    @PluginMethod
    public void treeWrite(PluginCall call) {
        String treeStr = call.getString("tree");
        String path = call.getString("path");
        if (treeStr == null || path == null) { call.reject("Missing tree/path"); return; }
        String content = call.getString("data", "");
        byte[] bytes = "base64".equals(call.getString("encoding"))
                ? Base64.decode(content, Base64.DEFAULT)
                : content.getBytes(StandardCharsets.UTF_8);
        Uri tree = Uri.parse(treeStr);
        Exception last = null;
        for (int attempt = 0; attempt < 2; attempt++) {   // 2. Versuch mit frischem Cache
            try {
                Uri doc = resolve(tree, path, true);
                try (OutputStream os = getContext().getContentResolver().openOutputStream(doc, "wt")) {
                    if (os == null) throw new Exception("Could not open output stream");
                    os.write(bytes);
                    os.flush();
                }
                call.resolve();
                return;
            } catch (Exception e) {
                last = e;
                clearTreeCache(treeStr);
            }
        }
        Log.w(TAG, "treeWrite fehlgeschlagen: " + path, last);
        call.reject("Write failed: " + (last != null ? last.getMessage() : "unknown"));
    }

    @PluginMethod
    public void treeDelete(PluginCall call) {
        String treeStr = call.getString("tree");
        String path = call.getString("path");
        if (treeStr == null || path == null || path.isEmpty()) { call.reject("Missing tree/path"); return; }
        try {
            Uri doc = resolve(Uri.parse(treeStr), path, false);
            if (doc != null) DocumentsContract.deleteDocument(getContext().getContentResolver(), doc);
            clearTreeCache(treeStr);
            call.resolve();
        } catch (Exception e) {
            clearTreeCache(treeStr);
            call.resolve(); // existiert nicht / schon weg → wie rm -f
        }
    }

    private boolean hasPersistedPermission(Uri tree) {
        for (UriPermission p : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (p.getUri().equals(tree) && p.isWritePermission()) return true;
        }
        return false;
    }

    private synchronized void clearTreeCache(String tree) {
        String prefix = tree + "|";
        childCache.keySet().removeIf(k -> k.startsWith(prefix));
        listedDirs.removeIf(k -> k.startsWith(prefix));
    }

    private synchronized String findChild(Uri tree, String parentDocId, String name) {
        String dirKey = tree + "|" + parentDocId;
        if (!listedDirs.contains(dirKey)) {
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentDocId);
            try (Cursor c = getContext().getContentResolver().query(children,
                    new String[] { Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
                if (c != null) {
                    while (c.moveToNext()) childCache.put(dirKey + "|" + c.getString(1), c.getString(0));
                }
            }
            listedDirs.add(dirKey);
        }
        return childCache.get(dirKey + "|" + name);
    }

    /** Relativen Pfad unter dem Ordner auflösen; create=true legt Unterordner und Datei an. */
    private synchronized Uri resolve(Uri tree, String relPath, boolean create) throws Exception {
        String docId = DocumentsContract.getTreeDocumentId(tree);
        String[] parts = relPath == null ? new String[0] : relPath.split("/");
        int n = 0;
        for (String part : parts) if (!part.isEmpty()) n++;
        int i = 0;
        for (String name : parts) {
            if (name.isEmpty()) continue;
            boolean last = ++i == n;
            String child = findChild(tree, docId, name);
            if (child == null) {
                if (!create) return null;
                Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, docId);
                Uri created = DocumentsContract.createDocument(getContext().getContentResolver(), parent,
                        last ? FILE_MIME : Document.MIME_TYPE_DIR, name);
                if (created == null) throw new Exception("createDocument lieferte null für " + name);
                child = DocumentsContract.getDocumentId(created);
                childCache.put(tree + "|" + docId + "|" + name, child);
                if (!last) listedDirs.add(tree + "|" + child); // neuer Ordner ist leer
            }
            docId = child;
        }
        return DocumentsContract.buildDocumentUriUsingTree(tree, docId);
    }
}
