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
                requestOf(call.data)
            } catch (error: InvalidRequest) {
                call.reject(error.message, error.code, error)
                return
            }
        threads.execute {
            try {
                call.resolve(JSObject.fromJSONObject(jsonOf(exchange.run(request))))
            } catch (error: ExchangeException) {
                call.reject(error.message, error.code, error, dataOf(error)?.let(JSObject::fromJSONObject))
            } catch (error: Throwable) {
                // Anything at all (an OutOfMemoryError on a huge answer too):
                // the call is answered, never left waiting.
                call.reject(error.message ?: error.toString(), "failed", Exception(error))
            }
        }
    }

    override fun handleOnDestroy() {
        threads.shutdownNow()
    }
}
