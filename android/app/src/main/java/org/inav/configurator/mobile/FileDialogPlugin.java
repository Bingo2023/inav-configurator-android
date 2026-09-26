package org.inav.configurator.mobile;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;

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
import java.util.Map;

import android.util.Base64;

/**
 * Datei-Dialoge über das Android Storage Access Framework (SAF).
 * - showSaveDialog: System-"Dokument erstellen"-Dialog (Ordner + Name frei wählbar,
 *   Android merkt sich den zuletzt benutzten Ordner automatisch — auch Cloud-Ziele).
 * - showOpenDialog: System-Dateiauswahl.
 * - writeFile/readFile: Text über die vom Dialog gelieferte content://-URI.
 *   Mit encoding="base64" auch Binärdaten (z.B. ZIP aus dem Map Generator).
 * - openWrite/writeChunk/closeWrite: große Binärdateien stückweise schreiben,
 *   damit nicht die ganze Datei auf einmal durch die JS-Brücke muss.
 * Gegenstück im JS: shim/electron-api.js (showSaveDialog/showOpenDialog/writeFile/readFile).
 */
@CapacitorPlugin(name = "FileDialog")
public class FileDialogPlugin extends Plugin {

    private final Map<Integer, OutputStream> openStreams = new HashMap<>();
    private int nextStreamId = 1;

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
}
