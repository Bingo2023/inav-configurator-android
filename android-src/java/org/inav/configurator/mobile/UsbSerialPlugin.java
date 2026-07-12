package org.inav.configurator.mobile;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.hoho.android.usbserial.driver.UsbSerialDriver;
import com.hoho.android.usbserial.driver.UsbSerialPort;
import com.hoho.android.usbserial.driver.UsbSerialProber;
import com.hoho.android.usbserial.util.SerialInputOutputManager;

import java.io.IOException;
import java.util.List;

/**
 * Native Gegenstück zu shim/serialport.js.
 * Port-Pfade haben die Form "usb:&lt;androidDeviceId&gt;".
 * Events an JS: "data" {data: base64}, "error" {message}, "disconnected".
 */
@CapacitorPlugin(name = "UsbSerial")
public class UsbSerialPlugin extends Plugin implements SerialInputOutputManager.Listener {

    private static final String ACTION_USB_PERMISSION = "org.inav.configurator.mobile.USB_PERMISSION";
    private static final int WRITE_TIMEOUT_MS = 2000;

    private UsbSerialPort port;
    private SerialInputOutputManager ioManager;
    private PluginCall pendingOpenCall;
    private UsbSerialDriver pendingDriver;
    private int pendingBaudRate;

    private final BroadcastReceiver usbReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if (ACTION_USB_PERMISSION.equals(action)) {
                boolean granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false);
                PluginCall call = pendingOpenCall;
                UsbSerialDriver driver = pendingDriver;
                pendingOpenCall = null;
                pendingDriver = null;
                if (call == null || driver == null) return;
                if (granted) {
                    doOpen(driver, pendingBaudRate, call);
                } else {
                    call.reject("USB permission denied");
                }
            } else if (UsbManager.ACTION_USB_DEVICE_DETACHED.equals(action)) {
                closePortInternal();
                notifyListeners("disconnected", new JSObject());
            }
        }
    };

    @Override
    public void load() {
        IntentFilter filter = new IntentFilter();
        filter.addAction(ACTION_USB_PERMISSION);
        filter.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getContext().registerReceiver(usbReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(usbReceiver, filter);
        }
    }

    @Override
    protected void handleOnDestroy() {
        closePortInternal();
        try {
            getContext().unregisterReceiver(usbReceiver);
        } catch (IllegalArgumentException ignored) { }
    }

    @PluginMethod
    public void list(PluginCall call) {
        UsbManager usbManager = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
        List<UsbSerialDriver> drivers = UsbSerialProber.getDefaultProber().findAllDrivers(usbManager);
        JSArray ports = new JSArray();
        for (UsbSerialDriver driver : drivers) {
            UsbDevice dev = driver.getDevice();
            boolean hasPermission = usbManager.hasPermission(dev);
            JSObject o = new JSObject();
            o.put("path", "usb:" + dev.getDeviceId());
            // Produkt-/Herstellername & Seriennummer werfen ab Android 10 eine
            // SecurityException, solange keine USB-Berechtigung erteilt wurde —
            // deshalb nur mit Berechtigung abfragen, sonst Fallback-Werte.
            String name = driver.getClass().getSimpleName().replace("SerialDriver", "");
            String manufacturer = null;
            String serial = null;
            if (hasPermission) {
                try {
                    if (dev.getProductName() != null) name = dev.getProductName();
                    manufacturer = dev.getManufacturerName();
                    serial = dev.getSerialNumber();
                } catch (SecurityException ignored) { }
            }
            o.put("name", name);
            o.put("manufacturer", manufacturer != null ? manufacturer : name);
            o.put("vendorId", dev.getVendorId());
            o.put("productId", dev.getProductId());
            o.put("serialNumber", serial);
            ports.put(o);
        }
        JSObject result = new JSObject();
        result.put("ports", ports);
        call.resolve(result);
    }

    @PluginMethod
    public void open(PluginCall call) {
        String path = call.getString("path", "");
        int baudRate = call.getInt("baudRate", 115200);

        UsbManager usbManager = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
        UsbSerialDriver target = null;
        try {
            int deviceId = Integer.parseInt(path.replace("usb:", ""));
            for (UsbSerialDriver driver : UsbSerialProber.getDefaultProber().findAllDrivers(usbManager)) {
                if (driver.getDevice().getDeviceId() == deviceId) {
                    target = driver;
                    break;
                }
            }
        } catch (NumberFormatException e) {
            call.reject("Invalid port path: " + path);
            return;
        }
        if (target == null) {
            call.reject("Device not found: " + path);
            return;
        }

        if (!usbManager.hasPermission(target.getDevice())) {
            pendingOpenCall = call;
            pendingDriver = target;
            pendingBaudRate = baudRate;
            int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0;
            PendingIntent pi = PendingIntent.getBroadcast(
                    getContext(), 0,
                    new Intent(ACTION_USB_PERMISSION).setPackage(getContext().getPackageName()),
                    flags);
            usbManager.requestPermission(target.getDevice(), pi);
            return; // Antwort kommt im BroadcastReceiver
        }
        doOpen(target, baudRate, call);
    }

    private void doOpen(UsbSerialDriver driver, int baudRate, PluginCall call) {
        UsbManager usbManager = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
        UsbDeviceConnection connection = usbManager.openDevice(driver.getDevice());
        if (connection == null) {
            call.reject("Could not open USB device connection");
            return;
        }
        try {
            closePortInternal(); // evtl. alten Port schließen
            port = driver.getPorts().get(0);
            port.open(connection);
            port.setParameters(baudRate, 8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE);
            port.setDTR(true); // manche VCP-Stacks liefern sonst keine Daten
            port.setRTS(true);
            ioManager = new SerialInputOutputManager(port, this);
            ioManager.start();
            call.resolve();
        } catch (IOException e) {
            closePortInternal();
            call.reject("Failed to open port: " + e.getMessage());
        }
    }

    @PluginMethod
    public void write(PluginCall call) {
        if (port == null) {
            call.reject("Port not open");
            return;
        }
        try {
            byte[] data = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
            port.write(data, WRITE_TIMEOUT_MS);
            call.resolve();
        } catch (IOException | IllegalArgumentException e) {
            call.reject("Write failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void setBaudRate(PluginCall call) {
        if (port == null) {
            call.reject("Port not open");
            return;
        }
        try {
            port.setParameters(call.getInt("baudRate", 115200), 8,
                    UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE);
            call.resolve();
        } catch (IOException e) {
            call.reject("setBaudRate failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void close(PluginCall call) {
        closePortInternal();
        call.resolve();
    }

    private void closePortInternal() {
        if (ioManager != null) {
            ioManager.setListener(null);
            ioManager.stop();
            ioManager = null;
        }
        if (port != null) {
            try {
                port.close();
            } catch (IOException ignored) { }
            port = null;
        }
    }

    // --- SerialInputOutputManager.Listener ---

    @Override
    public void onNewData(byte[] data) {
        JSObject o = new JSObject();
        o.put("data", Base64.encodeToString(data, Base64.NO_WRAP));
        notifyListeners("data", o);
    }

    @Override
    public void onRunError(Exception e) {
        JSObject o = new JSObject();
        o.put("message", e.getMessage());
        notifyListeners("error", o);
    }
}
