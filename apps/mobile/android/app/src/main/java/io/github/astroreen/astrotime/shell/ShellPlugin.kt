// AstroTime's shell plugin (docs/plans/android.md#D68): the system bars
// follow the theme the app shows, which the user may set apart from the
// system's; and a file the user keeps (an inline attachment, design D230) is
// saved where they pick, through the system's "Save to" picker, which needs
// no storage permission. The TypeScript side is apps/mobile/src/shell.ts.
package io.github.astroreen.astrotime.shell

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.util.Base64
import androidx.activity.result.ActivityResult
import androidx.core.view.WindowCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
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

    /** Asks where to save `data` (base64) as `name`, then writes it there; resolves `{ saved }`. */
    @PluginMethod
    fun saveFile(call: PluginCall) {
        val name = call.getString("name")
        val data = call.getString("data")
        if (name.isNullOrBlank() || data == null) {
            call.reject("saveFile needs `name` and `data`.", "invalid")
            return
        }
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = call.getString("type")?.takeIf { it.isNotBlank() } ?: "application/octet-stream"
            putExtra(Intent.EXTRA_TITLE, name)
        }
        startActivityForResult(call, intent, "fileSaved")
    }

    @ActivityCallback
    private fun fileSaved(call: PluginCall, result: ActivityResult) {
        val target = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || target == null) {
            call.resolve(JSObject().put("saved", false))
            return
        }
        try {
            val bytes = Base64.decode(call.getString("data") ?: "", Base64.DEFAULT)
            val stream = context.contentResolver.openOutputStream(target, "w")
                ?: throw java.io.IOException("No stream for $target")
            stream.use { it.write(bytes) }
            call.resolve(JSObject().put("saved", true))
        } catch (error: Exception) {
            call.reject("The file could not be written.", "write", error)
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
