package org.inav.configurator.mobile;

import android.os.Bundle;
import android.webkit.WebSettings;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-lokales Plugin registrieren (VOR super.onCreate)
        registerPlugin(UsbSerialPlugin.class);
        super.onCreate(savedInstanceState);

        // Desktop-UI auf kleinere Displays einpassen
        WebSettings s = getBridge().getWebView().getSettings();
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
    }
}
