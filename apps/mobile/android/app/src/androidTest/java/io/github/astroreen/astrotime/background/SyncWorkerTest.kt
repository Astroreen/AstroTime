// Background sync on a device (docs/plans/android.md#D67), in the app's
// process with no activity started: the worker as WorkManager's test driver
// runs it, and background sync's page in its headless WebView opening the
// store from OPFS. Needs the web build in the APK (`cap sync` first).
package io.github.astroreen.astrotime.background

import android.content.Context
import android.webkit.WebResourceResponse
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.webkit.WebViewAssetLoader
import androidx.work.ListenableWorker
import androidx.work.testing.TestListenableWorkerBuilder
import java.io.ByteArrayInputStream
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SyncWorkerTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    private fun runWorker(): String {
        val result = runBlocking { TestListenableWorkerBuilder<SyncWorker>(context).build().doWork() }
        assertTrue(result is ListenableWorker.Result.Success)
        return result.outputData.getString(OUTCOME)!!
    }

    @After
    fun away() {
        AppVisibility.inFront = false
    }

    @Test
    fun withTheAppInFrontItDoesNothing() {
        AppVisibility.inFront = true
        assertEquals(APP_OPEN, runWorker())
    }

    @Test
    fun withNoCredentialsNoWebViewIsStarted() {
        // Signed out of everything: no account's credentials kept.
        val kept = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        kept.edit().apply { kept.all.keys.filter { it.startsWith("${SECRET_PREFIX}account:") }.forEach(::remove) }.commit()
        assertEquals(NO_ACCOUNT, runWorker())
    }

    @Test
    fun aPageThatFindsNoObjectEndsTheRunAtOnce() {
        // The object injected for another origin only: the page finds none.
        val error =
            assertThrows(RunFailed::class.java) {
                runBlocking { HeadlessRun(context, setOf("https://elsewhere.test")).run() }
            }
        assertEquals("The page found no AstroTimeBackground.", error.message)
    }

    /** The APK's files, but `broken` answers in place of the ones it answers for. */
    private fun filesWith(broken: (String) -> WebResourceResponse?): WebViewAssetLoader.PathHandler {
        val real = PublicAssets(context)
        return WebViewAssetLoader.PathHandler { path -> broken(path) ?: real.handle(path) }
    }

    @Test
    fun aPageWhoseBundleIsMissingEndsTheRunAtOnce() {
        val files =
            filesWith { path ->
                if (path.startsWith("assets/")) WebResourceResponse("text/plain", null, 404, "Not Found", emptyMap(), null) else null
            }
        val error = assertThrows(RunFailed::class.java) { runBlocking { HeadlessRun(context, files = files).run() } }
        assertTrue(error.message!!, error.message!!.endsWith("answered 404."))
    }

    @Test
    fun aPageWhoseScriptDoesNotRunEndsTheRunAtOnce() {
        // Served fine, but not JavaScript: no 404 to hear, only the page's own title.
        val files =
            filesWith { path ->
                if (path.startsWith("assets/background-") && path.endsWith(".js")) {
                    WebResourceResponse("text/javascript", null, ByteArrayInputStream("this is not JavaScript (".toByteArray()))
                } else {
                    null
                }
            }
        val error = assertThrows(RunFailed::class.java) { runBlocking { HeadlessRun(context, files = files).run() } }
        assertEquals("The page's script did not load or run.", error.message)
    }

    @Test
    fun theHeadlessPageOpensTheStoreAndSaysItIsDone() {
        val outcome = runBlocking { HeadlessRun(context).run() }
        // Not `{ error }`: the page ran, opened the store and reported.
        val report = outcome.getJSONObject("report")
        assertTrue(report.has("accounts"))
    }
}
