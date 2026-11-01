// The HTTP plugin's exchange against OkHttp's MockWebServer
// (docs/plans/android.md#D69, tests): any method, the redirect rule of D62,
// where Authorization goes, plain http only where the user typed, no cookies.
package io.github.astroreen.astrotime.http

import java.net.InetAddress
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

private val LOOPBACK: InetAddress = InetAddress.getByName("127.0.0.1")

class ExchangeTest {
    private val certificate =
        HeldCertificate.Builder().addSubjectAlternativeName("a.test").addSubjectAlternativeName("b.test").build()
    private val servers = mutableListOf<MockWebServer>()

    // Every host name is this machine, so two origins can differ by host alone.
    private val exchange =
        Exchange(
            OkHttpClient.Builder()
                .dns { listOf(LOOPBACK) }
                .let {
                    val trusted = HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate).build()
                    it.sslSocketFactory(trusted.sslSocketFactory(), trusted.trustManager)
                }.build(),
        )

    @After
    fun close() = servers.forEach(MockWebServer::close)

    private fun server(https: Boolean = false): MockWebServer =
        MockWebServer().also {
            if (https) it.useHttps(HandshakeCertificates.Builder().heldCertificate(certificate).build().sslSocketFactory())
            it.start(LOOPBACK, 0)
            servers += it
        }

    private fun MockWebServer.at(host: String = "a.test", path: String = "/"): HttpUrl =
        url(path).newBuilder().host(host).build()

    private fun answer(code: Int, body: String = "", vararg headers: Pair<String, String>): MockResponse =
        MockResponse.Builder().code(code).body(body).apply { for ((n, v) in headers) addHeader(n, v) }.build()

    private fun redirect(code: Int, to: String) = answer(code, "", "Location" to to)

    private fun run(
        method: String,
        url: HttpUrl,
        headers: Map<String, String> = emptyMap(),
        body: String? = null,
        cleartext: Set<String> = servers.flatMap { listOf(origin(it.at("a.test")), origin(it.at("b.test"))) }.toSet(),
    ) = exchange.run(HttpRequest(method, url.toString(), headers, body, cleartext))

    @Test
    fun `PROPFIND, REPORT and MKCALENDAR pass with their bodies and headers`() {
        val server = server()
        server.enqueue(answer(207, "<multistatus/>", "Content-Type" to "application/xml"))
        server.enqueue(answer(207, "<report/>"))
        server.enqueue(answer(201))
        val propfind =
            run("PROPFIND", server.at(path = "/dav/"), mapOf("Depth" to "0", "Content-Type" to "application/xml"), "<propfind/>")
        assertEquals(207, propfind.status)
        assertEquals("<multistatus/>", propfind.body)
        assertEquals("application/xml", propfind.headers["content-type"])
        assertEquals(server.at(path = "/dav/").toString(), propfind.url)
        assertEquals(207, run("REPORT", server.at(path = "/cal/"), body = "<sync-collection/>").status)
        val sent = server.takeRequest()
        assertEquals("PROPFIND", sent.method)
        assertEquals("0", sent.headers["Depth"])
        assertEquals("application/xml", sent.headers["Content-Type"])
        assertEquals("<propfind/>", sent.body?.utf8())
        val report = server.takeRequest()
        assertEquals("REPORT", report.method)
        assertEquals("<sync-collection/>", report.body?.utf8())
        assertEquals(201, run("MKCALENDAR", server.at(path = "/new/")).status)
        assertEquals("MKCALENDAR", server.takeRequest().method)
    }

    @Test
    fun `a repeated header's values are joined, under its lower-case name`() {
        val server = server()
        server.enqueue(answer(200, "", "DAV" to "1, 2", "DAV" to "calendar-access"))
        assertEquals("1, 2, calendar-access", run("OPTIONS", server.at()).headers["dav"])
    }

    @Test
    fun `a redirect is followed, and the answer names the URL that answered`() {
        val server = server()
        server.enqueue(redirect(301, "/remote.php/dav/"))
        server.enqueue(answer(207, "<multistatus/>"))
        val response = run("PROPFIND", server.at(path = "/.well-known/caldav"), body = "<propfind/>")
        assertEquals(207, response.status)
        assertEquals(server.at(path = "/remote.php/dav/").toString(), response.url)
    }

    @Test
    fun `301 and 302 keep PROPFIND and REPORT with their bodies, and turn only a POST into a GET`() {
        val server = server()
        for (code in listOf(301, 302)) {
            for (method in listOf("PROPFIND", "REPORT")) {
                server.enqueue(redirect(code, "/next"))
                server.enqueue(answer(207))
                run(method, server.at(), mapOf("Content-Type" to "application/xml"), "<x/>")
                server.takeRequest()
                val followed = server.takeRequest()
                assertEquals(method, followed.method)
                assertEquals("<x/>", followed.body?.utf8())
            }
            server.enqueue(redirect(code, "/next"))
            server.enqueue(answer(200))
            run("POST", server.at(), mapOf("Content-Type" to "application/json"), "{}")
            server.takeRequest()
            val followed = server.takeRequest()
            assertEquals("GET", followed.method)
            assertEquals(0L, followed.bodySize)
            assertNull(followed.headers["Content-Type"])
        }
    }

    @Test
    fun `303 turns anything but GET and HEAD into a GET without its body`() {
        val server = server()
        for (method in listOf("PROPFIND", "POST", "PUT")) {
            server.enqueue(redirect(303, "/next"))
            server.enqueue(answer(200))
            run(method, server.at(), mapOf("Content-Type" to "text/calendar"), "BEGIN:VCALENDAR")
            server.takeRequest()
            val followed = server.takeRequest()
            assertEquals("GET", followed.method)
            assertEquals(0L, followed.bodySize)
            assertNull(followed.headers["Content-Type"])
        }
        server.enqueue(redirect(303, "/next"))
        server.enqueue(answer(200))
        run("HEAD", server.at())
        server.takeRequest()
        assertEquals("HEAD", server.takeRequest().method)
    }

    @Test
    fun `307 and 308 keep the method and the body`() {
        val server = server()
        for ((code, method) in listOf(307 to "POST", 308 to "PUT", 307 to "PROPFIND")) {
            server.enqueue(redirect(code, "/next"))
            server.enqueue(answer(201))
            run(method, server.at(), mapOf("Content-Type" to "text/calendar"), "BEGIN:VCALENDAR")
            server.takeRequest()
            val followed = server.takeRequest()
            assertEquals(method, followed.method)
            assertEquals("BEGIN:VCALENDAR", followed.body?.utf8())
            assertEquals("text/calendar", followed.headers["Content-Type"])
        }
    }

    private val authorization = mapOf("Authorization" to "Basic YXN0cm86cHc=")

    @Test
    fun `Authorization follows a redirect on the request's origin`() {
        val server = server()
        server.enqueue(redirect(301, "/next"))
        server.enqueue(answer(207))
        run("PROPFIND", server.at(), authorization)
        assertEquals("Basic YXN0cm86cHc=", server.takeRequest().headers["Authorization"])
        assertEquals("Basic YXN0cm86cHc=", server.takeRequest().headers["Authorization"])
    }

    @Test
    fun `Authorization is dropped when a redirect leaves the origin by host`() {
        val server = server()
        server.enqueue(redirect(301, server.at("b.test", "/next").toString()))
        server.enqueue(answer(207))
        val credentials = authorization + mapOf("Cookie" to "s=1", "Proxy-Authorization" to "Basic eDp5")
        val response = run("PROPFIND", server.at("a.test"), credentials)
        assertEquals(server.at("b.test", "/next").toString(), response.url)
        assertEquals("Basic YXN0cm86cHc=", server.takeRequest().headers["Authorization"])
        val next = server.takeRequest().headers
        assertNull(next["Authorization"])
        assertNull(next["Cookie"])
        assertNull(next["Proxy-Authorization"])
    }

    @Test
    fun `Authorization is dropped when a redirect leaves the origin by port`() {
        val first = server()
        val second = server()
        first.enqueue(redirect(307, second.at(path = "/next").toString()))
        second.enqueue(answer(207))
        run("PROPFIND", first.at(), authorization)
        assertEquals("Basic YXN0cm86cHc=", first.takeRequest().headers["Authorization"])
        assertNull(second.takeRequest().headers["Authorization"])
    }

    @Test
    fun `Authorization is dropped when a redirect leaves the origin by scheme`() {
        val plain = server()
        val secure = server(https = true)
        plain.enqueue(redirect(301, secure.at(path = "/next").toString()))
        secure.enqueue(answer(207))
        val response = run("PROPFIND", plain.at(), authorization)
        assertEquals(207, response.status)
        assertEquals(secure.at(path = "/next").toString(), response.url)
        assertEquals("Basic YXN0cm86cHc=", plain.takeRequest().headers["Authorization"])
        assertNull(secure.takeRequest().headers["Authorization"])
    }

    @Test
    fun `a certificate the phone does not trust, or for another name, is told apart from offline`() {
        val stranger = HeldCertificate.Builder().addSubjectAlternativeName("a.test").build()
        val untrusted = MockWebServer().also {
            it.useHttps(HandshakeCertificates.Builder().heldCertificate(stranger).build().sslSocketFactory())
            it.start(LOOPBACK, 0)
            servers += it
        }
        val refused = assertThrows(Untrusted::class.java) { run("PROPFIND", untrusted.at()) }
        assertEquals("certificate", refused.code)
        val misnamed = server(https = true)
        assertThrows(Untrusted::class.java) { run("PROPFIND", misnamed.at("c.test")) }
    }

    @Test
    fun `an https to http hop is refused before anything is sent`() {
        val secure = server(https = true)
        val plain = server()
        secure.enqueue(redirect(302, plain.at(path = "/next").toString()))
        val refused =
            assertThrows(CleartextRefused::class.java) {
                run("PROPFIND", secure.at(), authorization, cleartext = emptySet())
            }
        assertEquals("cleartext", refused.code)
        assertEquals(1, secure.requestCount)
        assertEquals(0, plain.requestCount)
    }

    @Test
    fun `plain http goes only to the origins the request names`() {
        val server = server()
        server.enqueue(answer(200, "ok"))
        assertThrows(CleartextRefused::class.java) { run("GET", server.at("a.test"), cleartext = setOf(origin(server.at("b.test")))) }
        assertEquals(0, server.requestCount)
        assertEquals("ok", run("GET", server.at("a.test"), cleartext = setOf(origin(server.at("a.test")))).body)
    }

    @Test
    fun `no cookies are kept, between requests or across a redirect`() {
        val server = server()
        server.enqueue(answer(302, "", "Set-Cookie" to "session=1; Path=/", "Location" to "/next"))
        server.enqueue(answer(200, "", "Set-Cookie" to "other=2; Path=/"))
        server.enqueue(answer(200))
        run("GET", server.at())
        run("GET", server.at())
        repeat(3) { assertNull(server.takeRequest().headers["Cookie"]) }
    }

    @Test
    fun `ten redirects are followed, an eleventh fails`() {
        val server = server()
        repeat(MAX_REDIRECTS) { server.enqueue(redirect(302, "/hop$it")) }
        server.enqueue(answer(200, "here"))
        assertEquals("here", run("GET", server.at()).body)
        repeat(MAX_REDIRECTS + 1) { server.enqueue(redirect(302, "/hop$it")) }
        assertEquals("redirects", assertThrows(TooManyRedirects::class.java) { run("GET", server.at()) }.code)
    }

    @Test
    fun `a server that cannot be reached is offline`() {
        val server = server()
        val gone = server.at()
        server.close()
        assertEquals("offline", assertThrows(Offline::class.java) { run("PROPFIND", gone) }.code)
    }

    @Test
    fun `an origin is written as a browser writes URL origin`() {
        assertEquals("http://10.0.2.2:5232", origin("http://10.0.2.2:5232/radicale/".toHttpUrl()))
        assertEquals("https://cloud.example.com", origin("https://Cloud.Example.com:443/x".toHttpUrl()))
        assertEquals("http://[::1]:8080", origin("http://[::1]:8080/".toHttpUrl()))
    }
}
