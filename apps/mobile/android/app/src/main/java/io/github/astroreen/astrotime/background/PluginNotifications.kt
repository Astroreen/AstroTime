// Reminders scheduled as `@capacitor/local-notifications` 8.3.1 schedules
// them (docs/plans/android.md#D66), on its own classes with no bridge (D67):
// the same alarms, the same stored records its boot receiver arms again, and
// the same intent, so a tap opens the app on the item.
package io.github.astroreen.astrotime.background

import android.app.AlarmManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import com.capacitorjs.plugins.localnotifications.LocalNotification
import com.capacitorjs.plugins.localnotifications.LocalNotificationManager
import com.capacitorjs.plugins.localnotifications.NotificationStorage
import com.getcapacitor.CapConfig
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import org.json.JSONArray

class PluginNotifications(private val context: Context) : Notifications {
    private val storage = NotificationStorage(context)

    // No activity: a tap starts the app's launcher activity, MainActivity.
    private val manager = LocalNotificationManager(storage, null, context, CapConfig.loadDefault(context))

    override fun enabled(): Boolean = NotificationManagerCompat.from(context).areNotificationsEnabled()

    override fun exact(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()

    override fun schedule(notifications: JSONArray) {
        val list =
            (0 until notifications.length()).map {
                LocalNotification.buildNotificationFromJSObject(JSObject.fromJSONObject(notifications.getJSONObject(it)))
            }
        // As the plugin's `schedule`: the alarms, then the records its boot receiver reads.
        manager.schedule(null, list) ?: throw IllegalStateException("Notifications are off.")
        storage.appendNotifications(list)
    }

    override fun cancel(ids: List<Int>) {
        val notifications = JSArray().apply { ids.forEach { put(JSObject().put("id", it)) } }
        manager.cancel(Quiet(JSObject().put("notifications", notifications)))
    }

    /** The plugin's `cancel` takes a call and answers it; nobody waits for this one. */
    private class Quiet(data: JSObject) : PluginCall(null, "LocalNotifications", "-1", "cancel", data) {
        override fun resolve() {}

        override fun resolve(data: JSObject?) {}

        override fun reject(msg: String?, code: String?, ex: Exception?, data: JSObject?) {
            throw IllegalStateException(msg ?: code)
        }
    }
}
