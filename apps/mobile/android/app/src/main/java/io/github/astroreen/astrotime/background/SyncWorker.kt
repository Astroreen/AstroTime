// Background sync (docs/plans/android.md#D67): a periodic WorkManager job,
// every hour with a network, that runs background sync's page in a headless
// WebView (`HeadlessRun`) while the app is not in front.
package io.github.astroreen.astrotime.background

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject

private const val TAG = "AstroTimeSync"

/** The job's one name: scheduling it again replaces it, never adds a second. */
const val SYNC_WORK = "astrotime-sync"

/**
 * Past this a run is stopped and its WebView destroyed, whatever it waits
 * for: under WorkManager's own 10 minutes, so the run ends by our hand. Every
 * request has its own ceiling besides (`Exchange`).
 */
private const val RUN_LIMIT_MS = 9 * 60_000L

/** What a run did, in its output (for the log and the tests): one of these, or the page's report. */
const val OUTCOME = "outcome"
const val APP_OPEN = "The app is open and syncs itself: nothing to do."
const val NO_ACCOUNT = "No account's credentials are kept: nothing to do."

/**
 * What one run did, within `limitMs`: the page's report, why it failed, or
 * that it was stopped. Stopping cancels the run, which destroys its WebView.
 */
suspend fun outcomeOf(limitMs: Long, run: suspend () -> JSONObject): String =
    failedAsOutcome {
        withTimeoutOrNull(limitMs) { run() }?.toString() ?: "stopped after ${limitMs / 60_000} minutes"
    }

/**
 * What the job did: nothing while the app is in front (read once: an app that
 * comes to the front during a run waits for its sync, the sync lock, and
 * syncs after it; stopping a run mid-sync would gain nothing, D67), nothing
 * with no account's credentials (no WebView is started for nothing), else the
 * run's outcome. Any failure is an outcome too, never the worker's.
 */
suspend fun jobOutcome(inFront: Boolean, anyAccount: () -> Boolean, run: suspend () -> String): String =
    failedAsOutcome {
        when {
            inFront -> APP_OPEN
            !anyAccount() -> NO_ACCOUNT
            else -> run()
        }
    }

/**
 * A failure as the outcome it is (a WebView missing or being updated, the
 * Keystore, the preferences): logged, and the next hour tries again, as D67
 * says. Only a cancellation (WorkManager stopping the job) goes on up.
 */
private suspend fun failedAsOutcome(work: suspend () -> String): String =
    try {
        work()
    } catch (error: CancellationException) {
        throw error
    } catch (error: Exception) {
        "failed: ${(error as? RunFailed)?.message ?: error.toString()}"
    }

/** Whether the app's activity is on the screen: then the open app syncs itself. */
object AppVisibility {
    @Volatile
    @JvmStatic
    var inFront = false
}

class SyncWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        val context = applicationContext
        val outcome =
            jobOutcome(AppVisibility.inFront, { KeystoreSecrets.anyAccount(context) }) {
                outcomeOf(RUN_LIMIT_MS) { HeadlessRun(context).run() }
            }
        Log.i(TAG, "Background sync: $outcome")
        // A run that failed is not retried sooner: the next hour's tries again,
        // and an object is marked synced only once the server took it (foundation D37).
        return Result.success(Data.Builder().putString(OUTCOME, outcome).build())
    }

    companion object {
        /** Every hour with a network; kept across starts, its settings replaced by this version's. */
        @JvmStatic
        fun schedule(context: Context) {
            val request =
                PeriodicWorkRequestBuilder<SyncWorker>(1, TimeUnit.HOURS)
                    .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                    .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(SYNC_WORK, ExistingPeriodicWorkPolicy.UPDATE, request)
        }
    }
}
