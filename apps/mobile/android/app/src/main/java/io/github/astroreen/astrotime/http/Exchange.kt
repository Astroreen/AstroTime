// One HTTP exchange on OkHttp, for any method (docs/plans/android.md#D62):
// the redirects are followed here, by the rule every platform follows, and
// plain http goes only to the origins the request names. No Android API is
// used, so the JVM tests run it as it is (app/src/test/).
package io.github.astroreen.astrotime.http

import java.io.IOException
import java.util.concurrent.TimeUnit
import okhttp3.CookieJar
import okhttp3.Headers
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** What the TypeScript side sends (`apps/mobile/src/http.ts`). */
data class HttpRequest(
    val method: String,
    val url: String,
    val headers: Map<String, String>,
    val body: String?,
    /** The origins plain http may reach on any hop, as `http://host:port`. */
    val cleartext: Set<String>,
)

/** The last hop's answer; repeated headers joined with ", ", by lower-case name. */
data class HttpResponse(
    val status: Int,
    val url: String,
    val headers: Map<String, String>,
    val body: String,
)

/** Why an exchange has no answer; `code` is what the TypeScript side tells apart. */
sealed class ExchangeException(val code: String, message: String, cause: Throwable? = null) :
    Exception(message, cause)

/** The server could not be reached, or the answer broke off. */
class Offline(message: String, cause: Throwable) : ExchangeException("offline", message, cause)

/** Plain http to an origin the user did not type. */
class CleartextRefused(url: HttpUrl) :
    ExchangeException("cleartext", "Plain http to ${origin(url)} is not an address the user typed.")

class TooManyRedirects(url: String) :
    ExchangeException("redirects", "$url redirected more than $MAX_REDIRECTS times.")

class InvalidRequest(message: String, cause: Throwable? = null) :
    ExchangeException("invalid", message, cause)

/** As many hops as the desktop follows (desktop D72). */
const val MAX_REDIRECTS = 10

private val REDIRECTS = setOf(301, 302, 303, 307, 308)

/** OkHttp refuses a body on these, and wants one (if empty) on the others. */
private val NO_BODY = setOf("GET", "HEAD")
private val NEEDS_BODY = setOf("POST", "PUT", "PATCH", "PROPPATCH", "REPORT")

/** What describes a body, dropped with it when a redirect turns the request into a GET (as `fetch`). */
/** What fetch drops on a redirect to another origin: whatever names a user. */
private val CREDENTIAL_HEADERS = setOf("authorization", "cookie", "proxy-authorization")

private val BODY_HEADERS =
    setOf("content-type", "content-length", "content-encoding", "content-language", "content-location")

/**
 * Scheme, host and port, written as a browser's `URL.origin` (the port left
 * out when it is the scheme's own): what `Authorization` and the cleartext
 * rule compare.
 */
fun origin(url: HttpUrl): String {
    val host = if (':' in url.host) "[${url.host}]" else url.host
    val port = if (url.port == HttpUrl.defaultPort(url.scheme)) "" else ":${url.port}"
    return "${url.scheme}://$host$port"
}

class Exchange(client: OkHttpClient = OkHttpClient()) {
    private val client =
        client
            .newBuilder()
            .followRedirects(false)
            .followSslRedirects(false)
            // No cookie jar: no cookies kept between requests.
            .cookieJar(CookieJar.NO_COOKIES)
            // A REPORT of a large calendar may take a while to start answering.
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build()

    fun run(request: HttpRequest): HttpResponse {
        var url = request.url.toHttpUrlOrNull() ?: throw InvalidRequest("${request.url} is no http or https URL.")
        var method = request.method
        var body = request.body
        var headers = request.headers
        var hops = 0
        while (true) {
            if (!url.isHttps && origin(url) !in request.cleartext) throw CleartextRefused(url)
            val call = client.newCall(build(method, url, headers, body))
            val response =
                try {
                    call.execute()
                } catch (error: IOException) {
                    throw Offline("$method $url could not reach the server.", error)
                }
            response.use {
                val next = it.header("Location")?.let(url::resolve)
                if (it.code !in REDIRECTS || next == null) {
                    val text =
                        try {
                            it.body.string()
                        } catch (error: IOException) {
                            throw Offline("$method $url: the answer broke off.", error)
                        }
                    return HttpResponse(it.code, it.request.url.toString(), joined(it.headers), text)
                }
                if (++hops > MAX_REDIRECTS) throw TooManyRedirects(request.url)
                // As `fetch` does: 303 turns anything but GET and HEAD into a GET,
                // 301 and 302 only a POST; 307 and 308 keep the method and body.
                val toGet =
                    (it.code == 303 && method !in NO_BODY) ||
                        ((it.code == 301 || it.code == 302) && method == "POST")
                if (toGet) {
                    method = "GET"
                    body = null
                    headers = headers.filterKeys { name -> name.lowercase() !in BODY_HEADERS }
                }
                // The credentials stay with the origin they were meant for, as fetch keeps them.
                if (origin(next) != origin(url)) {
                    headers = headers.filterKeys { name -> name.lowercase() !in CREDENTIAL_HEADERS }
                }
                url = next
            }
        }
    }

    private fun build(method: String, url: HttpUrl, headers: Map<String, String>, body: String?): Request {
        try {
            val content =
                when {
                    method in NO_BODY -> null
                    body != null -> body.toByteArray(Charsets.UTF_8).toRequestBody(null)
                    method in NEEDS_BODY -> ByteArray(0).toRequestBody(null)
                    else -> null
                }
            val builder = Request.Builder().url(url).method(method, content)
            for ((name, value) in headers) builder.addHeader(name, value)
            return builder.build()
        } catch (error: IllegalArgumentException) {
            throw InvalidRequest("$method $url: ${error.message}", error)
        }
    }

    private fun joined(headers: Headers): Map<String, String> =
        headers.names().associate { name -> name.lowercase() to headers.values(name).joinToString(", ") }
}
