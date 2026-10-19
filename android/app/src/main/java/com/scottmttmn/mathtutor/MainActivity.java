package com.scottmttmn.mathtutor;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugins are registered before the bridge starts.
        registerPlugin(SaveFilePlugin.class);
        registerPlugin(DeviceKeysPlugin.class);
        registerPlugin(ChatGPTSignInPlugin.class);
        registerPlugin(BooxPenPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
