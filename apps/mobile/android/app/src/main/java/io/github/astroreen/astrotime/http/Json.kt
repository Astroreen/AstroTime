// An exchange as JSON, as both its callers send it (docs/plans/android.md#D62):
// Capacitor's bridge (`HttpPlugin`) and background sync's WebView
// (`background/Handlers`, D67). `org.json` only, so the JVM tests read it too.
package io.github.astroreen.astrotime.http

import org.json.JSONObject

/** The request `apps/mobile/src/http.ts` sends (`NativeRequest`). */
fun requestOf(json: JSONObject): HttpRequest {
    val method = json.stringOrNull("method") ?: throw InvalidRequest("A request needs a method.")
    val url = json.stringOrNull("url") ?: throw InvalidRequest("A request needs a URL.")
    val headers = json.optJSONObject("headers") ?: JSONObject()
    val cleartext = json.optJSONArray("cleartext")
    return HttpRequest(
        method = method,
        url = url,
        headers = headers.keys().asSequence().associateWith { headers.optString(it, "") },
        body = json.stringOrNull("body"),
        cleartext =
            (0 until (cleartext?.length() ?: 0))
                .map { cleartext!!.get(it) as? String ?: throw InvalidRequest("The cleartext origins are not a list of strings.") }
                .toSet(),
    )
}

/** Its answer (`NativeResponse`). */
fun jsonOf(response: HttpResponse): JSONObject {
    val headers = JSONObject()
    for ((name, value) in response.headers) headers.put(name, value)
    return JSONObject()
        .put("status", response.status)
        .put("url", response.url)
        .put("headers", headers)
        .put("body", response.body)
}

/** What the TypeScript side reads with a refusal: the hop's origin for `cleartext`. */
fun dataOf(error: ExchangeException): JSONObject? =
    if (error is CleartextRefused) JSONObject().put("origin", error.origin) else null

private fun JSONObject.stringOrNull(name: String): String? = if (isNull(name)) null else getString(name)
