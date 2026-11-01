package io.github.astroreen.astrotime;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.res.Configuration;
import android.os.Build;
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
        createRemindersChannel();
    }

    /**
     * The channel reminders are posted to (apps/mobile/src/reminders.ts,
     * docs/plans/android.md#D66): high importance, so they show over the
     * screen with a sound. Created at every start, so its name follows the
     * system's language.
     */
    private void createRemindersChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            "reminders",
            getString(R.string.reminders_channel),
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription(getString(R.string.reminders_channel_description));
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // Capacitor's SystemBars has just styled the bars by the system's
        // theme; the theme the app shows wins (docs/plans/android.md#D68).
        Bars.apply(this);
    }
}
