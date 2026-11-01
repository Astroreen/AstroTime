// One run of background sync's page in a WebView of its own, created with
// the application's context and no activity or window
// (docs/plans/android.md#D67). It serves the app's own files on the app's
// origin, `https://localhost`, so it shares the open app's OPFS store, Web
// Locks and BroadcastChannels, and it answers the page's calls (`Handlers`)
// through the one object it injects, for that origin only. It ends when the
// page says it is done; when the page says in its title that it found no
// such object or that its script did not run, when any of its files fails
// to load, or when it lost its renderer; the WebView is destroyed whatever
// happens, which lets go of the store.
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
 * The page's titles when it fails before it could say so through the
 * object: it found none under that name, or its script did not load or run
 * (`background.html`). Signals of failure only, heard without the object,
 * so nothing races a healthy run.
 */
private val FAILURES =
    mapOf(
        "astrotime-background:no-port" to "The page found no $PORT.",
        "astrotime-background:no-script" to "The page's script did not load or run.",
    )

class RunFailed(message: String) : Exception(message)

/**
 * `origins`: where the object is injected, the app's origin; `files`: what
 * serves the app's files, the APK's. Tests give others, to see a page that
 * finds no object or no script.
 */
class HeadlessRun(
    private val context: Context,
    private val origins: Set<String> = setOf(ORIGIN),
    private val files: WebViewAssetLoader.PathHandler = PublicAssets(context),
) {
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
                            .addPathHandler("/", files)
                            .build()
                    webView.webViewClient =
                        object : WebViewClient() {
                            override fun shouldInterceptRequest(
                                view: WebView,
                                request: WebResourceRequest,
                            ): WebResourceResponse =
                                // The app's files, and nothing from the network: HTTP goes through native.
                                assets.shouldInterceptRequest(request.url)
                                    ?: WebResourceResponse("text/plain", null, 403, "Forbidden", emptyMap(), null)

                            override fun onReceivedError(
                                view: WebView,
                                request: WebResourceRequest,
                                error: WebResourceError,
                            ) {
                                if (request.isForMainFrame) {
                                    finish(Result.failure(RunFailed("The page did not load: ${error.description}")))
                                }
                            }

                            // Every file is the app's own: a missing one is a broken page.
                            override fun onReceivedHttpError(
                                view: WebView,
                                request: WebResourceRequest,
                                response: WebResourceResponse,
                            ) {
                                val path = request.url.path
                                finish(Result.failure(RunFailed("$path answered ${response.statusCode}.")))
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
                                FAILURES[title]?.let { finish(Result.failure(RunFailed(it))) }
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
internal class PublicAssets(private val context: Context) : WebViewAssetLoader.PathHandler {
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
