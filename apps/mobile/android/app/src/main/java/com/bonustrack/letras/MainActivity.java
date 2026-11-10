package com.bonustrack.letras;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins propios de la app (antes de super.onCreate).
        registerPlugin(BleSyncPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
