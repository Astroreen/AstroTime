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

/** What the plugin refused (its own words and code), or that notifications are off. */
class NotificationRefused(message: String) : Exception(message)

class PluginNotifications(private val context: Context) : Notifications {
    private val storage = NotificationStorage(context)

    // No activity: a tap starts the app's launcher activity, MainActivity.
    private val manager = LocalNotificationManager(storage, null, context, CapConfig.loadDefault(context))

    override fun enabled(): Boolean = NotificationManagerCompat.from(context).areNotificationsEnabled()

    override fun exact(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()

    override fun pending(): List<Int> = storage.getSavedNotifications().mapNotNull { it.id }

    /**
     * One at a time, each alarm then its record, as the plugin's `schedule`
     * does for a whole list: a refusal stops at the one refused, and every
     * alarm armed before it has the record the boot receiver arms again.
     */
    override fun schedule(notifications: JSONArray) {
        val list =
            (0 until notifications.length()).map {
                LocalNotification.buildNotificationFromJSObject(JSObject.fromJSONObject(notifications.getJSONObject(it)))
            }
        for (notification in list) {
            manager.schedule(Quiet("schedule", JSObject()), listOf(notification))
                ?: throw NotificationRefused("Notifications are off.")
            storage.appendNotifications(listOf(notification))
        }
    }

    override fun cancel(ids: List<Int>) {
        val notifications = JSArray().apply { ids.forEach { put(JSObject().put("id", it)) } }
        manager.cancel(Quiet("cancel", JSObject().put("notifications", notifications)))
    }

    /**
     * The plugin's calls take a call and answer it; nobody waits for these.
     * A refusal throws, so it stops the work where the plugin said it, never
     * reaching a bridge there is none of.
     */
    private class Quiet(method: String, data: JSObject) :
        PluginCall(null, "LocalNotifications", "-1", method, data) {
        override fun resolve() {}

        override fun resolve(data: JSObject?) {}

        override fun reject(msg: String?, code: String?, ex: Exception?, data: JSObject?) {
            throw NotificationRefused("${code ?: "refused"}: ${msg ?: ""}")
        }

        override fun errorCallback(msg: String?) {
            throw NotificationRefused(msg ?: "refused")
        }
    }
}
