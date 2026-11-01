// Background sync's notifications on a device (docs/plans/android.md#D67),
// on the notifications plugin's own classes: a list the plugin refuses
// partway stops at the one refused, and every alarm armed before it has the
// record the plugin's boot receiver arms again after a reboot.
package io.github.astroreen.astrotime.background

import android.Manifest
import android.content.Context
import android.os.Build
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.capacitorjs.plugins.localnotifications.NotificationStorage
import java.text.SimpleDateFormat
import java.util.Date
import java.util.TimeZone
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PluginNotificationsTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val notifications = PluginNotifications(context)
    private val ids = listOf(990_001, 990_002, 990_003)

    @Before
    fun allow() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            InstrumentationRegistry.getInstrumentation().uiAutomation
                .grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    @After
    fun clear() = notifications.cancel(ids)

    /** A day ahead, as JavaScript's `Date` crosses the bridge (the plugin's `JS_DATE_FORMAT`). */
    private fun tomorrow(): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'")
            .apply { timeZone = TimeZone.getTimeZone("UTC") }
            .format(Date(System.currentTimeMillis() + 86_400_000))

    private fun reminder(id: Int, iconColor: String? = null) =
        JSONObject()
            .put("id", id)
            .put("title", "Reminder $id")
            .put("body", "Body")
            .put("channelId", "reminders")
            .put(
                "schedule",
                JSONObject().put("at", tomorrow())
                    .put("allowWhileIdle", true),
            ).apply { if (iconColor != null) put("iconColor", iconColor) }

    @Test
    fun aRefusalPartwayKeepsTheRecordsOfWhatWasArmed() {
        assertTrue(notifications.enabled())
        val list = JSONArray().put(reminder(ids[0])).put(reminder(ids[1], iconColor = "not a colour")).put(reminder(ids[2]))
        val refused = assertThrows(NotificationRefused::class.java) { notifications.schedule(list) }
        // The plugin's INVALID_COLOR.
        assertTrue(refused.message!!, refused.message!!.startsWith("OS-PLUG-LNOT-0006"))
        val kept = NotificationStorage(context).getSavedNotificationIds()
        assertTrue(ids[0].toString() in kept)
        assertTrue(ids[1].toString() !in kept)
        assertTrue(ids[2].toString() !in kept)
        assertEquals(listOf(ids[0]), notifications.pending().filter { it in ids })
    }
}
