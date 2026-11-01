// AstroTime's HTTP plugin (docs/plans/android.md#D62): Capacitor's bridge to
// `Exchange`, which does the work off the bridge's thread.
package io.github.astroreen.astrotime.http

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

@CapacitorPlugin(name = "AstroTimeHttp")
class HttpPlugin : Plugin() {
    private val exchange = Exchange()

    /** Exchanges block until answered; each gets a thread, so one slow server holds up no other. */
    private val threads: ExecutorService = Executors.newCachedThreadPool()

    @PluginMethod
    fun request(call: PluginCall) {
        val request =
            try {
                read(call)
            } catch (error: InvalidRequest) {
                call.reject(error.message, error.code, error)
                return
            }
        threads.execute {
            try {
                call.resolve(write(exchange.run(request)))
            } catch (error: ExchangeException) {
                call.reject(error.message, error.code, error)
            } catch (error: RuntimeException) {
                call.reject(error.message, "failed", error)
            }
        }
    }

    override fun handleOnDestroy() {
        threads.shutdownNow()
    }

    private fun read(call: PluginCall): HttpRequest {
        val method = call.getString("method") ?: throw InvalidRequest("A request needs a method.")
        val url = call.getString("url") ?: throw InvalidRequest("A request needs a URL.")
        val headers = call.getObject("headers", JSObject())!!
        return HttpRequest(
            method = method,
            url = url,
            headers = headers.keys().asSequence().associateWith { headers.getString(it) ?: "" },
            body = call.getString("body"),
            cleartext = call.getArray("cleartext")?.toList<String>()?.toSet() ?: emptySet(),
        )
    }

    private fun write(response: HttpResponse): JSObject {
        val headers = JSObject()
        for ((name, value) in response.headers) headers.put(name, value)
        return JSObject()
            .put("status", response.status)
            .put("url", response.url)
            .put("headers", headers)
            .put("body", response.body)
    }
}
