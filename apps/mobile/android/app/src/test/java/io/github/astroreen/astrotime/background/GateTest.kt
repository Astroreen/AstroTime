// A run's calls once the run is over (docs/plans/android.md#D67): an answer
// that comes late reaches no page and throws nothing, and a call that comes
// late is not run, nor refused by an executor already shut down.
package io.github.astroreen.astrotime.background

import java.util.concurrent.AbstractExecutorService
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Runs each task at once, until shut down; then refuses, as a pool does. */
private class Inline : AbstractExecutorService() {
    var down = false
    val ran = mutableListOf<Runnable>()

    override fun execute(command: Runnable) {
        if (down) throw RejectedExecutionException("shut down")
        ran += command
        command.run()
    }

    override fun shutdown() {
        down = true
    }

    override fun shutdownNow(): List<Runnable> = emptyList<Runnable>().also { down = true }

    override fun isShutdown() = down

    override fun isTerminated() = down

    override fun awaitTermination(timeout: Long, unit: TimeUnit) = true
}

class GateTest {
    private val threads = Inline()
    private val gate = Gate(threads)

    @Test
    fun `while the run lasts, calls run and answers are sent`() {
        var sent = 0
        gate.work { gate.reply { sent++ } }
        assertEquals(1, sent)
    }

    @Test
    fun `an answer after the run is over is not sent`() {
        var sent = 0
        // An exchange under way when the run ends: its answer comes after.
        val answer = { gate.reply { sent++ } }
        gate.close()
        answer()
        assertEquals(0, sent)
        assertTrue(threads.down)
    }

    @Test
    fun `a call after the run is over is dropped, never thrown into the listener`() {
        gate.close()
        gate.work { throw AssertionError("ran after the run was over") }
        assertEquals(0, threads.ran.size)
    }

    @Test
    fun `an executor already shut down refuses quietly`() {
        threads.shutdownNow()
        gate.work { throw AssertionError("ran on a shut-down executor") }
        assertEquals(0, threads.ran.size)
    }

    @Test
    fun `an answer that throws (the WebView gone) is swallowed`() {
        gate.reply { throw IllegalStateException("WebView destroyed") }
    }
}
