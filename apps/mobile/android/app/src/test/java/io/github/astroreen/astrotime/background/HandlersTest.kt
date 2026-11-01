// Background sync's handlers (docs/plans/android.md#D67) on the JVM: each
// call answered under its id, HTTP on the plugin's own `Exchange` against
// OkHttp's MockWebServer, the credentials and the notifications through
// fakes, and the page's end heard once.
package io.github.astroreen.astrotime.background

import io.github.astroreen.astrotime.http.Exchange
import java.net.InetAddress
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HandlersTest {
    private val server = MockWebServer().apply { start(InetAddress.getByName("127.0.0.1"), 0) }
    private val scheduled = mutableListOf<JSONArray>()
    private val cancelled = mutableListOf<List<Int>>()
    private var enabled = true
    private val done = mutableListOf<JSONObject>()

    private val notifications =
        object : Notifications {
            override fun enabled() = enabled

            override fun exact() = false

            override fun schedule(notifications: JSONArray) {
                if (!enabled) throw IllegalStateException("Notifications are off.")
                scheduled += notifications
            }

            override fun cancel(ids: List<Int>) {
                cancelled += ids
            }
        }

    // Calls run at once, on the test's thread, so each answer is there when `receive` returns.
    private val handlers =
        Handlers(
            Exchange(),
            Secrets { key -> if (key == "account:a") """{"username":"u","password":"p"}""" else null },
            notifications,
            { it.run() },
        ) { done += it }

    /** The server's origin as the page writes it (`http://localhost:port`). */
    private val origin = server.url("/").toString().trimEnd('/')

    @After
    fun close() = server.close()

    private fun call(id: Int, method: String, params: JSONObject = JSONObject()): JSONObject {
        val answers = mutableListOf<String>()
        handlers.receive(JSONObject().put("id", id).put("method", method).put("params", params).toString()) {
            answers += it
        }
        assertEquals(1, answers.size)
        return JSONObject(answers.single()).also { assertEquals(id, it.getInt("id")) }
    }

    @Test
    fun `http runs any method through the exchange`() {
        server.enqueue(MockResponse.Builder().code(207).body("<multistatus/>").addHeader("DAV", "1").build())
        val answer =
            call(
                1,
                "http",
                JSONObject()
                    .put("method", "PROPFIND")
                    .put("url", server.url("/dav/").toString())
                    .put("headers", JSONObject().put("Depth", "0"))
                    .put("body", "<propfind/>")
                    .put("cleartext", JSONArray().put(origin)),
            )
        assertTrue(answer.getBoolean("ok"))
        val value = answer.getJSONObject("value")
        assertEquals(207, value.getInt("status"))
        assertEquals("<multistatus/>", value.getString("body"))
        assertEquals("1", value.getJSONObject("headers").getString("dav"))
        val request = server.takeRequest()
        assertEquals("PROPFIND", request.method)
        assertEquals("0", request.headers["Depth"])
    }

    @Test
    fun `a refusal comes back with the plugin's code and data`() {
        val answer =
            call(
                2,
                "http",
                JSONObject().put("method", "GET").put("url", server.url("/").toString()).put("cleartext", JSONArray()),
            )
        assertFalse(answer.getBoolean("ok"))
        assertEquals("cleartext", answer.getString("code"))
        assertEquals(origin, answer.getJSONObject("data").getString("origin"))
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `an unreachable server is offline`() {
        val url = server.url("/").toString()
        server.close()
        val answer =
            call(3, "http", JSONObject().put("method", "GET").put("url", url).put("cleartext", JSONArray().put(url.trimEnd('/'))))
        assertEquals("offline", answer.getString("code"))
    }

    @Test
    fun `secrets are read by key, none as null`() {
        assertEquals(
            """{"username":"u","password":"p"}""",
            call(4, "secrets.get", JSONObject().put("key", "account:a")).getString("value"),
        )
        assertTrue(call(5, "secrets.get", JSONObject().put("key", "account:b")).isNull("value"))
    }

    @Test
    fun `the permissions read as granted or denied, never prompt`() {
        assertEquals("granted", call(6, "notifications.check").getJSONObject("value").getString("display"))
        enabled = false
        assertEquals("denied", call(7, "notifications.check").getJSONObject("value").getString("display"))
        assertEquals("denied", call(8, "notifications.exact").getJSONObject("value").getString("exact_alarm"))
    }

    @Test
    fun `notifications are scheduled and cancelled as sent`() {
        val notification = JSONObject().put("id", 7).put("title", "Dentist").put("channelId", "reminders")
        assertTrue(call(9, "notifications.schedule", JSONObject().put("notifications", JSONArray().put(notification))).getBoolean("ok"))
        assertEquals("Dentist", scheduled.single().getJSONObject(0).getString("title"))
        val ids = JSONArray().put(JSONObject().put("id", 7)).put(JSONObject().put("id", 9))
        assertTrue(call(10, "notifications.cancel", JSONObject().put("notifications", ids)).getBoolean("ok"))
        assertEquals(listOf(7, 9), cancelled.single())
    }

    @Test
    fun `a failure is answered, never left waiting`() {
        enabled = false
        val answer = call(11, "notifications.schedule", JSONObject().put("notifications", JSONArray()))
        assertEquals("failed", answer.getString("code"))
        assertEquals("Notifications are off.", answer.getString("message"))
        assertEquals("failed", call(12, "nothing.here").getString("code"))
    }

    @Test
    fun `the end is heard, and nothing is answered for it`() {
        var answered = false
        handlers.receive("""{"method":"done","params":{"report":{"accounts":[]}}}""") { answered = true }
        handlers.receive("not json") { answered = true }
        assertFalse(answered)
        assertEquals(1, done.size)
        assertTrue(done.single().has("report"))
    }
}
