// One run of background sync's page in a WebView of its own, created with
// the application's context and no activity or window
// (docs/plans/android.md#D67). It serves the app's own files on the app's
// origin, `https://localhost`, so it shares the open app's OPFS store, Web
// Locks and BroadcastChannels, and it answers the page's calls (`Handlers`)
// through the one object it injects, for that origin only. It ends when the
// page says it is done; when the page says in its title that it found no
// such object, failed to load, or lost its renderer; the WebView is
// destroyed whatever happens, which lets go of the store.
package io.github.astroreen.astrotime.background

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import io.github.astroreen.astrotime.http.Exchange
import java.io.IOException
import java.util.concurrent.Executors
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** The app's origin (Capacitor's `https` scheme on `localhost`, D61): a new origin is an empty store. */
private const val ORIGIN = "https://localhost"

/** The name the page finds native's object under (`apps/mobile/src/background/main.ts`). */
private const val PORT = "AstroTimeBackground"

/**
 * The page's title when it finds no object under that name: a signal of
 * failure only, heard without the object, so nothing races a healthy run.
 */
private const val NO_PORT = "astrotime-background:no-port"

class RunFailed(message: String) : Exception(message)

/**
 * `origins`: where the object is injected, the app's origin; a test gives
 * another to see a page that finds none.
 */
class HeadlessRun(private val context: Context, private val origins: Set<String> = setOf(ORIGIN)) {
    /** Loads the page and returns what it reports (`{ report }` or `{ error }`). */
    suspend fun run(): JSONObject =
        withContext(Dispatchers.Main) {
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                throw RunFailed("This WebView has no WebMessageListener.")
            }
            val gate = Gate(Executors.newCachedThreadPool())
            val webView = WebView(context)
            try {
                suspendCancellableCoroutine { continuation ->
                    val main = Handler(Looper.getMainLooper())
                    // Only on the main thread, and only once.
                    val finish = { result: Result<JSONObject> ->
                        if (continuation.isActive) {
                            result.fold(continuation::resume, continuation::resumeWithException)
                        }
                    }
                    val handlers =
                        Handlers(Exchange(), KeystoreSecrets(context), PluginNotifications(context), gate::work) {
                            main.post { finish(Result.success(it)) }
                        }
                    WebViewCompat.addWebMessageListener(webView, PORT, origins) { _, message, _, isMainFrame, reply ->
                        val data = message.data
                        if (isMainFrame && data != null) {
                            // An answer after the run is over has no page to reach (`Gate`).
                            handlers.receive(data) { answer -> main.post { gate.reply { reply.postMessage(answer) } } }
                        }
                    }
                    webView.settings.apply {
                        javaScriptEnabled = true
                        // The preferences (localStorage) the open app keeps, the reminders' ids among them.
                        domStorageEnabled = true
                        allowFileAccess = false
                        allowContentAccess = false
                    }
                    val assets =
                        WebViewAssetLoader.Builder()
                            .setDomain("localhost")
                            .addPathHandler("/", PublicAssets(context))
                            .build()
                    webView.webViewClient =
                        object : WebViewClient() {
                            override fun shouldInterceptRequest(
                                view: WebView,
                                request: WebResourceRequest,
                            ): WebResourceResponse? = assets.shouldInterceptRequest(request.url)

                            override fun onReceivedError(
                                view: WebView,
                                request: WebResourceRequest,
                                error: WebResourceError,
                            ) {
                                if (request.isForMainFrame) {
                                    finish(Result.failure(RunFailed("The page did not load: ${error.description}")))
                                }
                            }

                            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                                finish(Result.failure(RunFailed("The WebView's renderer went (crashed: ${detail.didCrash()}).")))
                                // Handled: the app goes on; the WebView is destroyed below.
                                return true
                            }
                        }
                    webView.webChromeClient =
                        object : WebChromeClient() {
                            override fun onReceivedTitle(view: WebView, title: String?) {
                                if (title == NO_PORT) finish(Result.failure(RunFailed("The page found no $PORT.")))
                            }
                        }
                    webView.loadUrl("$ORIGIN/background.html")
                }
            } finally {
                gate.close()
                webView.destroy()
            }
        }
}

/**
 * The files Capacitor copies into the APK (`assets/public`), as its own
 * server serves them to the app's WebView; anything else is a 404, never the
 * network.
 */
private class PublicAssets(private val context: Context) : WebViewAssetLoader.PathHandler {
    override fun handle(path: String): WebResourceResponse =
        try {
            WebResourceResponse(mimeOf(path), null, context.assets.open("public/$path"))
        } catch (error: IOException) {
            WebResourceResponse("text/plain", null, 404, "Not Found", emptyMap(), null)
        }

    private fun mimeOf(path: String): String =
        when (path.substringAfterLast('.', "")) {
            "html" -> "text/html"
            "js", "mjs" -> "text/javascript"
            "css" -> "text/css"
            "wasm" -> "application/wasm"
            "json" -> "application/json"
            "svg" -> "image/svg+xml"
            else -> "application/octet-stream"
        }
}
