package io.github.astroreen.astrotime;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import io.github.astroreen.astrotime.http.HttpPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugins, registered before the bridge starts.
        registerPlugin(HttpPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
