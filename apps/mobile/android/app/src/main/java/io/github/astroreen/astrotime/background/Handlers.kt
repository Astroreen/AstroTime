// What background sync's page (apps/mobile/src/background/) calls on native
// (docs/plans/android.md#D67): HTTP on the plugin's `Exchange`, the
// credentials read as the secure storage plugin keeps them, and the
// notifications scheduled on the notifications plugin's own classes. One JSON
// message per call, answered under its id; no Android API here, so the JVM
// tests run it as it is.
package io.github.astroreen.astrotime.background

import io.github.astroreen.astrotime.http.Exchange
import io.github.astroreen.astrotime.http.ExchangeException
import io.github.astroreen.astrotime.http.dataOf
import io.github.astroreen.astrotime.http.jsonOf
import io.github.astroreen.astrotime.http.requestOf
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** An account's credentials by the key the app keeps them under (`account:<id>`); `null` when none can be read. */
fun interface Secrets {
    fun get(key: String): String?
}

/** What the run needs of `@capacitor/local-notifications` (`NativeNotifications` in reminders.ts). */
interface Notifications {
    /** The user lets the app notify. */
    fun enabled(): Boolean

    /** Alarms may be exact (always, before Android 12). */
    fun exact(): Boolean

    /** The ids the plugin holds a record of, scheduled or delivered (its `getPending`). */
    fun pending(): List<Int>

    /** Schedules these, each as the plugin's `schedule` takes it. */
    fun schedule(notifications: JSONArray)

    /** Cancels what is still to come under these ids. */
    fun cancel(ids: List<Int>)
}

class Handlers(
    private val exchange: Exchange,
    private val secrets: Secrets,
    private val notifications: Notifications,
    /** Runs a call off the WebView's thread: an exchange blocks until answered. */
    private val work: (Runnable) -> Unit,
    /** The page is done, with what it reports (`{ report }` or `{ error }`). */
    private val done: (JSONObject) -> Unit,
) {
    // Messages come on the WebView's thread, one at a time.
    private var ended = false

    /** One message from the page; `reply` takes the answer, as JSON text. */
    fun receive(message: String, reply: (String) -> Unit) {
        val json =
            try {
                JSONObject(message)
            } catch (error: JSONException) {
                return
            }
        val method = json.optString("method")
        val params = json.optJSONObject("params") ?: JSONObject()
        if (!json.has("id")) {
            // The first done wins: the page's error handlers may say it again.
            if (method == "done" && !ended) {
                ended = true
                done(params)
            }
            return
        }
        val id = json.get("id")
        work(
            Runnable {
                val answer =
                    try {
                        JSONObject().put("id", id).put("ok", true).put("value", call(method, params) ?: JSONObject.NULL)
                    } catch (error: ExchangeException) {
                        failure(id, error.code, error.message, dataOf(error))
                    } catch (error: Throwable) {
                        // Anything at all: the call is answered, never left waiting.
                        failure(id, "failed", error.message ?: error.toString(), null)
                    }
                reply(answer.toString())
            },
        )
    }

    private fun call(method: String, params: JSONObject): Any? =
        when (method) {
            "http" -> jsonOf(exchange.run(requestOf(params)))
            // An account's credentials only (`@astrotime/sync`'s `account:<id>`), whatever else the store holds.
            "secrets.get" ->
                params.getString("key").let { key ->
                    if (!key.startsWith("account:")) throw IllegalArgumentException("Not an account's key: $key")
                    secrets.get(key)
                }
            // Nobody can be asked in the background: a request is a check.
            "notifications.check", "notifications.request" ->
                JSONObject().put("display", granted(notifications.enabled()))
            "notifications.exact" -> JSONObject().put("exact_alarm", granted(notifications.exact()))
            "notifications.pending" ->
                JSONObject().put(
                    "notifications",
                    JSONArray().apply { notifications.pending().forEach { put(JSONObject().put("id", it)) } },
                )
            "notifications.schedule" -> notifications.schedule(params.getJSONArray("notifications")).let { null }
            "notifications.cancel" -> {
                val list = params.getJSONArray("notifications")
                notifications.cancel((0 until list.length()).map { list.getJSONObject(it).getInt("id") }).let { null }
            }
            else -> throw IllegalArgumentException("No handler for $method.")
        }

    private fun granted(yes: Boolean) = if (yes) "granted" else "denied"

    private fun failure(id: Any, code: String, message: String?, data: JSONObject?): JSONObject =
        JSONObject()
            .put("id", id)
            .put("ok", false)
            .put("code", code)
            .put("message", message ?: code)
            .apply { if (data != null) put("data", data) }
}
