// AstroTime's shell plugin (docs/plans/android.md#D68): the system bars
// follow the theme the app shows, which the user may set apart from the
// system's. The TypeScript side is apps/mobile/src/shell.ts.
package io.github.astroreen.astrotime.shell

import android.app.Activity
import android.graphics.Color
import androidx.core.view.WindowCompat
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "AstroTimeShell")
class ShellPlugin : Plugin() {
    @PluginMethod
    fun setBars(call: PluginCall) {
        val dark = call.getBoolean("dark")
        if (dark == null) {
            call.reject("setBars needs `dark`.", "invalid")
            return
        }
        val background = call.getString("background")?.let { runCatching { Color.parseColor(it) }.getOrNull() }
        activity.runOnUiThread {
            Bars.set(activity, Bars.Style(dark, background))
            call.resolve()
        }
    }
}

/** The bars' style the app asked for last, kept to be put back after a configuration change. */
object Bars {
    data class Style(val dark: Boolean, val background: Int?)

    private var style: Style? = null

    fun set(activity: Activity, style: Style) {
        this.style = style
        apply(activity)
    }

    /**
     * Light icons on a dark theme, dark ones on a light theme; and the
     * window's background, which shows behind the bars when Capacitor keeps
     * the WebView clear of them (a WebView before Chromium 140). Capacitor's
     * SystemBars sets both from the system's theme on every configuration
     * change, so `MainActivity` calls this again after it.
     */
    @JvmStatic
    fun apply(activity: Activity) {
        val style = style ?: return
        val window = activity.window
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = !style.dark
            isAppearanceLightNavigationBars = !style.dark
        }
        style.background?.let { window.decorView.setBackgroundColor(it) }
    }
}
