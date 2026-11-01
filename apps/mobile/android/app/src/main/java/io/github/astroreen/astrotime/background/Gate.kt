// What a run's calls may still do once the run is over: nothing
// (docs/plans/android.md#D67). A call can outlive its run (the watchdog, a
// `done` while an exchange is under way, a renderer gone), and its answer
// then has no WebView to reach. No Android API, so the JVM tests run it.
package io.github.astroreen.astrotime.background

import java.util.concurrent.ExecutorService
import java.util.concurrent.RejectedExecutionException

class Gate(private val threads: ExecutorService) {
    // Set and read on the main thread, where answers are posted; volatile for `work`'s callers.
    @Volatile
    private var closed = false

    /** Runs a call off the main thread, unless the run is over. */
    fun work(task: Runnable) {
        if (closed) return
        try {
            threads.execute(task)
        } catch (error: RejectedExecutionException) {
            // Closed between the check and here: the run is over.
        }
    }

    /** Sends an answer to the page (on the main thread), unless the run is over. */
    fun reply(send: () -> Unit) {
        if (closed) return
        try {
            send()
        } catch (error: Throwable) {
            // The page went with its WebView: nobody is left to answer.
        }
    }

    /** The run is over: no more calls or answers, and the calls under way are interrupted. */
    fun close() {
        closed = true
        threads.shutdownNow()
    }
}
