// Background sync on a device (docs/plans/android.md#D67), in the app's
// process with no activity started: the worker as WorkManager's test driver
// runs it, and background sync's page in its headless WebView opening the
// store from OPFS. Needs the web build in the APK (`cap sync` first).
package io.github.astroreen.astrotime.background

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.work.ListenableWorker
import androidx.work.testing.TestListenableWorkerBuilder
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
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
        // A freshly installed app keeps none.
        if (KeystoreSecrets.anyAccount(context)) return
        assertEquals(NO_ACCOUNT, runWorker())
    }

    @Test
    fun theHeadlessPageOpensTheStoreAndSaysItIsDone() {
        val outcome = runBlocking { HeadlessRun(context).run() }
        // Not `{ error }`: the page ran, opened the store and reported.
        val report = outcome.getJSONObject("report")
        assertTrue(report.has("accounts"))
    }
}
