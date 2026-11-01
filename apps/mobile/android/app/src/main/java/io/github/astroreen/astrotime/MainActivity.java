package io.github.astroreen.astrotime;

import android.content.res.Configuration;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import io.github.astroreen.astrotime.http.HttpPlugin;
import io.github.astroreen.astrotime.shell.Bars;
import io.github.astroreen.astrotime.shell.ShellPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugins, registered before the bridge starts.
        registerPlugin(HttpPlugin.class);
        registerPlugin(ShellPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // Capacitor's SystemBars has just styled the bars by the system's
        // theme; the theme the app shows wins (docs/plans/android.md#D68).
        Bars.apply(this);
    }
}
